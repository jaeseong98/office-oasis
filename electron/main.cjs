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
let tray = null
let scanState = { running: false, cancelToken: 0 }

// 런처/노트는 메인 앱의 탭으로 통합되어 별도 창 없음.
// 트레이/단축키에서 호출 시 메인 창을 띄우고 해당 탭으로 전환.
function showMainWithTab(tab) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  // 렌더러에 탭 전환 시그널
  try {
    mainWindow.webContents.send('main:switch-tab', tab)
  } catch { /* ignore if not yet loaded */ }
}

/* ───────── 렌더러 URL ───────── */
// loadFile + query 조합이 asar 환경에서 누락되는 경우가 있어 hash 기반으로 통일.
// 라우팅(main.jsx)은 hash와 query 둘 다 받아서 하위 호환 유지.
function rendererURL(hash) {
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) return hash ? `${devUrl}#${hash}` : devUrl
  const filePath = path.join(__dirname, '..', 'dist', 'index.html')
  const base = 'file:///' + filePath.replace(/\\/g, '/')
  return hash ? `${base}#${hash}` : base
}

// 모든 창에 F12 = 개발자도구 토글
function attachDevToolsShortcut(win) {
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools()
    }
  })
}

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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clipboard:update', clipboardHistory)
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

// 클립보드는 메인 앱 탭으로 통합. 별도 창 없음.
function showClipboardNearCursor() { showMainWithTab('clipboard') }
function toggleClipboardWindow() { showMainWithTab('clipboard') }

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
  // 탭으로 통합되었으므로 hide 동작은 더 이상 의미 없음 (no-op)
  return { ok: true }
})

ipcMain.handle('clipboard:set-paused', (_e, paused) => {
  clipboardPaused = !!paused
  rebuildTrayMenu()
  return { paused: clipboardPaused }
})

/* ───────── 렌더러 → 윈도우 열기 IPC ───────── */

ipcMain.handle('ui:open-launcher', () => { showLauncher(); return { ok: true } })
ipcMain.handle('ui:open-clipboard', () => { showClipboardNearCursor(); return { ok: true } })
ipcMain.handle('ui:open-notes', () => { showNotes(); return { ok: true } })

/* ───────── 설정: 시작 프로그램 등록 ───────── */

ipcMain.handle('settings:get-auto-launch', () => {
  const s = app.getLoginItemSettings()
  return { enabled: !!s.openAtLogin, asHidden: !!s.openAsHidden || (s.args || []).includes('--hidden') }
})

ipcMain.handle('settings:set-auto-launch', (_e, payload) => {
  const enabled = !!payload?.enabled
  const asHidden = payload?.asHidden !== false
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: asHidden, // macOS
    args: enabled && asHidden ? ['--hidden'] : [],
  })
  return { ok: true }
})

ipcMain.handle('app:get-version', () => app.getVersion())

ipcMain.handle('shell:open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    shell.openExternal(url)
  }
  return { ok: true }
})

/* ───────── 구내식당 (맘스푸드 블로그 크롤링) ───────── */

const CAFETERIA_RSS = 'https://rss.blog.naver.com/momsfood_.xml'
const CAFETERIA_BLOG = 'https://blog.naver.com/momsfood_'
const CAFETERIA_TTL_MS = 60 * 60 * 1000  // 1시간

let cafeteriaCache = null

