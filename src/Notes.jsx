import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, FileText } from 'lucide-react'

function getTitle(body) {
  if (!body) return ''
  const firstLine = body.split('\n').find(l => l.trim()) || ''
  return firstLine.trim().slice(0, 40)
}

function relativeTime(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return '방금'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  return `${Math.floor(hr / 24)}일 전`
}

export default function NotesApp() {
  const [notes, setNotes] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [body, setBody] = useState('')
  const saveTimerRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (!window.oasis?.isElectron) return
    window.oasis.notesList().then((list) => {
      setNotes(list)
      if (list[0]) {
        setActiveId(list[0].id)
        setBody(list[0].body || '')
      }
    })
    const off = window.oasis.onNotesUpdate((list) => {
      setNotes(list)
    })
    return off
  }, [])

  // 활성 노트 바뀔 때 body 동기화 (외부 변경 반영)
  useEffect(() => {
    const note = notes.find(n => n.id === activeId)
    if (note && note.body !== body) {
      setBody(note.body || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  function selectNote(id) {
    // 미저장분 즉시 flush
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      if (activeId) window.oasis?.notesSave(activeId, body)
    }
    setActiveId(id)
    const note = notes.find(n => n.id === id)
    setBody(note?.body || '')
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  function changeBody(text) {
    setBody(text)
    // 로컬 리스트의 미리보기도 즉시 갱신
    setNotes(prev => prev.map(n => n.id === activeId ? { ...n, body: text, updatedAt: Date.now() } : n))
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      window.oasis?.notesSave(activeId, text)
    }, 400)
  }

  async function createNew() {
    const note = await window.oasis?.notesCreate()
    if (note) {
      setNotes(prev => [note, ...prev.filter(n => n.id !== note.id)])
      setActiveId(note.id)
      setBody('')
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  async function deleteNote(id, e) {
    e?.stopPropagation()
    if (!window.confirm('이 노트를 삭제할까요?')) return
    await window.oasis?.notesDelete(id)
    setNotes(prev => {
      const next = prev.filter(n => n.id !== id)
      if (activeId === id) {
        const nextActive = next[0]
        setActiveId(nextActive?.id ?? null)
        setBody(nextActive?.body || '')
      }
      return next
    })
  }

  const sortedNotes = useMemo(
    () => notes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [notes],
  )

  return (
    <div className="h-full w-full flex flex-col bg-stone-50 text-stone-900">
      <div className="flex-1 flex overflow-hidden">
        {/* 사이드바 */}
        <aside className="w-56 border-r border-stone-200 flex flex-col bg-white shrink-0">
          <button
            onClick={createNew}
            className="m-2 px-3 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> 새 노트
          </button>
          <ul className="flex-1 overflow-auto thin-scroll">
            {sortedNotes.length === 0 && (
              <li className="text-center text-xs text-stone-400 py-8">노트 없음</li>
            )}
            {sortedNotes.map((n) => {
              const title = getTitle(n.body) || '(빈 노트)'
              const isActive = n.id === activeId
              return (
                <li
                  key={n.id}
                  onClick={() => selectNote(n.id)}
                  className={`group px-3 py-2.5 border-b border-stone-100 cursor-pointer ${
                    isActive ? 'bg-stone-100' : 'hover:bg-stone-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm truncate ${title === '(빈 노트)' ? 'text-stone-400 italic' : 'text-stone-900'}`}>
                        {title}
                      </p>
                      <p className="text-[10px] text-stone-400 mt-0.5">
                        {relativeTime(n.updatedAt)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => deleteNote(n.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-rose-600 shrink-0"
                      title="삭제"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </aside>

        {/* 에디터 */}
        <main className="flex-1 flex flex-col">
          {activeId ? (
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => changeBody(e.target.value)}
              placeholder="여기에 입력…"
              className="flex-1 px-8 py-6 text-sm leading-relaxed bg-transparent outline-none resize-none font-mono text-stone-900 placeholder:text-stone-300"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-stone-400">
              <div className="text-center">
                <FileText className="w-10 h-10 mx-auto mb-3 text-stone-300" />
                <p className="text-sm">왼쪽에서 노트를 선택하거나</p>
                <button onClick={createNew} className="mt-3 text-sm text-stone-900 underline underline-offset-4">
                  새 노트 만들기
                </button>
              </div>
            </div>
          )}
          {activeId && (
            <div className="px-8 py-2 border-t border-stone-200 bg-white text-[11px] text-stone-400 tnum flex justify-between">
              <span>{body.length.toLocaleString()}자 · {body.split('\n').length}행</span>
              <span>자동 저장됨</span>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
