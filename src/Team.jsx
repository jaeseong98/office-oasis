import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Users, Copy, Check, LogOut, FileText, Crown, Eye } from 'lucide-react'
import { supabase, ensureAuthSession } from './supabaseClient.js'

const LOCAL_KEY = 'oasis:team-state-v1'  // { workspaceId, nickname }

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') } catch { return {} }
}
function saveLocal(state) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

function relativeTime(ts) {
  if (!ts) return ''
  const ms = Date.now() - new Date(ts).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return '방금'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  return `${Math.floor(hr / 24)}일 전`
}

export default function TeamApp() {
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState(null)
  const [userId, setUserId] = useState(null)
  const [state, setState] = useState(() => loadLocal())  // {workspaceId, nickname}

  // 익명 세션 확보
  useEffect(() => {
    ensureAuthSession()
      .then((session) => {
        setUserId(session.user.id)
        setAuthReady(true)
      })
      .catch((err) => {
        setAuthError(err.message || String(err))
        setAuthReady(true)
      })
  }, [])

  function leaveWorkspace() {
    saveLocal({})
    setState({})
  }

  function enterWorkspace(workspaceId, nickname) {
    const s = { workspaceId, nickname }
    saveLocal(s)
    setState(s)
  }

  if (!authReady) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-400">접속 중…</p>
      </div>
    )
  }
  if (authError) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-stone-50">
        <div className="max-w-md text-center text-sm">
          <p className="text-stone-900 font-medium">팀 서버에 연결할 수 없습니다</p>
          <p className="text-stone-500 mt-2 font-mono text-xs">{authError}</p>
          <p className="text-stone-500 mt-4 text-xs">Supabase 마이그레이션이 끝났는지, Anonymous Sign-in이 활성화 되어 있는지 확인하세요.</p>
        </div>
      </div>
    )
  }

  if (!state.workspaceId) {
    return <Landing onEnter={enterWorkspace} userId={userId} />
  }

  return (
    <Workspace
      workspaceId={state.workspaceId}
      nickname={state.nickname}
      userId={userId}
      onLeave={leaveWorkspace}
    />
  )
}

/* ───────── 랜딩 (워크스페이스 없을 때) ───────── */

