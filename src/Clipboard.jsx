import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Pin, X, Trash2 } from 'lucide-react'

/* ───────── 유틸 ───────── */

function relativeTime(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 10) return '방금'
  if (sec < 60) return `${sec}초 전`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  return `${day}일 전`
}

function firstLine(text, max = 90) {
  const idx = text.indexOf('\n')
  const line = (idx === -1 ? text : text.slice(0, idx)).trimEnd()
  return line.length > max ? line.slice(0, max) + '…' : line
}

/* ───────── 메인 ───────── */

export default function ClipboardApp() {
  const [items, setItems] = useState([])
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  /* 초기 로드 + 실시간 구독 */
  useEffect(() => {
    if (!window.oasis?.isElectron) return
    window.oasis.clipboardList().then(setItems)
    const off = window.oasis.onClipboardUpdate(setItems)
    return off
  }, [])

  /* 매번 창이 보일 때 검색·선택 초기화하고 입력 포커스 */
  useEffect(() => {
    const handler = () => {
      setQuery('')
      setActiveIdx(0)
      if (inputRef.current) inputRef.current.focus()
    }
    handler()
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [])

  const filtered = useMemo(() => {
    if (!query) return items
    const q = query.toLowerCase()
    return items.filter((it) => it.text.toLowerCase().includes(q))
  }, [items, query])

  /* 키보드 네비게이션 (탭 안이라 Esc는 무시) */
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter' && e.target?.tagName !== 'TEXTAREA') {
        // 입력창 안에서 Enter 누를 때만 붙여넣기 동작 (포커스 안에서)
        if (document.activeElement === inputRef.current) {
          e.preventDefault()
          const item = filtered[activeIdx]
          if (item) window.oasis?.clipboardPaste(item.id)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [filtered, activeIdx])

  /* 활성 항목을 뷰포트에 유지 */
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  return (
    <div className="h-full w-full flex flex-col bg-stone-50 text-stone-900">
      <header className="px-8 py-5 border-b border-stone-200 bg-white shrink-0">
        <p className="eyebrow">클립보드</p>
        <h1 className="text-xl font-semibold tracking-tight mt-1">복사 히스토리</h1>
      </header>

      {/* 검색 바 */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-stone-200 bg-white">
        <Search className="w-4 h-4 text-stone-400 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0) }}
          placeholder="복사 기록 검색…"
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-stone-400"
          autoFocus
        />
        <span className="text-[10px] text-stone-400 tnum">{filtered.length}</span>
      </div>

      {/* 리스트 */}
      <div ref={listRef} className="flex-1 overflow-auto thin-scroll">
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-stone-400">
            {items.length === 0 ? '복사한 항목이 아직 없습니다' : '검색 결과 없음'}
          </div>
        ) : (
          <ul>
            {filtered.map((it, idx) => {
              const lineCount = it.text.split('\n').length
              const isActive = idx === activeIdx
              return (
                <li
                  key={it.id}
                  data-idx={idx}
                  onClick={() => window.oasis?.clipboardPaste(it.id)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={`group px-3 py-2 border-b border-stone-100 cursor-pointer ${isActive ? 'bg-stone-100' : 'hover:bg-stone-100/50'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-mono truncate">{firstLine(it.text)}</p>
                      <div className="flex items-center gap-2 text-[10px] text-stone-400 mt-0.5 tnum">
                        <span>{it.text.length.toLocaleString()}자</span>
                        {lineCount > 1 && <span>· {lineCount}행</span>}
                        <span className="ml-auto">{relativeTime(it.timestamp)}</span>
                      </div>
                    </div>
                    <div className={`flex items-center gap-0.5 shrink-0 ${isActive ? '' : 'opacity-0 group-hover:opacity-100'}`}>
                      <button
                        onClick={(e) => { e.stopPropagation(); window.oasis?.clipboardPin(it.id) }}
                        title={it.pinned ? '핀 해제' : '핀 고정'}
                        className={`p-1 rounded hover:bg-stone-200 ${it.pinned ? 'text-stone-900' : 'text-stone-400'}`}
                      >
                        <Pin className="w-3 h-3" fill={it.pinned ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); window.oasis?.clipboardDelete(it.id) }}
                        title="삭제"
                        className="p-1 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-900"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* 푸터 단축키 안내 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-stone-200 bg-white text-[10px] text-stone-500">
        <div className="flex items-center gap-3">
          <span><kbd className="font-mono">↑↓</kbd> 선택</span>
          <span><kbd className="font-mono">↵</kbd> 붙여넣기 (검색 포커스 시)</span>
        </div>
        <button
          onClick={() => window.oasis?.clipboardClear()}
          className="text-stone-400 hover:text-stone-900 flex items-center gap-1"
          title="히스토리 비우기 (핀 제외)"
        >
          <Trash2 className="w-3 h-3" /> 비우기
        </button>
      </div>
    </div>
  )
}