async function fetchImageAsDataURL(url) {
  if (!url) return null
  try {
    const r = await fetch(url, {
      headers: {
        'Referer': 'https://blog.naver.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    // 너무 큰 이미지는 거부 (5MB)
    if (buf.length > 5 * 1024 * 1024) return null
    const contentType = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
    return `data:${contentType};base64,${buf.toString('base64')}`
  } catch (err) {
    console.warn('[oasis] image fetch failed:', err.message)
    return null
  }
}

function parseRssItem(body) {
  const get = (re) => body.match(re)?.[1]?.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim()
  const title = get(/<title>([\s\S]*?)<\/title>/)
  const link = get(/<link>([\s\S]*?)<\/link>/)
  const pubDate = get(/<pubDate>([\s\S]*?)<\/pubDate>/)
  const description = body.match(/<description>([\s\S]*?)<\/description>/)?.[1] || ''
  const cleanDesc = description.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
  const imageUrl = cleanDesc.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
  const text = cleanDesc
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
  return { title, link, pubDate, imageUrl, text }
}

// RSS 썸네일(blogthumb)은 잘린 미리보기라, 실제 게시물 페이지에서 원본 이미지(postfiles)를 가져온다.
async function fetchOriginalImageFromPost(postUrl) {
  if (!postUrl) return null
  try {
    const match = postUrl.match(/momsfood_\/(\d+)/) || postUrl.match(/logNo=(\d+)/)
    if (!match) return null
    const logNo = match[1]
    const viewUrl = `https://blog.naver.com/PostView.naver?blogId=momsfood_&logNo=${logNo}`
    const r = await fetch(viewUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    if (!r.ok) return null
    const html = await r.text()
    // 원본 이미지 호스트: postfiles.pstatic 또는 blogfiles.pstatic
    const m = html.match(/<img[^>]+src=["'](https?:\/\/(?:postfiles|blogfiles)\.pstatic\.net\/[^"']+)["']/i)
    return m?.[1] || null
  } catch (err) {
    console.warn('[oasis] post page fetch failed:', err.message)
    return null
  }
}

async function fetchCafeteria(forceRefresh = false) {
  if (!forceRefresh && cafeteriaCache && Date.now() - cafeteriaCache.fetchedAt < CAFETERIA_TTL_MS) {
    return cafeteriaCache
  }
  try {
    const r = await fetch(CAFETERIA_RSS, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const xml = await r.text()

    const items = []
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let m
    while ((m = itemRe.exec(xml)) !== null) {
      const parsed = parseRssItem(m[1])
      if (parsed.title) items.push(parsed)
    }

    // 주간식단표 관련 게시물 우선
    const menuItems = items.filter(i => /식단|메뉴/.test(i.title))
    const latest = menuItems[0] || items[0] || null

    // 게시물 페이지에서 원본 이미지 가져오기 (RSS 썸네일은 잘려 있음)
    let imageDataURL = null
    let originalImageUrl = null
    if (latest?.link) {
      originalImageUrl = await fetchOriginalImageFromPost(latest.link)
    }
    // 원본 못 찾으면 RSS 썸네일이라도 시도
    const imageToFetch = originalImageUrl || latest?.imageUrl
    if (imageToFetch) {
      imageDataURL = await fetchImageAsDataURL(imageToFetch)
    }

    cafeteriaCache = {
      latest: latest ? { ...latest, imageDataURL, originalImageUrl } : null,
      recent: menuItems.slice(0, 6).map(i => ({ title: i.title, link: i.link, pubDate: i.pubDate })),
      blogUrl: CAFETERIA_BLOG,
      fetchedAt: Date.now(),
    }
    return cafeteriaCache
  } catch (err) {
    return { error: err.message || String(err), fetchedAt: Date.now() }
  }
}

ipcMain.handle('cafeteria:fetch', async (_e, force) => fetchCafeteria(!!force))

/* ───────── 윈도우 컨트롤 (custom titlebar용) ───────── */

function ownerWindow(event) {
  return BrowserWindow.fromWebContents(event.sender)
}

ipcMain.handle('win:minimize', (e) => { ownerWindow(e)?.minimize() })
ipcMain.handle('win:maximize-toggle', (e) => {
  const w = ownerWindow(e); if (!w) return
  if (w.isMaximized()) w.unmaximize(); else w.maximize()
})
ipcMain.handle('win:hide', (e) => { ownerWindow(e)?.hide() })
ipcMain.handle('win:is-maximized', (e) => ownerWindow(e)?.isMaximized() ?? false)
ipcMain.handle('win:toggle-fullscreen', (e) => {
  const w = ownerWindow(e); if (!w) return
  w.setFullScreen(!w.isFullScreen())
})

/* ───────── 노트 (Quick Notes) ───────── */

let notes = []

function notesFilePath() {
  return path.join(app.getPath('userData'), 'notes.json')
}
function loadNotes() {
  try {
    const raw = fs.readFileSync(notesFilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) notes = parsed
  } catch { notes = [] }
}
function saveNotes() {
  try { fs.writeFileSync(notesFilePath(), JSON.stringify(notes)) } catch { /* ignore */ }
}
function broadcastNotes() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notes:update', notes)
  }
}

// 노트는 메인 앱의 탭이라 별도 창 없음.
function showNotes() { showMainWithTab('notes') }

ipcMain.handle('notes:list', () => notes)

ipcMain.handle('notes:create', () => {
  const note = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    body: '',
    updatedAt: Date.now(),
    createdAt: Date.now(),
  }
  notes.unshift(note)
  saveNotes()
  broadcastNotes()
  return note
})

ipcMain.handle('notes:save', (_e, payload) => {
  const { id, body } = payload || {}
  const n = notes.find(x => x.id === id)
  if (!n) return { ok: false }
  n.body = body
  n.updatedAt = Date.now()
  // 최근 수정을 최상단으로 — 단 자판 칠 때마다 흔들리지 않게 활성 노트가 이미 상단이면 유지
  if (notes[0]?.id !== id) {
    notes = [n, ...notes.filter(x => x.id !== id)]
  }
  saveNotes()
  return { ok: true }
})

// 소프트 삭제 — deleted_at 만 찍고 30일 뒤 자동 영구 삭제
ipcMain.handle('notes:delete', (_e, id) => {
  const n = notes.find(x => x.id === id)
  if (!n) return { ok: false }
  n.deleted_at = Date.now()
  saveNotes()
  broadcastNotes()
  return { ok: true }
})

ipcMain.handle('notes:restore', (_e, id) => {
  const n = notes.find(x => x.id === id)
  if (!n) return { ok: false }
  delete n.deleted_at
  saveNotes()
  broadcastNotes()
  return { ok: true }
})

ipcMain.handle('notes:purge', (_e, id) => {
  notes = notes.filter(n => n.id !== id)
  saveNotes()
  broadcastNotes()
  return { ok: true }
})

/* ───────── 노트 백업·내보내기·불러오기 ───────── */

function notesBackupDir() {
  return path.join(app.getPath('userData'), 'notes-backups')
}

function backupNotesDaily() {
  try {
    const dir = notesBackupDir()
    fs.mkdirSync(dir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const file = path.join(dir, `notes-${today}.json`)
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(notes))
    }
    // 14일 넘은 백업 회전
    const all = fs.readdirSync(dir).filter(f => f.startsWith('notes-') && f.endsWith('.json'))
    if (all.length > 14) {
      all.sort()
      for (const f of all.slice(0, all.length - 14)) {
        try { fs.unlinkSync(path.join(dir, f)) } catch { /* ignore */ }
      }
    }
  } catch (err) {
    console.error('[oasis] notes backup failed:', err)
  }
}

function purgeExpiredDeletedNotes() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const before = notes.length
  notes = notes.filter(n => !n.deleted_at || n.deleted_at > cutoff)
  if (notes.length !== before) saveNotes()
}

