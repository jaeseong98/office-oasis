// Office Oasis · 데스크톱 대청소 — Electron Main Process
//
// 역할:
//  1) 사용자의 바탕화면/Downloads/Documents (또는 사용자가 고른 폴더) 재귀 스캔
//  2) 각 파일을 카테고리로 분류:
//     - huge       : 50MB 이상
//     - old        : 마지막 수정 90일+
//     - screenshot : Screenshot_*/스크린샷 */Screen Shot * 패턴
//     - temp       : .tmp / .crdownload / .part / .bak / ~$* / Thumbs.db / .DS_Store / 0KB
//     - empty      : (디렉터리) 내부가 비어있음
//     - duplicate  : size + SHA1 동일 그룹
//  3) trashMany IPC: shell.trashItem 으로 실제 휴지통 이동
//  4) 진행률을 실시간으로 렌더러에 전송

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const crypto = require('node:crypto')
const { autoUpdater } = require('electron-updater')

let mainWindow = null
let scanState = { running: false, cancelToken: 0 }

/* ───────── 경로 / 무시 규칙 ───────── */

function defaultRoots() {
  const roots = []
  try { roots.push(app.getPath('desktop')) } catch { /* ignore */ }
  try { roots.push(app.getPath('downloads')) } catch { /* ignore */ }
  try { roots.push(app.getPath('documents')) } catch { /* ignore */ }
  return [...new Set(roots)]
}

const HARD_IGNORE_DIRS = new Set([
  // VCS / IDE
  '.git', '.svn', '.hg', '.idea', '.vscode',
  // 시스템
  '$RECYCLE.BIN', 'System Volume Information', 'AppData', 'Library',
  // 패키지 매니저들이 깐 파일 — 정리 대상 아님, 해시만 무거움
  'node_modules',
  'win-library',     // R packages on Windows
  'site-packages',   // Python packages
  '__pycache__',     // Python bytecode
  'venv', '.venv',   // Python virtualenv
  '.tox',            // Python test envs
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  // 빌드 캐시
  '.next', '.nuxt', '.turbo', '.parcel-cache', '.cache',
])

const HARD_IGNORE_FILES = new Set([
  'desktop.ini', 'thumbs.db', '.ds_store', 'ntuser.dat',
])

function shouldIgnoreName(name, isDir) {
  if (!name) return true
  const lower = name.toLowerCase()
  if (isDir) {
    if (HARD_IGNORE_DIRS.has(name)) return true
    if (name.startsWith('.')) return true // 숨김 폴더 전부 무시
    return false
  }
  if (HARD_IGNORE_FILES.has(lower)) return true
  return false
}

/* ───────── 카테고리 패턴 ───────── */

const HUGE_THRESHOLD = 50 * 1024 * 1024 // 50MB
const OLD_DAYS = 90
const DEDUP_MIN_SIZE = 64 * 1024 // 64KB — 그 이하 파일은 dedup 안 함 (해시 비용 대비 회수량 0)

const TEMP_EXTS = new Set(['.tmp', '.bak', '.crdownload', '.part', '.partial', '.dmp', '.old'])
const TEMP_NAME_PATTERNS = [
  /^~\$/,            // ~$Document.docx — MS Office 임시 락
  /^\._/,            // macOS 메타데이터
  /^\.~lock\./i,     // LibreOffice lock
]

const SCREENSHOT_PATTERNS = [
  /^Screenshot[_ -]/i,
  /^Screen[_ ]?Shot[_ -]?\d/i,
  /^스크린샷[_ ]?/,
  /^image[_ -]?\(\d+\)/i,
  /^image[_ -]?\d{2,}/i,
  /^캡처[_ -]/,
]

function isTempFile(name, size) {
  if (size === 0) return true
  const lower = name.toLowerCase()
  const ext = path.extname(lower)
  if (TEMP_EXTS.has(ext)) return true
  if (TEMP_NAME_PATTERNS.some((p) => p.test(name))) return true
  return false
}

function isScreenshot(name) {
  return SCREENSHOT_PATTERNS.some((p) => p.test(name))
}

/* ───────── 재귀 스캔 (yield 기반) ───────── */

async function* walkDir(root, maxDepth = 5, currentDepth = 0) {
  let entries
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (shouldIgnoreName(e.name, e.isDirectory())) continue
    const full = path.join(root, e.name)
    if (e.isDirectory()) {
      yield { type: 'dir', path: full, depth: currentDepth }
      if (currentDepth < maxDepth) {
        yield* walkDir(full, maxDepth, currentDepth + 1)
      }
    } else if (e.isFile()) {
      yield { type: 'file', path: full, depth: currentDepth }
    }
  }
}

function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scan:progress', payload)
  }
}

/* ───────── SHA1 (스트리밍, 큰 파일 안전) ───────── */

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1')
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })
    stream.on('data', (chunk) => h.update(chunk))
    stream.on('end', () => resolve(h.digest('hex')))
    stream.on('error', reject)
  })
}

/* ───────── 메인 스캔 ───────── */

