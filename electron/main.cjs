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

const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, globalShortcut, clipboard, screen, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const crypto = require('node:crypto')
const { autoUpdater } = require('electron-updater')

let mainWindow = null
let clipboardWindow = null
let tray = null
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

// 영구 삭제 (복원 불가) — fs.rm 으로 휴지통 우회
ipcMain.handle('permanent:many', async (_e, paths) => {
  if (!Array.isArray(paths)) return { results: [] }
  const results = []
  for (const p of paths) {
    if (typeof p !== 'string') {
      results.push({ path: p, ok: false, error: 'invalid' })
      continue
    }
    try {
      // recursive: true 로 디렉터리도 처리, force: true 로 없는 경로 무시
      await fsp.rm(p, { recursive: true, force: true })
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

/* ───────── 클립보드 매니저 ───────── */

const CLIPBOARD_MAX_ENTRIES = 200
const CLIPBOARD_POLL_MS = 700
const CLIPBOARD_MAX_TEXT_LEN = 10 * 1024 * 1024 // 10MB

let clipboardHistory = []       // [{ id, type, text, timestamp, pinned }]
let lastClipboardText = ''
let clipboardPaused = false
let clipboardTimer = null

function clipboardFilePath() {
  return path.join(app.getPath('userData'), 'clipboard-history.json')
}

function loadClipboardHistory() {
  try {
    const raw = fs.readFileSync(clipboardFilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) clipboardHistory = parsed
  } catch { clipboardHistory = [] }
}

function saveClipboardHistory() {
  try {
    fs.writeFileSync(clipboardFilePath(), JSON.stringify(clipboardHistory))
  } catch (err) {
    console.error('[oasis] save clipboard history failed:', err)
  }
}

function broadcastClipboard() {
  if (clipboardWindow && !clipboardWindow.isDestroyed()) {
    clipboardWindow.webContents.send('clipboard:update', clipboardHistory)
  }
}

function startClipboardPolling() {
  try { lastClipboardText = clipboard.readText() } catch { lastClipboardText = '' }
  clipboardTimer = setInterval(() => {
    if (clipboardPaused) return
    let text
    try { text = clipboard.readText() } catch { return }
    if (!text || text === lastClipboardText) return
    if (text.length > CLIPBOARD_MAX_TEXT_LEN) return
    lastClipboardText = text

    // 중복 제거 — 같은 텍스트 기존 항목은 제거 후 맨 위로
    clipboardHistory = clipboardHistory.filter(e => e.text !== text)
    clipboardHistory.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'text',
      text,
      timestamp: Date.now(),
    })
    // 최대 개수 유지 — 핀된 건 보존
    if (clipboardHistory.length > CLIPBOARD_MAX_ENTRIES) {
      const pinned = clipboardHistory.filter(e => e.pinned)
      const rest = clipboardHistory.filter(e => !e.pinned)
      clipboardHistory = [...pinned, ...rest].slice(0, CLIPBOARD_MAX_ENTRIES)
    }
    saveClipboardHistory()
    broadcastClipboard()
  }, CLIPBOARD_POLL_MS)
}

/* ───────── 클립보드 팝업 창 ───────── */

function createClipboardWindow() {
  clipboardWindow = new BrowserWindow({
    width: 480,
    height: 540,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#fafaf9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    clipboardWindow.loadURL(`${devUrl}?window=clipboard`)
  } else {
    clipboardWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      query: { window: 'clipboard' },
    })
  }

  clipboardWindow.on('blur', () => {
    if (!clipboardWindow.isDestroyed() && !clipboardWindow.webContents.isDevToolsOpened()) {
      clipboardWindow.hide()
    }
  })

  clipboardWindow.on('closed', () => { clipboardWindow = null })
}

function showClipboardNearCursor() {
  if (!clipboardWindow || clipboardWindow.isDestroyed()) createClipboardWindow()
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const W = 480, H = 540
  const x = Math.min(
    Math.max(cursor.x - 100, display.workArea.x + 8),
    display.workArea.x + display.workArea.width - W - 8,
  )
  const y = Math.min(
    Math.max(cursor.y, display.workArea.y + 8),
    display.workArea.y + display.workArea.height - H - 8,
  )
  clipboardWindow.setPosition(x, y)
  clipboardWindow.show()
  clipboardWindow.focus()
  clipboardWindow.webContents.send('clipboard:update', clipboardHistory)
}

function toggleClipboardWindow() {
  if (clipboardWindow && !clipboardWindow.isDestroyed() && clipboardWindow.isVisible()) {
    clipboardWindow.hide()
  } else {
    showClipboardNearCursor()
  }
}

/* ───────── 클립보드 IPC ───────── */

ipcMain.handle('clipboard:list', () => clipboardHistory)

ipcMain.handle('clipboard:paste', (_e, id) => {
  const entry = clipboardHistory.find(e => e.id === id)
  if (!entry) return { ok: false }
  clipboard.writeText(entry.text)
  lastClipboardText = entry.text // 폴러가 새 항목으로 추가하지 않도록
  // 최근 사용된 것은 위로
  clipboardHistory = [entry, ...clipboardHistory.filter(e => e.id !== id)]
  saveClipboardHistory()
  if (clipboardWindow && !clipboardWindow.isDestroyed()) clipboardWindow.hide()
  return { ok: true }
})

ipcMain.handle('clipboard:delete', (_e, id) => {
  clipboardHistory = clipboardHistory.filter(e => e.id !== id)
  saveClipboardHistory()
  broadcastClipboard()
  return { ok: true }
})

ipcMain.handle('clipboard:pin', (_e, id) => {
  const e = clipboardHistory.find(x => x.id === id)
  if (!e) return { ok: false }
  e.pinned = !e.pinned
  clipboardHistory.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
  saveClipboardHistory()
  broadcastClipboard()
  return { ok: true }
})

ipcMain.handle('clipboard:clear', () => {
  clipboardHistory = clipboardHistory.filter(e => e.pinned)
  saveClipboardHistory()
  broadcastClipboard()
  return { ok: true }
})

ipcMain.handle('clipboard:hide', () => {
  if (clipboardWindow && !clipboardWindow.isDestroyed()) clipboardWindow.hide()
  return { ok: true }
})

ipcMain.handle('clipboard:set-paused', (_e, paused) => {
  clipboardPaused = !!paused
  rebuildTrayMenu()
  return { paused: clipboardPaused }
})

/* ───────── 트레이 ───────── */

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: '청소하기 열기',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow()
        mainWindow.show()
        mainWindow.focus()
      },
    },
    {
      label: '클립보드 (Ctrl+Shift+V)',
      click: () => showClipboardNearCursor(),
    },
    { type: 'separator' },
    {
      label: clipboardPaused ? '클립보드 기록 재개' : '클립보드 기록 일시 정지',
      click: () => {
        clipboardPaused = !clipboardPaused
        rebuildTrayMenu()
      },
    },
    {
      label: '클립보드 비우기 (핀 제외)',
      click: () => {
        clipboardHistory = clipboardHistory.filter(e => e.pinned)
        saveClipboardHistory()
        broadcastClipboard()
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => { app.isQuitting = true; app.quit() },
    },
  ])
}

function rebuildTrayMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu())
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png')
  let icon
  try {
    icon = nativeImage.createFromPath(iconPath)
  } catch {
    icon = nativeImage.createEmpty()
  }
  tray = new Tray(icon)
  tray.setToolTip('Office Oasis')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      return
    }
    if (mainWindow.isVisible()) mainWindow.hide()
    else { mainWindow.show(); mainWindow.focus() }
  })
}

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

  // 트레이가 있으면 닫기 = 숨기기 (백그라운드 유지)
  mainWindow.on('close', (e) => {
    if (!app.isQuitting && tray && !tray.isDestroyed()) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
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
  loadClipboardHistory()
  startClipboardPolling()
  createTray()
  createWindow()
  setupAutoUpdater()

  // 전역 단축키
  const accelerator = 'CommandOrControl+Shift+V'
  const ok = globalShortcut.register(accelerator, () => toggleClipboardWindow())
  if (!ok) console.error('[oasis] failed to register global shortcut', accelerator)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 트레이가 있으니 모든 창이 닫혀도 종료하지 않음
app.on('window-all-closed', () => {
  // no-op: tray가 살아있는 한 프로세스 유지
})

app.on('before-quit', () => {
  app.isQuitting = true
  if (clipboardTimer) clearInterval(clipboardTimer)
  globalShortcut.unregisterAll()
  if (tray && !tray.isDestroyed()) tray.destroy()
})