ipcMain.handle('notes:export', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '노트 내보내기',
    defaultPath: `oasis-notes-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(notes, null, 2))
    return { ok: true, path: result.filePath, count: notes.length }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('notes:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '노트 가져오기',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths.length) return { canceled: true }
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8')
    const imported = JSON.parse(raw)
    if (!Array.isArray(imported)) throw new Error('JSON 배열이 아닙니다')
    let count = 0
    for (const n of imported) {
      if (!n || typeof n.body !== 'string') continue
      notes.unshift({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-imp${count}`,
        body: n.body,
        updatedAt: n.updatedAt || Date.now(),
        createdAt: n.createdAt || Date.now(),
      })
      count++
    }
    saveNotes()
    broadcastNotes()
    return { ok: true, count }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

/* ───────── 설치된 앱 검색 (Windows 시작메뉴) ───────── */

let installedAppsCache = null
let installedAppsCacheAt = 0

function startMenuRoots() {
  if (process.platform !== 'win32') return []
  return [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.ProgramData || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ].filter(Boolean)
}

async function walkLnks(dir, out, depth = 0) {
  if (depth > 3) return
  let entries
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      await walkLnks(full, out, depth + 1)
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.lnk')) {
      const lower = e.name.toLowerCase()
      // 설치 제거·복구 같은 보조 바로가기는 제외
      if (lower.includes('uninstall') || lower.includes('제거') || lower.includes('도움말') || lower.includes('help')) continue
      out.push({ name: path.basename(e.name, '.lnk'), path: full })
    }
  }
}