async function runScan(roots) {
  scanState.running = true
  const myToken = ++scanState.cancelToken
  const cancelled = () => scanState.cancelToken !== myToken

  const allFiles = []
  const allDirs = []

  // Phase 1: walk
  for (const root of roots) {
    if (cancelled()) break
    try { await fsp.access(root) } catch { continue }
    for await (const entry of walkDir(root, 5, 0)) {
      if (cancelled()) break
      if (entry.type === 'file') {
        try {
          const st = await fsp.stat(entry.path)
          allFiles.push({
            path: entry.path,
            name: path.basename(entry.path),
            ext: path.extname(entry.path).toLowerCase(),
            size: st.size,
            mtimeMs: st.mtimeMs,
            root,
          })
        } catch { /* skipped */ }
      } else if (entry.type === 'dir') {
        allDirs.push({ path: entry.path, root })
      }
      if ((allFiles.length & 127) === 0) {
        sendProgress({ phase: 'walk', count: allFiles.length, currentPath: entry.path })
      }
    }
  }
  if (cancelled()) {
    scanState.running = false
    return { cancelled: true }
  }
  sendProgress({ phase: 'walk-done', count: allFiles.length })

  // Phase 2: classify
  const now = Date.now()
  const huge = []
  const old = []
  const screenshots = []
  const temp = []
  const bySize = new Map() // size -> [file]
  let totalSize = 0

  for (const f of allFiles) {
    totalSize += f.size
    const ageDays = (now - f.mtimeMs) / (1000 * 60 * 60 * 24)
    if (f.size >= HUGE_THRESHOLD) huge.push(f)
    if (ageDays >= OLD_DAYS) old.push(f)
    if (isScreenshot(f.name)) screenshots.push(f)
    if (isTempFile(f.name, f.size)) temp.push(f)
    if (f.size >= DEDUP_MIN_SIZE) {
      const arr = bySize.get(f.size) || []
      arr.push(f)
      bySize.set(f.size, arr)
    }
  }

  // Phase 3: empty dirs
  const emptyDirs = []
  for (const d of allDirs) {
    if (cancelled()) break
    try {
      const ent = await fsp.readdir(d.path)
      const visible = ent.filter((n) => !shouldIgnoreName(n, false) && !HARD_IGNORE_DIRS.has(n))
      if (visible.length === 0) emptyDirs.push({ path: d.path, root: d.root })
    } catch { /* ignore */ }
  }

  // Phase 4: duplicates — 같은 size 그룹만 SHA1
  const dupCandidates = []
  for (const arr of bySize.values()) {
    if (arr.length > 1) dupCandidates.push(...arr)
  }
  sendProgress({ phase: 'hash', total: dupCandidates.length, current: 0 })

  const byHash = new Map()
  let hashed = 0
  for (const f of dupCandidates) {
    if (cancelled()) break
    try {
      const h = await hashFile(f.path)
      const arr = byHash.get(h) || []
      arr.push(f)
      byHash.set(h, arr)
    } catch { /* ignore unreadable */ }
    hashed++
    if ((hashed & 15) === 0) {
      sendProgress({ phase: 'hash', total: dupCandidates.length, current: hashed, currentPath: f.path })
    }
  }
  sendProgress({ phase: 'hash-done', total: dupCandidates.length, current: hashed })

  const duplicates = []
  for (const arr of byHash.values()) {
    if (arr.length > 1) {
      const sorted = arr.slice().sort((a, b) => a.mtimeMs - b.mtimeMs)
      duplicates.push(sorted)
    }
  }

  scanState.running = false
  return {
    cancelled: false,
    roots,
    totals: {
      fileCount: allFiles.length,
      dirCount: allDirs.length,
      totalSize,
    },
    huge,
    old,
    screenshots,
    temp,
    duplicates,
    emptyDirs,
  }
}

/* ───────── IPC ───────── */

ipcMain.handle('scan:start', async (_e, customRoots) => {
  if (scanState.running) return { error: '이미 스캔 중입니다' }
  const roots = (Array.isArray(customRoots) && customRoots.length > 0) ? customRoots : defaultRoots()
  return await runScan(roots)
})

ipcMain.handle('scan:cancel', () => {
  scanState.cancelToken++
  scanState.running = false
  return { ok: true }
})

ipcMain.handle('scan:default-roots', () => defaultRoots())

ipcMain.handle('pick:folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '청소할 폴더 선택',
  })
  if (result.canceled || !result.filePaths.length) return { canceled: true }
  return { canceled: false, path: result.filePaths[0] }
})

ipcMain.handle('trash:many', async (_e, paths) => {
  if (!Array.isArray(paths)) return { results: [] }
  const results = []
  for (const p of paths) {
    if (typeof p !== 'string') {
      results.push({ path: p, ok: false, error: 'invalid' })
      continue
    }
    try {
      await shell.trashItem(p)
      results.push({ path: p, ok: true })
    } catch (err) {
      results.push({ path: p, ok: false, error: err.message || String(err) })
    }
  }
  return { results }
})

ipcMain.handle('shell:reveal', async (_e, p) => {
  if (typeof p === 'string') shell.showItemInFolder(p)
  return { ok: true }
})

ipcMain.handle('shell:open', async (_e, p) => {
  if (typeof p !== 'string') return { ok: false }
  await shell.openPath(p)
  return { ok: true }
})

/* ───────── 윈도우 부트스트랩 ───────── */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#fafaf9',
    title: '바탕화면 대청소 · Office Oasis',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

/* ───────── 자동 업데이트 ───────── */

function setupAutoUpdater() {
  // 개발 모드에선 건너뜀 (electron-updater 가 dev 환경에서 동작 안 함)
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', {
        version: info.version,
        releaseDate: info.releaseDate,
      })
    }
  })

  autoUpdater.on('update-downloaded', async (info) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('update:downloaded', {
      version: info.version,
    })
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 준비 완료',
      message: `Office Oasis ${info.version} 가 설치 준비되었습니다.`,
      detail: '지금 다시 시작해서 업데이트를 적용하시겠어요?',
      buttons: ['지금 재시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice.response === 0) autoUpdater.quitAndInstall()
  })

  autoUpdater.on('error', (err) => {
    console.error('[oasis] auto-update error:', err)
  })

  // 시작 후 잠시 뒤 확인
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[oasis] checkForUpdates failed:', err)
    })
  }, 4000)
}

app.whenReady().then(() => {
  createWindow()
  setupAutoUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
