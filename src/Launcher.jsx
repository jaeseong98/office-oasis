import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Search, X, Maximize2, Minimize2,
  Star, Gamepad2, Globe, Wrench, Music, Sparkles,
  FolderOpen, FileText, MonitorPlay, Pencil,
} from 'lucide-react'

/* ───────── 카테고리 ───────── */

const CATEGORIES = [
  { id: 'all',      label: '전체',     color: '#94a3b8' },
  { id: 'favorite', label: '즐겨찾기', color: '#f59e0b', Icon: Star },
  { id: 'app',      label: '앱',       color: '#06b6d4', Icon: MonitorPlay },
  { id: 'game',     label: '게임',     color: '#ec4899', Icon: Gamepad2 },
  { id: 'web',      label: '웹',       color: '#3b82f6', Icon: Globe },
  { id: 'tool',     label: '도구',     color: '#a3a3a3', Icon: Wrench },
  { id: 'media',    label: '미디어',   color: '#10b981', Icon: Music },
]

const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]))

const TYPE_META = {
  app:    { label: '앱',     hint: '실행 파일·바로가기',     Icon: MonitorPlay },
  url:    { label: 'URL',    hint: '웹 주소',                 Icon: Globe },
  folder: { label: '폴더',   hint: '디렉터리',                Icon: FolderOpen },
  file:   { label: '파일',   hint: '단일 문서',               Icon: FileText },
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
  const [isFullscreen, setIsFullscreen] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const now = useClock()
  const dropAreaRef = useRef(null)

  /* IPC 구독 */
  useEffect(() => {
    if (!window.oasis?.isElectron) return
    window.oasis.launcherList().then(setTiles)
    const off = window.oasis.onLauncherUpdate(setTiles)
    window.oasis.launcherIsFullscreen?.().then(setIsFullscreen)
    return off
  }, [])

  /* 키보드 */
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (showAdd || editing || contextMenu) {
          setShowAdd(false); setEditing(null); setContextMenu(null)
        } else {
          window.oasis?.launcherHide()
        }
      } else if (e.key === 'F11') {
        e.preventDefault()
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showAdd, editing, contextMenu])

  /* 컨텍스트 메뉴 바깥 클릭 */
  useEffect(() => {
    if (!contextMenu) return
    const off = () => setContextMenu(null)
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [contextMenu])

  async function toggleFullscreen() {
    await window.oasis?.launcherToggleFullscreen()
    const v = await window.oasis?.launcherIsFullscreen()
    setIsFullscreen(!!v)
  }

  const filtered = useMemo(() => {
    let arr = tiles
    if (activeCat !== 'all') {
      arr = arr.filter(t => (t.category || 'app') === activeCat)
    }
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
      className="h-screen w-screen text-white select-none flex flex-col overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, rgba(10,12,22,0.92) 0%, rgba(18,16,38,0.92) 50%, rgba(8,12,28,0.92) 100%)',
      }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={(e) => { if (!dropAreaRef.current?.contains(e.relatedTarget)) setDragOver(false) }}
      onDrop={handleDrop}
    >
      {/* 상단: 시계 + 카테고리 + 검색 + 창 제어 */}
      <header className="flex items-center gap-8 px-8 py-5 border-b border-white/[0.08] backdrop-blur-md">
        {/* 시계 */}
        <div className="tnum shrink-0">
          <p className="text-4xl font-bold leading-none tracking-tight">
            {pad(now.getHours())}:{pad(now.getMinutes())}
          </p>
          <p className="text-[11px] text-white/40 mt-1.5 tracking-wider uppercase">
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
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition flex items-center gap-1.5 ${
                  active
                    ? 'bg-white text-stone-900'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
                style={active ? {} : { borderColor: 'transparent' }}
              >
                {cat.Icon && <cat.Icon className="w-3 h-3" />}
                {cat.label}
                <span className={`text-[10px] tnum ${active ? 'text-stone-500' : 'text-white/40'}`}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* 검색 */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.06] border border-white/10 rounded-md shrink-0">
          <Search className="w-3.5 h-3.5 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색"
            className="text-sm bg-transparent outline-none placeholder:text-white/30 w-36 text-white"
          />
        </div>

        {/* 창 제어 */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 bg-white text-stone-900 hover:bg-stone-100 text-xs font-medium rounded flex items-center gap-1.5 mr-2"
          >
            <Plus className="w-3.5 h-3.5" /> 새 타일
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded"
            title="F11"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => window.oasis?.launcherHide()}
            className="p-2 text-white/50 hover:text-white hover:bg-rose-500/30 rounded"
            title="Esc"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 메인 그리드 */}
      <main className="flex-1 overflow-auto thin-scroll">
        <div className="max-w-7xl mx-auto px-10 py-10">
          {tiles.length === 0 ? (
            <EmptyHint onAdd={() => setShowAdd(true)} />
          ) : filtered.length === 0 ? (
            <div className="text-center py-24 text-white/40">
              <p className="text-sm">{query ? '검색 결과 없음' : '이 카테고리에는 타일이 없습니다'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4">
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
          )}
        </div>

        {/* 드롭 오버레이 */}
        {dragOver && (
          <div className="fixed inset-6 border-2 border-dashed border-white/40 bg-black/40 backdrop-blur pointer-events-none flex items-center justify-center rounded-2xl">
            <div className="text-center">
              <p className="text-xl font-semibold">여기에 놓으면 자동 추가</p>
              <p className="text-sm text-white/50 mt-1.5">아이콘이 자동으로 추출됩니다</p>
            </div>
          </div>
        )}
      </main>

      {/* 컨텍스트 메뉴 */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-stone-900/95 backdrop-blur border border-white/10 shadow-2xl text-sm min-w-[180px] rounded-md overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => launch(contextMenu.tile)}
            className="w-full text-left px-3 py-2 hover:bg-white/10"
          >
            열기
          </button>
          <button
            onClick={() => { setEditing(contextMenu.tile); setContextMenu(null) }}
            className="w-full text-left px-3 py-2 hover:bg-white/10 flex items-center gap-2"
          >
            <Pencil className="w-3 h-3" /> 편집
          </button>
          <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-white/40 uppercase tracking-wider">카테고리</div>
          {CATEGORIES.filter(c => c.id !== 'all').map(cat => (
            <button
              key={cat.id}
              onClick={async () => {
                const t = contextMenu.tile
                setContextMenu(null)
                await window.oasis.launcherUpdate(t.id, { category: cat.id })
              }}
              className={`w-full text-left px-3 py-1.5 hover:bg-white/10 flex items-center gap-2 ${
                contextMenu.tile.category === cat.id ? 'text-white' : 'text-white/70'
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: cat.color }} />
              {cat.label}
            </button>
          ))}
          <div className="border-t border-white/10" />
          <button
            onClick={async () => {
              const t = contextMenu.tile
              setContextMenu(null)
              await window.oasis.launcherDelete(t.id)
            }}
            className="w-full text-left px-3 py-2 hover:bg-rose-500/30 text-rose-300"
          >
            삭제
          </button>
        </div>
      )}

      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}
      {editing && <EditModal tile={editing} onClose={() => setEditing(null)} />}

      {/* 하단 단축키 힌트 */}
      <footer className="px-8 py-2 border-t border-white/[0.08] text-[10px] text-white/30 tracking-wider flex items-center gap-5">
        <span>F11 풀스크린 전환</span>
        <span>Esc 닫기</span>
        <span>우클릭 편집·삭제·카테고리</span>
        <span className="ml-auto">Office Oasis Launcher</span>
      </footer>
    </div>
  )
}

/* ───────── 빈 상태 ───────── */

function EmptyHint({ onAdd }) {
  return (
    <div className="text-center py-24">
      <Sparkles className="w-12 h-12 mx-auto mb-4 text-white/30" />
      <p className="text-2xl font-semibold tracking-tight">아직 타일이 없습니다</p>
      <p className="text-sm text-white/40 mt-3">자주 쓰는 앱·폴더·웹사이트를 등록해서 한 곳에서 빠르게 여세요.</p>
      <p className="text-xs text-white/30 mt-2">파일을 끌어다 놓아도 자동 등록됩니다.</p>
      <button
        onClick={onAdd}
        className="mt-7 px-5 py-2.5 bg-white text-stone-900 hover:bg-stone-100 text-sm font-medium rounded inline-flex items-center gap-2"
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
      className="group relative aspect-square flex flex-col items-center justify-center p-4 rounded-xl border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.10] hover:border-white/20 transition shadow-lg"
      title={tile.target}
    >
      {/* 카테고리 스트라이프 */}
      <div
        className="absolute top-0 left-0 right-0 h-1 rounded-t-xl opacity-70 group-hover:opacity-100 transition"
        style={{ background: cat.color }}
      />

      {/* 아이콘 */}
      <div className="w-14 h-14 mb-3 flex items-center justify-center">
        {tile.iconDataUrl ? (
          <img src={tile.iconDataUrl} alt="" className="w-14 h-14 object-contain drop-shadow-lg" />
        ) : (
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-xl font-bold text-white shadow-lg"
            style={{ background: cat.color }}
          >
            {Icon ? <Icon className="w-7 h-7" strokeWidth={2} /> : (tile.title || '?').trim().charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <p className="text-sm font-semibold text-white line-clamp-2 text-center leading-tight w-full">
        {tile.title}
      </p>
      <p className="text-[10px] text-white/40 mt-1 truncate w-full text-center">
        {tile.type === 'url' ? shortHost(tile.target) : cat.label}
      </p>
    </button>
  )
}

function AddTile({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="aspect-square border border-dashed border-white/15 hover:border-white/40 hover:bg-white/[0.04] transition flex flex-col items-center justify-center text-white/30 hover:text-white/70 rounded-xl"
    >
      <Plus className="w-7 h-7 mb-1.5" strokeWidth={1.5} />
      <span className="text-xs">추가</span>
    </button>
  )
}

/* ───────── Add 모달 ───────── */

function AddModal({ onClose }) {
  const [type, setType] = useState('app')
  const [target, setTarget] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('app')
  const [submitting, setSubmitting] = useState(false)

  async function pick() {
    if (type === 'folder') {
      const r = await window.oasis.launcherPickFolder()
      if (!r.canceled) { setTarget(r.path); if (!title) setTitle(r.name) }
    } else if (type === 'app' || type === 'file') {
      const r = await window.oasis.launcherPickFile()
      if (!r.canceled) {
        setTarget(r.path); setType(r.type)
        if (!title) setTitle(r.name)
        // 자동 카테고리 추정
        if (r.type === 'app') setCategory('app')
        else setCategory('tool')
      }
    }
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
    // 종류에 따라 기본 카테고리
    if (k === 'url') setCategory('web')
    else if (k === 'folder') setCategory('tool')
    else if (k === 'app') setCategory('app')
    else setCategory('tool')
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur flex items-center justify-center" onMouseDown={onClose}>
      <div className="bg-stone-900 border border-white/10 shadow-2xl max-w-md w-full mx-4 rounded-md" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-3">
          <p className="text-[11px] uppercase tracking-wider text-white/40 font-medium">새 타일</p>
          <h3 className="text-lg font-semibold mt-1.5 text-white">자주 쓰는 항목 추가</h3>
        </div>

        <div className="px-6 pb-4 space-y-4">
          {/* 종류 */}
          <div>
            <p className="text-xs text-white/50 mb-2">종류</p>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(TYPE_META).map(([k, m]) => (
                <button
                  key={k}
                  onClick={() => onTypeChange(k)}
                  className={`py-2 text-xs border rounded ${type === k ? 'border-white bg-white text-stone-900' : 'border-white/10 text-white/70 hover:border-white/40'}`}
                >
                  <m.Icon className="w-4 h-4 mx-auto mb-1" strokeWidth={1.5} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 대상 */}
          <div>
            <p className="text-xs text-white/50 mb-1.5">{TYPE_META[type].hint}</p>
            {type === 'url' ? (
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onBlur={() => { if (target && !title) setTitle(shortHost(target.startsWith('http') ? target : 'https://' + target)) }}
                placeholder="example.com 또는 https://…"
                className="w-full px-3 py-2 bg-white/5 border border-white/10 text-sm outline-none focus:border-white/40 text-white rounded"
                autoFocus
              />
            ) : (
              <div className="flex gap-2">
                <input
                  value={target}
                  readOnly
                  placeholder="아래 버튼으로 선택"
                  className="flex-1 px-3 py-2 bg-white/5 border border-white/10 text-sm truncate text-white/80 rounded"
                />
                <button onClick={pick} className="px-3 py-2 border border-white/20 hover:border-white text-sm text-white rounded">
                  찾아보기…
                </button>
              </div>
            )}
          </div>

          {/* 이름 */}
          <div>
            <p className="text-xs text-white/50 mb-1.5">이름</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="타일에 표시될 이름"
              className="w-full px-3 py-2 bg-white/5 border border-white/10 text-sm outline-none focus:border-white/40 text-white rounded"
            />
          </div>

          {/* 카테고리 */}
          <div>
            <p className="text-xs text-white/50 mb-2">카테고리</p>
            <div className="grid grid-cols-3 gap-1.5">
              {CATEGORIES.filter(c => c.id !== 'all').map(c => {
                const active = category === c.id
                return (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={`py-1.5 text-xs rounded flex items-center justify-center gap-1.5 border ${active ? 'border-white bg-white/10 text-white' : 'border-white/10 text-white/70 hover:border-white/30'}`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-3">
          <button onClick={onClose} className="text-sm text-white/60 hover:text-white">취소</button>
          <button
            onClick={save}
            disabled={!target.trim() || !title.trim() || submitting}
            className="px-4 py-2 bg-white text-stone-900 hover:bg-stone-100 disabled:opacity-30 text-sm rounded"
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
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur flex items-center justify-center" onMouseDown={onClose}>
      <div className="bg-stone-900 border border-white/10 shadow-2xl max-w-md w-full mx-4 rounded-md" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-3">
          <p className="text-[11px] uppercase tracking-wider text-white/40 font-medium">타일 편집</p>
          <h3 className="text-lg font-semibold mt-1.5 text-white">{tile.title}</h3>
        </div>
        <div className="px-6 pb-4 space-y-4">
          <div>
            <p className="text-xs text-white/50 mb-1.5">이름</p>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 text-sm outline-none focus:border-white/40 text-white rounded"
              autoFocus
            />
          </div>
          <div>
            <p className="text-xs text-white/50 mb-1.5">{TYPE_META[tile.type]?.hint || '대상'}</p>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 text-sm font-mono outline-none focus:border-white/40 text-white rounded"
            />
          </div>
          <div>
            <p className="text-xs text-white/50 mb-2">카테고리</p>
            <div className="grid grid-cols-3 gap-1.5">
              {CATEGORIES.filter(c => c.id !== 'all').map(c => {
                const active = category === c.id
                return (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={`py-1.5 text-xs rounded flex items-center justify-center gap-1.5 border ${active ? 'border-white bg-white/10 text-white' : 'border-white/10 text-white/70 hover:border-white/30'}`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-3">
          <button onClick={onClose} className="text-sm text-white/60 hover:text-white">취소</button>
          <button onClick={save} className="px-4 py-2 bg-white text-stone-900 hover:bg-stone-100 text-sm rounded">저장</button>
        </div>
      </div>
    </div>
  )
}
