import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, X, FolderOpen, Globe, FileText, MonitorPlay, Pencil } from 'lucide-react'

/* ───────── 유틸 ───────── */

const TYPE_META = {
  app:    { label: '앱',     hint: '실행 파일·바로가기', Icon: MonitorPlay },
  url:    { label: 'URL',    hint: '웹 주소',           Icon: Globe },
  folder: { label: '폴더',   hint: '디렉터리',           Icon: FolderOpen },
  file:   { label: '파일',   hint: '단일 문서',          Icon: FileText },
}

function shortHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function tilePrettyTarget(tile) {
  if (tile.type === 'url') return shortHost(tile.target)
  const segs = tile.target.split(/[\\/]/)
  return segs[segs.length - 1] || tile.target
}

/* ───────── 메인 ───────── */

export default function LauncherApp() {
  const [tiles, setTiles] = useState([])
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null) // tile object
  const [contextMenu, setContextMenu] = useState(null) // { x, y, tile }
  const [dragOver, setDragOver] = useState(false)
  const dropAreaRef = useRef(null)

  useEffect(() => {
    if (!window.oasis?.isElectron) return
    window.oasis.launcherList().then(setTiles)
    const off = window.oasis.onLauncherUpdate(setTiles)
    return off
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        setShowAdd(false)
        setEditing(null)
        setContextMenu(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const off = () => setContextMenu(null)
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [contextMenu])

  const filtered = useMemo(() => {
    if (!query) return tiles
    const q = query.toLowerCase()
    return tiles.filter(t => t.title.toLowerCase().includes(q) || t.target.toLowerCase().includes(q))
  }, [tiles, query])

  async function launch(tile) {
    setContextMenu(null)
    await window.oasis.launcherLaunch(tile.id)
  }

  async function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer?.files || [])
    if (!files.length) return
    const paths = files.map(f => f.path).filter(Boolean)
    if (paths.length) await window.oasis.launcherDroppedPaths(paths)
  }

  return (
    <div
      className="h-screen w-screen flex flex-col bg-stone-50 text-stone-900"
      ref={dropAreaRef}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={(e) => { if (!dropAreaRef.current?.contains(e.relatedTarget)) setDragOver(false) }}
      onDrop={handleDrop}
    >
      {/* HEADER */}
      <header className="px-8 py-5 border-b border-stone-200 bg-white shrink-0">
        <div className="flex items-end justify-between max-w-5xl mx-auto">
          <div>
            <p className="eyebrow">Launcher</p>
            <h1 className="text-xl font-semibold tracking-tight mt-1">자주 쓰는 도구</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 border border-stone-200 bg-white">
              <Search className="w-3.5 h-3.5 text-stone-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="검색…"
                className="text-sm bg-transparent outline-none placeholder:text-stone-400 w-32"
              />
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white text-xs flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> 새 타일
            </button>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="flex-1 overflow-auto thin-scroll relative">
        <div className="max-w-5xl mx-auto px-8 py-10">
          {filtered.length === 0 && tiles.length === 0 && (
            <EmptyHint onAdd={() => setShowAdd(true)} />
          )}
          {filtered.length === 0 && tiles.length > 0 && (
            <p className="text-center text-sm text-stone-400 py-16">검색 결과 없음</p>
          )}
          {filtered.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
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
          <div className="fixed inset-4 border-2 border-dashed border-stone-900 bg-stone-100/80 backdrop-blur-sm pointer-events-none flex items-center justify-center">
            <div className="text-center">
              <p className="text-lg font-semibold">여기에 놓으면 자동 추가</p>
              <p className="text-sm text-stone-500 mt-1">앱·바로가기·폴더·파일 모두 가능</p>
            </div>
          </div>
        )}
      </main>

      {/* 컨텍스트 메뉴 */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white border border-stone-200 shadow-lg text-sm min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => launch(contextMenu.tile)}
            className="w-full text-left px-3 py-1.5 hover:bg-stone-100"
          >
            열기
          </button>
          <button
            onClick={() => { setEditing(contextMenu.tile); setContextMenu(null) }}
            className="w-full text-left px-3 py-1.5 hover:bg-stone-100 flex items-center gap-2"
          >
            <Pencil className="w-3 h-3" /> 이름 변경
          </button>
          <button
            onClick={async () => {
              setContextMenu(null)
              await window.oasis.launcherDelete(contextMenu.tile.id)
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-rose-50 text-rose-700"
          >
            삭제
          </button>
        </div>
      )}

      {/* Add 모달 */}
      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}

      {/* Edit 모달 */}
      {editing && <EditModal tile={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/* ───────── 빈 상태 ───────── */

function EmptyHint({ onAdd }) {
  return (
    <div className="text-center py-24">
      <p className="text-2xl font-semibold tracking-tight">아직 타일이 없습니다.</p>
      <p className="text-sm text-stone-500 mt-3">자주 쓰는 앱·폴더·웹사이트를 등록해 두면 한 곳에서 빠르게 열 수 있습니다.</p>
      <p className="text-xs text-stone-400 mt-2">파일·폴더를 이 창 위로 끌어다 놓아도 자동 등록됩니다.</p>
      <button
        onClick={onAdd}
        className="mt-6 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm inline-flex items-center gap-2"
      >
        <Plus className="w-4 h-4" /> 첫 타일 추가하기
      </button>
    </div>
  )
}

/* ───────── 타일 ───────── */

function Tile({ tile, onLaunch, onContextMenu }) {
  const meta = TYPE_META[tile.type] || TYPE_META.file
  return (
    <button
      onClick={onLaunch}
      onContextMenu={onContextMenu}
      className="group bg-white border border-stone-200 hover:border-stone-400 transition flex flex-col items-center p-4 text-left aspect-square"
      title={tile.target}
    >
      <div className="w-12 h-12 flex items-center justify-center mb-3">
        {tile.iconDataUrl ? (
          <img src={tile.iconDataUrl} alt="" className="w-12 h-12 object-contain" />
        ) : (
          <FallbackIcon title={tile.title} Icon={meta.Icon} />
        )}
      </div>
      <p className="text-sm font-medium text-stone-900 line-clamp-2 text-center leading-tight w-full">{tile.title}</p>
      <p className="text-[10px] text-stone-400 mt-1 truncate w-full text-center">{tilePrettyTarget(tile)}</p>
    </button>
  )
}

function FallbackIcon({ title, Icon }) {
  const ch = (title || '?').trim().charAt(0).toUpperCase()
  if (Icon) return <Icon className="w-8 h-8 text-stone-600" strokeWidth={1.5} />
  return (
    <div className="w-12 h-12 bg-stone-200 flex items-center justify-center text-lg font-semibold text-stone-700">
      {ch}
    </div>
  )
}

function AddTile({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="aspect-square border border-dashed border-stone-300 hover:border-stone-900 hover:bg-stone-100/40 transition flex flex-col items-center justify-center text-stone-400 hover:text-stone-900"
    >
      <Plus className="w-6 h-6 mb-1" />
      <span className="text-xs">추가</span>
    </button>
  )
}

/* ───────── Add 모달 ───────── */

function AddModal({ onClose }) {
  const [type, setType] = useState('app')
  const [target, setTarget] = useState('')
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function pick() {
    if (type === 'folder') {
      const r = await window.oasis.launcherPickFolder()
      if (!r.canceled) {
        setTarget(r.path)
        if (!title) setTitle(r.name)
      }
    } else if (type === 'app' || type === 'file') {
      const r = await window.oasis.launcherPickFile()
      if (!r.canceled) {
        setTarget(r.path)
        setType(r.type) // 자동 보정 (.exe → app, 그 외 → file)
        if (!title) setTitle(r.name)
      }
    }
  }

  async function save() {
    if (!target.trim()) return
    if (!title.trim()) return
    let finalTarget = target.trim()
    if (type === 'url' && !/^https?:\/\//i.test(finalTarget)) {
      finalTarget = 'https://' + finalTarget
    }
    setSubmitting(true)
    try {
      const res = await window.oasis.launcherAdd({ type, target: finalTarget, title: title.trim() })
      if (res.ok) onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onMouseDown={onClose}>
      <div className="bg-white border border-stone-200 shadow-xl max-w-md w-full mx-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-3">
          <p className="eyebrow">새 타일</p>
          <h3 className="text-lg font-semibold mt-1.5">자주 쓰는 항목 추가</h3>
        </div>

        <div className="px-6 pb-4 space-y-4">
          {/* 종류 선택 */}
          <div>
            <p className="text-xs text-stone-500 mb-2">종류</p>
            <div className="grid grid-cols-4 gap-1.5">
              {Object.entries(TYPE_META).map(([k, m]) => (
                <button
                  key={k}
                  onClick={() => { setType(k); setTarget(''); }}
                  className={`py-2 text-xs border ${type === k ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 hover:border-stone-400'}`}
                >
                  <m.Icon className="w-4 h-4 mx-auto mb-1" strokeWidth={1.5} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 대상 */}
          <div>
            <p className="text-xs text-stone-500 mb-1.5">{TYPE_META[type].hint}</p>
            {type === 'url' ? (
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onBlur={() => { if (target && !title) setTitle(shortHost(target.startsWith('http') ? target : 'https://' + target)) }}
                placeholder="example.com 또는 https://…"
                className="w-full px-3 py-2 border border-stone-200 text-sm outline-none focus:border-stone-900"
                autoFocus
              />
            ) : (
              <div className="flex gap-2">
                <input
                  value={target}
                  readOnly
                  placeholder="아래 버튼으로 선택"
                  className="flex-1 px-3 py-2 border border-stone-200 text-sm bg-stone-50 truncate"
                />
                <button onClick={pick} className="px-3 py-2 border border-stone-200 hover:border-stone-900 text-sm">
                  찾아보기…
                </button>
              </div>
            )}
          </div>

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
        </div>

        <div className="px-6 py-4 border-t border-stone-200 flex items-center justify-end gap-3">
          <button onClick={onClose} className="text-sm text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline">
            취소
          </button>
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

  async function save() {
    if (!title.trim() || !target.trim()) return
    await window.oasis.launcherUpdate(tile.id, {
      title: title.trim(),
      target: target.trim(),
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onMouseDown={onClose}>
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
              className="w-full px-3 py-2 border border-stone-200 text-sm outline-none focus:border-stone-900 font-mono"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-stone-200 flex items-center justify-end gap-3">
          <button onClick={onClose} className="text-sm text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline">
            취소
          </button>
          <button onClick={save} className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm">
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