function Landing({ onEnter, userId }) {
  const [mode, setMode] = useState(null) // null | 'create' | 'join'
  const [workspaceName, setWorkspaceName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleCreate() {
    if (!workspaceName.trim() || !nickname.trim()) return
    setBusy(true); setError(null)
    try {
      const { data, error } = await supabase.rpc('create_workspace', {
        p_name: workspaceName.trim(),
        p_nickname: nickname.trim(),
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.workspace_id) throw new Error('워크스페이스 생성 실패')
      onEnter(row.workspace_id, nickname.trim())
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleJoin() {
    if (!inviteCode.trim() || !nickname.trim()) return
    setBusy(true); setError(null)
    try {
      const { data, error } = await supabase.rpc('join_workspace_by_code', {
        p_invite_code: inviteCode.trim().toUpperCase(),
        p_nickname: nickname.trim(),
      })
      if (error) throw error
      if (!data) throw new Error('워크스페이스를 찾을 수 없습니다')
      onEnter(data, nickname.trim())
    } catch (e) {
      const msg = (e.message || '').includes('invalid_code')
        ? '초대 코드가 잘못되었습니다'
        : (e.message || String(e))
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  if (!mode) {
    return (
      <div className="h-full w-full flex flex-col bg-stone-50">
        <header className="px-8 py-5 border-b border-stone-200 bg-white shrink-0">
          <p className="eyebrow">팀</p>
          <h1 className="text-xl font-semibold tracking-tight mt-1">공유 노트</h1>
        </header>
        <main className="flex-1 overflow-auto thin-scroll">
          <div className="max-w-xl mx-auto px-8 py-16">
            <Users className="w-10 h-10 mx-auto mb-4 text-stone-300" />
            <h2 className="text-2xl font-semibold text-center tracking-tight">팀과 함께 글을 씁니다</h2>
            <p className="text-sm text-stone-500 mt-3 text-center leading-relaxed">
              데일리 스크럼·연구 노트·회의록을 한 공간에서 같이 작성. 변경사항은 실시간으로 반영됩니다.
            </p>
            <div className="mt-10 grid grid-cols-2 gap-3">
              <button
                onClick={() => setMode('create')}
                className="border border-stone-200 hover:border-stone-900 bg-white p-6 text-left transition"
              >
                <p className="font-semibold text-stone-900">워크스페이스 만들기</p>
                <p className="text-xs text-stone-500 mt-1.5 leading-relaxed">초대 코드 생성 → 팀원에게 공유</p>
              </button>
              <button
                onClick={() => setMode('join')}
                className="border border-stone-200 hover:border-stone-900 bg-white p-6 text-left transition"
              >
                <p className="font-semibold text-stone-900">초대 코드로 참여</p>
                <p className="text-xs text-stone-500 mt-1.5 leading-relaxed">팀원에게 받은 8자 코드 입력</p>
              </button>
            </div>
            <p className="text-[11px] text-stone-400 mt-8 text-center font-mono">
              내 ID: {userId?.slice(0, 8)}…
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col bg-stone-50">
      <header className="px-8 py-5 border-b border-stone-200 bg-white shrink-0 flex items-center justify-between">
        <div>
          <p className="eyebrow">{mode === 'create' ? '워크스페이스 만들기' : '초대 코드로 참여'}</p>
          <h1 className="text-xl font-semibold tracking-tight mt-1">
            {mode === 'create' ? '팀 이름을 정해 주세요' : '팀에 참여합니다'}
          </h1>
        </div>
        <button onClick={() => { setMode(null); setError(null) }} className="text-sm text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline">
          ← 뒤로
        </button>
      </header>
      <main className="flex-1 overflow-auto thin-scroll">
        <div className="max-w-md mx-auto px-8 py-12 space-y-5">
          {mode === 'create' ? (
            <div>
              <p className="text-xs text-stone-500 mb-1.5">팀 이름</p>
              <input
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="예: AI팀, 마케팅팀"
                className="w-full px-3 py-2 border border-stone-200 text-sm outline-none focus:border-stone-900"
                autoFocus
              />
            </div>
          ) : (
            <div>
              <p className="text-xs text-stone-500 mb-1.5">초대 코드</p>
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="예: AOFG-3X7K"
                className="w-full px-3 py-2 border border-stone-200 text-sm outline-none focus:border-stone-900 font-mono uppercase tracking-wider"
                autoFocus
                maxLength={9}
              />
            </div>
          )}
          <div>
            <p className="text-xs text-stone-500 mb-1.5">내 닉네임 (이 팀 안에서)</p>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="예: 재성, jaeseong"
              className="w-full px-3 py-2 border border-stone-200 text-sm outline-none focus:border-stone-900"
              maxLength={20}
            />
          </div>
          {error && (
            <p className="text-xs text-rose-600">{error}</p>
          )}
          <button
            onClick={mode === 'create' ? handleCreate : handleJoin}
            disabled={busy || !nickname.trim() || (mode === 'create' ? !workspaceName.trim() : !inviteCode.trim())}
            className="w-full py-3 bg-stone-900 hover:bg-stone-800 disabled:opacity-30 text-white text-sm font-medium"
          >
            {busy ? '진행 중…' : (mode === 'create' ? '만들고 들어가기' : '참여하기')}
          </button>
        </div>
      </main>
    </div>
  )
}

/* ───────── 워크스페이스 (가입 후) ───────── */

function Workspace({ workspaceId, nickname, userId, onLeave }) {
  const [workspace, setWorkspace] = useState(null)
  const [pages, setPages] = useState([])
  const [members, setMembers] = useState([])
  const [activePageId, setActivePageId] = useState(null)
  const [body, setBody] = useState('')
  const [title, setTitle] = useState('')
  const [copied, setCopied] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const saveTimerRef = useRef(null)
  const incomingRef = useRef(false)  // realtime로 받은 변경인지 표시

  const myRole = useMemo(() => members.find(m => m.user_id === userId)?.role || 'viewer', [members, userId])
  const canEdit = myRole === 'owner' || myRole === 'editor'

  /* 초기 로드 */
  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: ws, error: e1 }, { data: ps, error: e2 }, { data: ms, error: e3 }] = await Promise.all([
        supabase.from('workspaces').select('*').eq('id', workspaceId).maybeSingle(),
        supabase.from('pages').select('*').eq('workspace_id', workspaceId).order('order_idx', { ascending: true }),
        supabase.from('members').select('*').eq('workspace_id', workspaceId).order('joined_at', { ascending: true }),
      ])
      if (cancelled) return
      if (e1 || !ws) {
        setLoadError(e1?.message || '워크스페이스를 찾을 수 없습니다. 멤버에서 제거되었거나 삭제되었을 수 있습니다.')
        return
      }
      setWorkspace(ws)
      setPages(ps || [])
      setMembers(ms || [])
      if (ps && ps[0]) {
        setActivePageId(ps[0].id)
        setBody(ps[0].body || '')
        setTitle(ps[0].title || '')
      }
    }
    load().catch((e) => setLoadError(e.message))
    return () => { cancelled = true }
  }, [workspaceId])

  /* 실시간 구독 */
  useEffect(() => {
    const ch = supabase
      .channel(`ws-${workspaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pages', filter: `workspace_id=eq.${workspaceId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setPages(prev => [...prev.filter(p => p.id !== payload.new.id), payload.new])
        } else if (payload.eventType === 'UPDATE') {
          setPages(prev => prev.map(p => p.id === payload.new.id ? payload.new : p))
          if (payload.new.id === activePageId && payload.new.updated_by !== userId) {
            // 다른 사람이 같은 페이지를 편집한 경우 — 본인 편집 중이 아니면 갱신
            incomingRef.current = true
            setBody(payload.new.body || '')
            setTitle(payload.new.title || '')
          }
        } else if (payload.eventType === 'DELETE') {
          setPages(prev => prev.filter(p => p.id !== payload.old.id))
          if (payload.old.id === activePageId) setActivePageId(null)
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `workspace_id=eq.${workspaceId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setMembers(prev => [...prev.filter(m => m.id !== payload.new.id), payload.new])
        } else if (payload.eventType === 'UPDATE') {
          setMembers(prev => prev.map(m => m.id === payload.new.id ? payload.new : m))
        } else if (payload.eventType === 'DELETE') {
          setMembers(prev => prev.filter(m => m.id !== payload.old.id))
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [workspaceId, activePageId, userId])

  /* 활성 페이지 바뀔 때 body/title 동기화 */
  useEffect(() => {
    const p = pages.find(x => x.id === activePageId)
    if (p) {
      setBody(p.body || '')
      setTitle(p.title || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePageId])

  /* body/title 변경 → 디바운스 저장 */
  function changeBody(newBody) {
    if (incomingRef.current) { incomingRef.current = false; return }
    setBody(newBody)
    setPages(prev => prev.map(p => p.id === activePageId ? { ...p, body: newBody, updated_at: new Date().toISOString(), updated_by_nickname: nickname } : p))
    scheduleSave({ body: newBody })
  }
  function changeTitle(newTitle) {
    setTitle(newTitle)
    setPages(prev => prev.map(p => p.id === activePageId ? { ...p, title: newTitle } : p))
    scheduleSave({ title: newTitle })
  }
  function scheduleSave(patch) {
    if (!canEdit || !activePageId) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      await supabase
        .from('pages')
        .update({ ...patch, updated_at: new Date().toISOString(), updated_by: userId, updated_by_nickname: nickname })
        .eq('id', activePageId)
    }, 500)
  }

  async function createPage() {
    if (!canEdit) return
    const order_idx = (pages[pages.length - 1]?.order_idx ?? 0) + 10
    const { data, error } = await supabase
      .from('pages')
      .insert({ workspace_id: workspaceId, title: '제목 없음', body: '', order_idx, updated_by: userId, updated_by_nickname: nickname })
      .select()
      .single()
    if (!error && data) {
      setActivePageId(data.id)
    }
  }

  async function deletePage(id) {
    if (!canEdit) return
    if (!window.confirm('이 페이지를 삭제할까요? (팀 전체에서 사라집니다)')) return
    await supabase.from('pages').delete().eq('id', id)
    if (activePageId === id) {
      const remaining = pages.filter(p => p.id !== id)
      setActivePageId(remaining[0]?.id ?? null)
    }
  }

  function copyInviteCode() {
    if (!workspace) return
    navigator.clipboard.writeText(workspace.invite_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function leave() {
    if (!window.confirm(`${workspace?.name || '이 워크스페이스'}에서 나가시겠어요?`)) return
    if (userId) {
      await supabase.from('members').delete().eq('workspace_id', workspaceId).eq('user_id', userId)
    }
    onLeave()
  }

  if (loadError) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-900 font-medium mb-2">워크스페이스를 열 수 없습니다</p>
        <p className="text-xs text-stone-500">{loadError}</p>
        <button onClick={onLeave} className="mt-4 text-sm text-stone-900 underline underline-offset-4">
          돌아가기
        </button>
      </div>
    )
  }
  if (!workspace) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-stone-50">
        <p className="text-sm text-stone-400">불러오는 중…</p>
      </div>
    )
  }

  const activePage = pages.find(p => p.id === activePageId)

  return (
    <div className="h-full w-full flex flex-col bg-stone-50">
      {/* 헤더 */}
      <header className="px-8 py-4 border-b border-stone-200 bg-white shrink-0 flex items-end justify-between">
        <div>
          <p className="eyebrow">팀 워크스페이스</p>
          <h1 className="text-lg font-semibold tracking-tight mt-0.5">{workspace.name}</h1>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <button
            onClick={copyInviteCode}
            className="flex items-center gap-1.5 text-stone-500 hover:text-stone-900"
            title="클릭해서 초대 코드 복사"
          >
            <span className="font-mono text-xs">{workspace.invite_code}</span>
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <div className="text-xs text-stone-400 flex items-center gap-2">
            <Users className="w-3.5 h-3.5" />
            {members.length}명
          </div>
          <button onClick={leave} className="text-stone-500 hover:text-rose-600 flex items-center gap-1" title="이 팀에서 나가기">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 페이지 사이드바 */}
        <aside className="w-56 border-r border-stone-200 bg-white flex flex-col shrink-0">
          <div className="p-2 border-b border-stone-200 flex items-center justify-between">
            <p className="text-[10px] text-stone-500 uppercase tracking-wider px-2">페이지</p>
            {canEdit && (
              <button
                onClick={createPage}
                className="p-1 text-stone-500 hover:text-stone-900 hover:bg-stone-100"
                title="새 페이지"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <ul className="flex-1 overflow-auto thin-scroll">
            {pages.length === 0 && (
              <li className="text-center text-xs text-stone-400 py-8 px-3">
                {canEdit ? '새 페이지를 만들어 보세요' : '페이지 없음'}
              </li>
            )}
            {pages.map((p) => {
              const isActive = p.id === activePageId
              const titleDisplay = (p.title || '제목 없음').trim() || '제목 없음'
              return (
                <li
                  key={p.id}
                  className={`group px-3 py-2 cursor-pointer border-b border-stone-100 ${isActive ? 'bg-stone-100' : 'hover:bg-stone-50'}`}
                  onClick={() => setActivePageId(p.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate text-stone-900">{titleDisplay}</p>
                      <p className="text-[10px] text-stone-400 mt-0.5">
                        {p.updated_by_nickname || '—'} · {relativeTime(p.updated_at)}
                      </p>
                    </div>
                    {canEdit && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deletePage(p.id) }}
                        className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {/* 멤버 목록 */}
          <div className="border-t border-stone-200 p-2">
            <p className="text-[10px] text-stone-500 uppercase tracking-wider px-2 mb-1.5">멤버 ({members.length})</p>
            <ul className="max-h-32 overflow-auto thin-scroll">
              {members.map((m) => (
                <li key={m.id} className="px-2 py-1 text-xs flex items-center gap-2">
                  {m.role === 'owner' ? (
                    <Crown className="w-3 h-3 text-amber-600 shrink-0" />
                  ) : m.role === 'viewer' ? (
                    <Eye className="w-3 h-3 text-stone-400 shrink-0" />
                  ) : (
                    <span className="w-3 h-3 shrink-0" />
                  )}
                  <span className={`truncate ${m.user_id === userId ? 'font-semibold text-stone-900' : 'text-stone-600'}`}>
                    {m.nickname}{m.user_id === userId ? ' (나)' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* 에디터 */}
        <main className="flex-1 flex flex-col bg-stone-50">
          {activePage ? (
            <>
              <div className="px-8 pt-6 pb-3 border-b border-stone-200">
                <input
                  value={title}
                  onChange={(e) => changeTitle(e.target.value)}
                  disabled={!canEdit}
                  placeholder="제목"
                  className="w-full text-2xl font-semibold tracking-tight bg-transparent outline-none placeholder:text-stone-300 disabled:text-stone-700"
                />
                <p className="text-[11px] text-stone-400 mt-1.5">
                  최종 수정: {activePage.updated_by_nickname || '—'} · {relativeTime(activePage.updated_at)}
                </p>
              </div>
              <textarea
                value={body}
                onChange={(e) => changeBody(e.target.value)}
                disabled={!canEdit}
                placeholder={canEdit ? '여기에 입력… (마크다운 지원)' : '읽기 전용입니다'}
                className="flex-1 px-8 py-5 text-sm leading-relaxed bg-transparent outline-none resize-none font-mono text-stone-900 placeholder:text-stone-300"
              />
              <div className="px-8 py-2 border-t border-stone-200 bg-white text-[11px] text-stone-400 flex justify-between">
                <span>{body.length.toLocaleString()}자 · {body.split('\n').length}행</span>
                <span>{canEdit ? '자동 저장 · 실시간 공유' : `읽기 전용 (${myRole})`}</span>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <FileText className="w-10 h-10 mx-auto mb-3 text-stone-300" />
                <p className="text-sm text-stone-500">왼쪽에서 페이지를 선택하거나</p>
                {canEdit && (
                  <button onClick={createPage} className="mt-3 text-sm text-stone-900 underline underline-offset-4">
                    새 페이지 만들기
                  </button>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
