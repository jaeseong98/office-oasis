import { useEffect, useMemo, useRef, useState, Suspense, lazy } from 'react'
import {
  Plus, Search, X,
  Star, Gamepad2, Globe, Wrench, Music, Sparkles,
  FolderOpen, FileText, MonitorPlay, Pencil, Box,
} from 'lucide-react'

// 3D 모드 켤 때만 Three.js 로드 (코드 스플리팅)
const Launcher3D = lazy(() => import('./Launcher3D.jsx'))

const VIEW_KEY = 'oasis:launcher-view'

/* ───────── 카테고리 — 라이트 테마에서도 잘 보이는 절제된 액센트 ───────── */

const CATEGORIES = [
  { id: 'all',      label: '전체',     color: '#a8a29e' },
  { id: 'favorite', label: '즐겨찾기', color: '#d97706', Icon: Star },
  { id: 'app',      label: '앱',       color: '#0284c7', Icon: MonitorPlay },
  { id: 'game',     label: '게임',     color: '#be123c', Icon: Gamepad2 },
  { id: 'web',      label: '웹',       color: '#1d4ed8', Icon: Globe },
  { id: 'tool',     label: '도구',     color: '#57534e', Icon: Wrench },
  { id: 'media',    label: '미디어',   color: '#047857', Icon: Music },
]

const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))

const TYPE_META = {
  app:    { label: '앱',     hint: '설치된 앱·.exe·.lnk',  Icon: MonitorPlay },
  url:    { label: 'URL',    hint: '웹 주소',               Icon: Globe },
  folder: { label: '폴더',   hint: '디렉터리',              Icon: FolderOpen },
  file:   { label: '파일',   hint: '단일 문서',             Icon: FileText },
}

/* ───────── 유틸 ───────── */

function pad(n) { return String(n).padStart(2, '0') }
function shortHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/* ───────── 메인 ───────── */