async function listInstalledApps() {
  // 60초 캐시
  if (installedAppsCache && Date.now() - installedAppsCacheAt < 60000) return installedAppsCache
  const out = []
  for (const dir of startMenuRoots()) {
    await walkLnks(dir, out)
  }
  // 중복 이름 제거 (전역 > 사용자별)
  const byName = new Map()
  for (const a of out) byName.set(a.name, a)
  const result = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  installedAppsCache = result
  installedAppsCacheAt = Date.now()
  return result
}

ipcMain.handle('launcher:list-apps', () => listInstalledApps())

/* ───────── 런처 (Oasis Launcher) ───────── */

let launcherTiles = []

function launcherFilePath() {
  return path.join(app.getPath('userData'), 'launcher-tiles.json')
}

function guessCategory(tile) {
  if (tile.category) return tile.category
  if (tile.type === 'url') return 'web'
  if (tile.type === 'folder') return 'tool'
  if (tile.type === 'file') return 'tool'
  return 'app'
}

function loadLauncherTiles() {
  try {
    const raw = fs.readFileSync(launcherFilePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      // 기존 v0.3.x 타일에 카테고리 마이그레이션
      launcherTiles = parsed.map(t => ({ ...t, category: guessCategory(t) }))
    }
  } catch { launcherTiles = [] }
}

function saveLauncherTiles() {
  try { fs.writeFileSync(launcherFilePath(), JSON.stringify(launcherTiles)) } catch { /* ignore */ }
}

function broadcastLauncher() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:update', launcherTiles)
  }
}

async function extractFileIcon(filePath) {
  try {
    // .lnk 는 자기 자신의 아이콘이 "파일+화살표" 일반 아이콘이므로
    // 가리키는 실제 .exe 를 풀어서 거기서 아이콘을 가져온다.
    let resolved = filePath
    if (process.platform === 'win32' && filePath.toLowerCase().endsWith('.lnk')) {
      try {
        const info = shell.readShortcutLink(filePath)
        // info.icon 이 별도 지정돼 있으면 그게 우선
        if (info?.icon) resolved = info.icon
        else if (info?.target) resolved = info.target
      } catch { /* lnk 파싱 실패 시 원본 경로로 폴백 */ }
    }
    const img = await app.getFileIcon(resolved, { size: 'large' })
    if (img && !img.isEmpty()) return img.toDataURL()
  } catch (err) {
    console.warn('[oasis] getFileIcon failed:', err.message)
  }
  return null
}

async function fetchFaviconDataUrl(url) {
  try {
    const u = new URL(url)
    const r = await fetch(`https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch { return null }
}

// 런처는 메인 앱의 탭. 별도 창 없음.
function showLauncher() { showMainWithTab('launcher') }

ipcMain.handle('launcher:list', () => launcherTiles)

ipcMain.handle('launcher:add', async (_e, draft) => {
  if (!draft || !draft.type || !draft.target) return { ok: false, error: 'invalid draft' }
  const tile = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: draft.type,
    title: draft.title || draft.target,
    target: draft.target,
    category: guessCategory(draft),
    createdAt: Date.now(),
  }
  if (draft.type === 'url') {
    tile.iconDataUrl = await fetchFaviconDataUrl(draft.target)
  } else {
    tile.iconDataUrl = await extractFileIcon(draft.target)
  }
  launcherTiles.push(tile)
  saveLauncherTiles()
  broadcastLauncher()
  return { ok: true, tile }
})

ipcMain.handle('launcher:update', async (_e, payload) => {
  const { id, patch } = payload || {}
  const idx = launcherTiles.findIndex(t => t.id === id)
  if (idx === -1) return { ok: false }
  // 대상 경로가 바뀌면 아이콘 갱신
  if (patch.target && patch.target !== launcherTiles[idx].target) {
    if ((patch.type || launcherTiles[idx].type) === 'url') {
      patch.iconDataUrl = await fetchFaviconDataUrl(patch.target)
    } else {
      patch.iconDataUrl = await extractFileIcon(patch.target)
    }
  }
  launcherTiles[idx] = { ...launcherTiles[idx], ...patch }
  saveLauncherTiles()
  broadcastLauncher()
  return { ok: true }
})

ipcMain.handle('launcher:delete', (_e, id) => {
  launcherTiles = launcherTiles.filter(t => t.id !== id)
  saveLauncherTiles()
  broadcastLauncher()
  return { ok: true }
})

ipcMain.handle('launcher:reorder', (_e, orderedIds) => {
  if (!Array.isArray(orderedIds)) return { ok: false }
  const map = new Map(launcherTiles.map(t => [t.id, t]))
  const reordered = orderedIds.map(id => map.get(id)).filter(Boolean)
  // 누락된 게 있으면 뒤에 붙임
  for (const t of launcherTiles) if (!orderedIds.includes(t.id)) reordered.push(t)
  launcherTiles = reordered
  saveLauncherTiles()
  broadcastLauncher()
  return { ok: true }
})

ipcMain.handle('launcher:launch', async (_e, id) => {
  const tile = launcherTiles.find(t => t.id === id)
  if (!tile) return { ok: false, error: 'tile not found' }
  try {
    if (tile.type === 'url') {
      await shell.openExternal(tile.target)
    } else {
      const errMsg = await shell.openPath(tile.target)
      if (errMsg) return { ok: false, error: errMsg }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
})

ipcMain.handle('launcher:pick-file', async () => {
  const result = await dialog.showOpenDialog(launcherWindow || mainWindow, {
    properties: ['openFile'],
    title: '런처에 추가할 앱/파일 선택',
    filters: [
      { name: '실행 파일·바로가기', extensions: ['exe', 'lnk', 'bat', 'cmd', 'msi'] },
      { name: '모든 파일', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePaths.length) return { canceled: true }
  const p = result.filePaths[0]
  const ext = path.extname(p).toLowerCase()
  const isApp = ['.exe', '.lnk', '.bat', '.cmd', '.msi'].includes(ext)
  return { canceled: false, path: p, type: isApp ? 'app' : 'file', name: path.basename(p, ext) }
})

ipcMain.handle('launcher:pick-folder', async () => {
  const result = await dialog.showOpenDialog(launcherWindow || mainWindow, {
    properties: ['openDirectory'],
    title: '런처에 추가할 폴더 선택',
  })
  if (result.canceled || !result.filePaths.length) return { canceled: true }
  const p = result.filePaths[0]
  return { canceled: false, path: p, name: path.basename(p) }
})

ipcMain.handle('launcher:dropped-paths', async (_e, paths) => {
  // 드래그앤드롭으로 들어온 경로들 — 일괄 등록
  if (!Array.isArray(paths)) return { added: [] }
  const added = []
  for (const p of paths) {
    if (typeof p !== 'string') continue
    try {
      const st = await fsp.stat(p)
      const ext = path.extname(p).toLowerCase()
      let type
      if (st.isDirectory()) type = 'folder'
      else if (['.exe', '.lnk', '.bat', '.cmd', '.msi'].includes(ext)) type = 'app'
      else type = 'file'
      const draft = {
        type,
        title: path.basename(p, ext) || p,
        target: p,
      }
      const tile = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...draft,
        iconDataUrl: await extractFileIcon(p),
        createdAt: Date.now(),
      }
      launcherTiles.push(tile)
      added.push(tile)
    } catch { /* skip unreachable */ }
  }
  if (added.length) {
    saveLauncherTiles()
    broadcastLauncher()
  }
  return { added }
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
    {
      label: '런처 열기 (Ctrl+Shift+L)',
      click: () => showLauncher(),
    },
    {
      label: '노트 (Ctrl+Shift+N)',
      click: () => showNotes(),
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
  const startHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#fafaf9',
    title: 'Office Oasis · 데스크톱 어시스턴트',
    autoHideMenuBar: true,
    show: !startHidden,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.loadURL(rendererURL())
  attachDevToolsShortcut(mainWindow)
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
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
  loadLauncherTiles()
  loadNotes()
  purgeExpiredDeletedNotes()
  backupNotesDaily()
  startClipboardPolling()
  createTray()
  createWindow()
  setupAutoUpdater()

  // 전역 단축키
  const ok1 = globalShortcut.register('CommandOrControl+Shift+V', () => toggleClipboardWindow())
  if (!ok1) console.error('[oasis] failed to register Ctrl+Shift+V')
  const ok2 = globalShortcut.register('CommandOrControl+Shift+L', () => showLauncher())
  if (!ok2) console.error('[oasis] failed to register Ctrl+Shift+L')
  const ok3 = globalShortcut.register('CommandOrControl+Shift+N', () => showNotes())
  if (!ok3) console.error('[oasis] failed to register Ctrl+Shift+N')

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