export default function LauncherApp() {
  const [tiles, setTiles] = useState([])
  const [activeCat, setActiveCat] = useState('all')
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(VIEW_KEY) || '2d')
  const now = useClock()
  const dropAreaRef = useRef(null)

  useEffect(() => { try { localStorage.setItem(VIEW_KEY, viewMode) } catch {} }, [viewMode])

  useEffect(() => {
    if (!window.oasis?.isElectron) return
    window.oasis.launcherList().then(setTiles)
    const off = window.oasis.onLauncherUpdate(setTiles)
    return off
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (showAdd || editing || contextMenu) {
          setShowAdd(false); setEditing(null); setContextMenu(null)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showAdd, editing, contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const off = () => setContextMenu(null)
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [contextMenu])

  const filtered = useMemo(() => {
    let arr = tiles
    if (activeCat !== 'all') arr = arr.filter(t => (t.category || 'app') === activeCat)
    if (query) {
      const q = query.toLowerCase()
      arr = arr.filter(t => t.title.toLowerCase().includes(q) || t.target.toLowerCase().includes(q))
    }
    return arr
  }, [tiles, activeCat, query])

  const counts = useMemo(() => {
    const m = { all: tiles.length }
    for (const c of CATEGORIES) if (c.id !== 'all') m[c.id] = 0
    for (const t of tiles) {
      const cid = t.category || 'app'
      m[cid] = (m[cid] || 0) + 1
    }
    return m
  }, [tiles])

  async function launch(tile) {
    setContextMenu(null)
    await window.oasis.launcherLaunch(tile.id)
  }

  async function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer?.files || [])
    const paths = files.map(f => f.path).filter(Boolean)
    if (paths.length) await window.oasis.launcherDroppedPaths(paths)
  }

  return (
    <div
      ref={dropAreaRef}
      className="h-full w-full bg-stone-50 text-stone-900 flex flex-col overflow-hidden"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={(e) => { if (!dropAreaRef.current?.contains(e.relatedTarget)) setDragOver(false) }}
      onDrop={handleDrop}
    >
      {/* 상단: 시계 + 카테고리 + 검색 + 추가 */}
      <header className="flex items-center gap-8 px-8 py-5 border-b border-stone-200 bg-white shrink-0">
        {/* 시계 */}
        <div className="tnum shrink-0">
          <p className="text-[36px] font-semibold leading-none tracking-tight tabular-nums">
            {pad(now.getHours())}:{pad(now.getMinutes())}
          </p>
          <p className="eyebrow mt-2">
            {now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
        </div>

        {/* 카테고리 탭 */}
        <div className="flex-1 flex items-center gap-1.5 overflow-x-auto thin-scroll">
          {CATEGORIES.map(cat => {
            const active = activeCat === cat.id
            const count = counts[cat.id] ?? 0
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCat(cat.id)}
                className={`shrink-0 px-3.5 py-1.5 text-xs font-medium transition flex items-center gap-1.5 border ${
                  active
                    ? 'bg-stone-900 text-white border-stone-900'
                    : 'text-stone-600 hover:text-stone-900 border-stone-200 hover:border-stone-400 bg-white'
                }`}
              >
                {cat.Icon && <cat.Icon className="w-3 h-3" />}
                {cat.label}
                <span className={`text-[10px] tnum ${active ? 'text-stone-400' : 'text-stone-400'}`}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* 검색 */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-stone-200 shrink-0">
          <Search className="w-3.5 h-3.5 text-stone-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색"
            className="text-sm bg-transparent outline-none placeholder:text-stone-400 w-32"
          />
        </div>

        <div className="flex items-center border border-stone-200 shrink-0">
          <button
            onClick={() => setViewMode('2d')}
            className={`px-2.5 py-1.5 text-xs ${viewMode === '2d' ? 'bg-stone-900 text-white' : 'text-stone-500 hover:text-stone-900'}`}
            title="2D 그리드"
          >
            2D
          </button>
          <button
            onClick={() => setViewMode('3d')}
            className={`px-2.5 py-1.5 text-xs flex items-center gap-1 border-l border-stone-200 ${viewMode === '3d' ? 'bg-stone-900 text-white' : 'text-stone-500 hover:text-stone-900'}`}
            title="3D 공간"
          >
            <Box className="w-3 h-3" /> 3D
          </button>
        </div>

        <button
          onClick={() => setShowAdd(true)}
          className="px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> 새 타일
        </button>
      </header>

      {/* 메인 그리드 — 2D 또는 3D */}
      <main className="flex-1 overflow-hidden relative">
        {tiles.length === 0 ? (
          <div className="h-full overflow-auto thin-scroll">
            <div className="max-w-7xl mx-auto px-10 py-10">
              <EmptyHint onAdd={() => setShowAdd(true)} />
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center text-stone-400">
            <p className="text-sm">{query ? '검색 결과 없음' : '이 카테고리에는 타일이 없습니다'}</p>
          </div>
        ) : viewMode === '3d' ? (
          <Suspense fallback={
            <div className="h-full flex items-center justify-center text-stone-400">
              <p className="text-sm">3D 엔진 로딩 중…</p>
            </div>
          }>
            <Launcher3D
              tiles={filtered}
              onLaunch={(t) => launch(t)}
              onContextMenu={(t, e) => setContextMenu({ x: e.clientX, y: e.clientY, tile: t })}
            />
          </Suspense>
        ) : (
          <div className="h-full overflow-auto thin-scroll">
            <div className="max-w-7xl mx-auto px-10 py-10">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
                {filtered.map((tile) => (
                  <Tile
                    key={tile.id}
                    tile={tile}
                    onLaunch={() => launch(tile)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, tile })
                    }}
                  />
                ))}
                <AddTile onClick={() => setShowAdd(true)} />
              </div>
            </div>
          </div>
        )}

        {dragOver && (
          <div className="fixed inset-6 border-2 border-dashed border-stone-900 bg-stone-100/80 backdrop-blur-sm pointer-events-none flex items-center justify-center z-10">
            <div className="text-center">
              <p className="text-xl font-semibold">여기에 놓으면 자동 추가</p>
              <p className="text-sm text-stone-500 mt-1.5">아이콘이 자동으로 추출됩니다</p>
            </div>
          </div>
        )}
      </main>

      {/* 컨텍스트 메뉴 */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white border border-stone-200 shadow-lg text-sm min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => launch(contextMenu.tile)}
            className="w-full text-left px-3 py-2 hover:bg-stone-100"
          >
            열기
          </button>
          <button
            onClick={() => { setEditing(contextMenu.tile); setContextMenu(null) }}
            className="w-full text-left px-3 py-2 hover:bg-stone-100 flex items-center gap-2"
          >
            <Pencil className="w-3 h-3" /> 편집
          </button>
          <div className="border-t border-stone-200 px-3 py-1.5 text-[10px] text-stone-400 uppercase tracking-wider">카테고리</div>
          {CATEGORIES.filter(c => c.id !== 'all').map(cat => (
            <button
              key={cat.id}
              onClick={async () => {
                const t = contextMenu.tile
                setContextMenu(null)
                await window.oasis.launcherUpdate(t.id, { category: cat.id })
              }}
              className={`w-full text-left px-3 py-1.5 hover:bg-stone-100 flex items-center gap-2 ${
                contextMenu.tile.category === cat.id ? 'text-stone-900 font-medium' : 'text-stone-600'
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: cat.color }} />
              {cat.label}
            </button>
          ))}
          <div className="border-t border-stone-200" />
          <button
            onClick={async () => {
              const t = contextMenu.tile
              setContextMenu(null)
              await window.oasis.launcherDelete(t.id)
            }}
            className="w-full text-left px-3 py-2 hover:bg-rose-50 text-rose-700"
          >
            삭제
          </button>
        </div>
      )}

      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}
      {editing && <EditModal tile={editing} onClose={() => setEditing(null)} />}

      {/* 푸터 단축키 힌트 */}
      <footer className="px-8 py-2 border-t border-stone-200 bg-white text-[10px] text-stone-400 tracking-wider flex items-center gap-5 shrink-0">
        <span>우클릭 편집·삭제·카테고리</span>
        <span>드래그&드롭으로 빠른 추가</span>
        <span className="ml-auto">Office Oasis Launcher</span>
      </footer>
    </div>
  )
}

/* ───────── 빈 상태 ───────── */

function EmptyHint({ onAdd }) {
  return (
    <div className="text-center py-24">
      <Sparkles className="w-10 h-10 mx-auto mb-4 text-stone-300" />
      <p className="text-2xl font-semibold tracking-tight">아직 타일이 없습니다</p>
      <p className="text-sm text-stone-500 mt-3">자주 쓰는 앱·폴더·웹사이트를 등록해서 한 곳에서 빠르게 여세요.</p>
      <p className="text-xs text-stone-400 mt-2">파일을 끌어다 놓아도 자동 등록됩니다.</p>
      <button
        onClick={onAdd}
        className="mt-7 px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium inline-flex items-center gap-2"
      >
        <Plus className="w-4 h-4" /> 첫 타일 추가하기
      </button>
    </div>
  )
}

/* ───────── 타일 ───────── */

function Tile({ tile, onLaunch, onContextMenu }) {
  const cat = CAT_BY_ID[tile.category] || CAT_BY_ID.app
  const Icon = TYPE_META[tile.type]?.Icon
  return (
    <button
      onClick={onLaunch}
      onContextMenu={onContextMenu}
      className="group relative aspect-square flex flex-col items-center justify-center p-4 border border-stone-200 bg-white hover:border-stone-400 hover:shadow-sm transition"
      title={tile.target}
    >
      {/* 카테고리 색 스트라이프 */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: cat.color }}
      />

      {/* 아이콘 */}
      <div className="w-14 h-14 mb-3 flex items-center justify-center">
        {tile.iconDataUrl ? (
          <img src={tile.iconDataUrl} alt="" className="w-14 h-14 object-contain" />
        ) : (
          <div
            className="w-14 h-14 flex items-center justify-center text-xl font-bold text-white"
            style={{ background: cat.color }}
          >
            {Icon ? <Icon className="w-7 h-7" strokeWidth={2} /> : (tile.title || '?').trim().charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <p className="text-sm font-semibold text-stone-900 line-clamp-2 text-center leading-tight w-full">
        {tile.title}
      </p>
      <p className="text-[10px] text-stone-400 mt-1 truncate w-full text-center">
        {tile.type === 'url' ? shortHost(tile.target) : cat.label}
      </p>
    </button>
  )
}

function AddTile({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="aspect-square border border-dashed border-stone-300 hover:border-stone-900 hover:bg-stone-100/60 transition flex flex-col items-center justify-center text-stone-400 hover:text-stone-900"
    >
      <Plus className="w-6 h-6 mb-1" strokeWidth={1.5} />
      <span className="text-xs">추가</span>
    </button>
  )
}

/* ───────── Add 모달 (앱 검색 포함) ───────── */

function AddModal({ onClose }) {
  const [type, setType] = useState('app')
  const [target, setTarget] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('app')
  const [submitting, setSubmitting] = useState(false)

  const [installedApps, setInstalledApps] = useState([])
  const [appQuery, setAppQuery] = useState('')
  const [loadingApps, setLoadingApps] = useState(false)

  useEffect(() => {
    if (type !== 'app') return
    if (installedApps.length > 0) return
    setLoadingApps(true)
    window.oasis?.launcherListApps()
      .then((list) => setInstalledApps(list || []))
      .finally(() => setLoadingApps(false))
  }, [type])

  const filteredApps = useMemo(() => {
    if (!appQuery.trim()) return installedApps.slice(0, 30)
    const q = appQuery.toLowerCase()
    return installedApps.filter(a => a.name.toLowerCase().includes(q)).slice(0, 30)
  }, [installedApps, appQuery])

  function pickFromList(app) {
    setTarget(app.path)
    setTitle(app.name)
  }

  async function pickFile() {
    const r = await window.oasis.launcherPickFile()
    if (!r.canceled) {
      setTarget(r.path); setType(r.type)
      if (!title) setTitle(r.name)
      setCategory(r.type === 'app' ? 'app' : 'tool')
    }
  }

  async function pickFolder() {
    const r = await window.oasis.launcherPickFolder()
    if (!r.canceled) { setTarget(r.path); if (!title) setTitle(r.name) }
  }

  async function save() {
    if (!target.trim() || !title.trim()) return
    let finalTarget = target.trim()
    if (type === 'url' && !/^https?:\/\//i.test(finalTarget)) finalTarget = 'https://' + finalTarget
    setSubmitting(true)
    try {
      const res = await window.oasis.launcherAdd({
        type, target: finalTarget, title: title.trim(), category,
      })
      if (res.ok) onClose()
    } finally {
      setSubmitting(false)
    }
  }

  function onTypeChange(k) {
    setType(k)
    setTarget('')
    setAppQuery('')
    if (k === 'url') setCategory('web')
    else if (k === 'folder') setCategory('tool')
    else if (k === 'app') setCategory('app')
    else setCategory('tool')
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center" onMouseDown={onClose}>
      <div className="bg-white border border-stone-200 shadow-xl max-w-lg w-full mx-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-3">
          <p className="eyebrow">새 타일</p>
          <h3 className="text-lg font-semibold mt-1.5">자주 쓰는 항목 추가</h3>
        </div>

        <div className="px-6 pb-4 space-y-4">
          {/* 종류 */}
          <div>
            <p className="text-xs text-stone-500 mb-2">종류</p>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(TYPE_META).map(([k, m]) => (
                <button
                  key={k}
                  onClick={() => onTypeChange(k)}
                  className={`py-2 text-xs border ${type === k ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 hover:border-stone-400'}`}
                >
                  <m.Icon className="w-4 h-4 mx-auto mb-1" strokeWidth={1.5} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 대상 */}
          {type === 'app' && (
            <div>
              <p className="text-xs text-stone-500 mb-1.5">설치된 앱 검색</p>
              <div className="flex items-center gap-2 px-3 py-2 bg-white border border-stone-200">
                <Search className="w-3.5 h-3.5 text-stone-400" />
                <input
                  value={appQuery}
                  onChange={(e) => setAppQuery(e.target.value)}
                  placeholder={loadingApps ? '시작메뉴 검색 중…' : '앱 이름…'}
                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-stone-400"
                  autoFocus
                />
              </div>
              <div className="mt-2 max-h-44 overflow-auto thin-scroll border border-stone-200">
                {filteredApps.length === 0 ? (
                  <p className="text-xs text-stone-400 py-4 text-center">
                    {loadingApps ? '로딩…' : (appQuery ? '검색 결과 없음' : '시작메뉴에 .lnk 없음')}
                  </p>
                ) : (
                  filteredApps.map((app) => {
                    const selected = target === app.path
                    return (
                      <button
                        key={app.path}
                        onClick={() => pickFromList(app)}
                        className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between hover:bg-stone-100 ${selected ? 'bg-stone-100 font-medium' : ''}`}
                      >
                        <span className="truncate">{app.name}</span>
                        {selected && <span className="text-[10px] text-stone-500 ml-2">선택됨</span>}
                      </button>
                    )
                  })
                )}
              </div>
              <button
                onClick={pickFile}
                className="mt-2 text-xs text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline"
              >
                또는 .exe 파일 직접 선택…
              </button>
            </div>
          )}

          {type === 'url' && (
            <div>
              <p className="text-xs text-stone-500 mb-1.5">웹 주소</p>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onBlur={() => { if (target && !title) setTitle(shortHost(target.startsWith('http') ? target : 'https://' + target)) }}
                placeholder="example.com 또는 https://…"
                className="w-full px-3 py-2 border border-stone-200 text-sm outline-none focus:border-stone-900"
                autoFocus
              />
            </div>
          )}

          {(type === 'folder' || type === 'file') && (
            <div>
              <p className="text-xs text-stone-500 mb-1.5">{TYPE_META[type].hint}</p>
              <div className="flex gap-2">
                <input
                  value={target}
                  readOnly
                  placeholder="아래 버튼으로 선택"
                  className="flex-1 px-3 py-2 border border-stone-200 text-sm bg-stone-50 truncate"
                />
                <button
                  onClick={type === 'folder' ? pickFolder : pickFile}
                  className="px-3 py-2 border border-stone-200 hover:border-stone-900 text-sm"
                >
                  찾아보기…
                </button>
              </div>
            </div>
          )}

          {/* 이름 */}
          <div>
            <p className="text-xs text-stone-500 mb-1.5">이름</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="타일에 표시될 이름"
              className="w-full px-3 py-2 border border-stone-200 text-sm outline-none focus:border-stone-900"
            />
          </div>

          {/* 카테고리 */}
          <div>
            <p className="text-xs text-stone-500 mb-2">카테고리</p>
            <div className="grid grid-cols-3 gap-1.5">
              {CATEGORIES.filter(c => c.id !== 'all').map(c => {
                const active = category === c.id
                return (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={`py-1.5 text-xs flex items-center justify-center gap-1.5 border ${active ? 'border-stone-900 bg-stone-100' : 'border-stone-200 hover:border-stone-400'}`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-stone-200 flex items-center justify-end gap-3">
          <button onClick={onClose} className="text-sm text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline">취소</button>
          <button
            onClick={save}
            disabled={!target.trim() || !title.trim() || submitting}
            className="px-4 py-2 bg-stone-900 hover:bg-stone-800 disabled:opacity-30 text-white text-sm"
          >
            {submitting ? '추가 중…' : '추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────── Edit 모달 ───────── */

function EditModal({ tile, onClose }) {
  const [title, setTitle] = useState(tile.title)
  const [target, setTarget] = useState(tile.target)
  const [category, setCategory] = useState(tile.category || 'app')

  async function save() {
    if (!title.trim() || !target.trim()) return
    await window.oasis.launcherUpdate(tile.id, {
      title: title.trim(),
      target: target.trim(),
      category,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center" onMouseDown={onClose}>
      <div className="bg-white border border-stone-200 shadow-xl max-w-md w-full mx-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-3">
          <p className="eyebrow">타일 편집</p>
          <h3 className="text-lg font-semibold mt-1.5">{tile.title}</h3>
        </div>
        <div className="px-6 pb-4 space-y-4">
          <div>
            <p className="text-xs text-stone-500 mb-1.5">이름</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 text-sm outline-none focus:border-stone-900"
              autoFocus
            />
          </div>
          <div>
            <p className="text-xs text-stone-500 mb-1.5">{TYPE_META[tile.type]?.hint || '대상'}</p>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 text-sm font-mono outline-none focus:border-stone-900"
            />
          </div>
          <div>
            <p className="text-xs text-stone-500 mb-2">카테고리</p>
            <div className="grid grid-cols-3 gap-1.5">
              {CATEGORIES.filter(c => c.id !== 'all').map(c => {
                const active = category === c.id
                return (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={`py-1.5 text-xs flex items-center justify-center gap-1.5 border ${active ? 'border-stone-900 bg-stone-100' : 'border-stone-200 hover:border-stone-400'}`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-stone-200 flex items-center justify-end gap-3">
          <button onClick={onClose} className="text-sm text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline">취소</button>
          <button onClick={save} className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm">저장</button>
        </div>
      </div>
    </div>
  )
}
