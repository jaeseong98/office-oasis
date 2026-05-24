import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, FolderOpen, ExternalLink, X, Plus } from 'lucide-react'

/* ───────── 유틸 ───────── */

function formatBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function shortPath(p, maxLen = 60) {
  if (!p) return ''
  if (p.length <= maxLen) return p
  return '…' + p.slice(p.length - maxLen + 1)
}

function ageDays(mtimeMs) {
  return Math.floor((Date.now() - mtimeMs) / (1000 * 60 * 60 * 24))
}

/* ───────── 카테고리 ───────── */

const CATS = [
  { id: 'huge',        label: '거대 파일',      hint: '50MB 이상' },
  { id: 'old',         label: '오래 묵은 파일', hint: '마지막 수정 90일+' },
  { id: 'screenshots', label: '스크린샷',       hint: '캡처 파일 패턴' },
  { id: 'temp',        label: '임시·잔해',      hint: '.tmp / .crdownload 등' },
  { id: 'duplicates',  label: '중복 파일',      hint: '해시 동일 그룹' },
  { id: 'emptyDirs',   label: '빈 폴더',        hint: '내용 없음' },
]

/* ───────── 메인 ───────── */

export default function App() {
  const [isElectron, setIsElectron] = useState(false)
  const [roots, setRoots] = useState([])
  const [progress, setProgress] = useState(null)
  const [scanResult, setScanResult] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [activeCat, setActiveCat] = useState(null)
  const [toast, setToast] = useState(null)
  const [confirming, setConfirming] = useState(null) // { paths, permanent }

  useEffect(() => {
    if (typeof window === 'undefined' || !window.oasis?.isElectron) return
    setIsElectron(true)
    window.oasis.defaultRoots().then(setRoots)
    const off = window.oasis.onProgress(setProgress)
    return off
  }, [])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setActiveCat(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const showToast = (msg, kind = 'info') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 2800)
  }

  async function addRoot() {
    const r = await window.oasis.pickFolder()
    if (!r.canceled) setRoots(prev => Array.from(new Set([...prev, r.path])))
  }
  function removeRoot(p) { setRoots(prev => prev.filter(r => r !== p)) }

  async function startScan() {
    if (!isElectron || scanning) return
    if (!roots.length) { showToast('스캔할 폴더를 1개 이상 추가해 주세요', 'error'); return }
    setScanning(true)
    setScanResult(null)
    setSelected(new Set())
    setActiveCat(null)
    setProgress({ phase: 'walk', count: 0 })
    try {
      const res = await window.oasis.startScan(roots)
      if (res.error) showToast(res.error, 'error')
      else if (res.cancelled) showToast('스캔 취소됨', 'info')
      else {
        setScanResult(res)
        showToast(`스캔 완료 · ${res.totals.fileCount.toLocaleString()}개 파일`, 'ok')
      }
    } finally {
      setScanning(false)
      setProgress(null)
    }
  }
  async function cancelScan() {
    if (!scanning) return
    await window.oasis.cancelScan()
    setScanning(false)
    setProgress(null)
  }

  const groupedItems = useMemo(() => {
    if (!scanResult) return {}
    const dupFlat = []
    scanResult.duplicates.forEach((group, gi) => {
      group.forEach((f, idx) => {
        dupFlat.push({ ...f, _dupGroup: gi, _keepRecommended: idx === 0 })
      })
    })
    return {
      huge: scanResult.huge,
      old: scanResult.old,
      screenshots: scanResult.screenshots,
      temp: scanResult.temp,
      duplicates: dupFlat,
      emptyDirs: scanResult.emptyDirs.map(d => ({ ...d, name: d.path.split(/[\\/]/).pop(), size: 0 })),
    }
  }, [scanResult])

  const catStats = useMemo(() => {
    const out = {}
    for (const c of CATS) {
      const items = groupedItems[c.id] || []
      let count = items.length
      let size = items.reduce((s, it) => s + (it.size || 0), 0)
      if (c.id === 'duplicates' && scanResult) {
        count = items.filter(it => !it._keepRecommended).length
        size = items.filter(it => !it._keepRecommended).reduce((s, it) => s + (it.size || 0), 0)
      }
      out[c.id] = { count, size }
    }
    return out
  }, [groupedItems, scanResult])

  const totalRecoverable = useMemo(() => {
    if (!scanResult) return 0
    const set = new Map()
    for (const c of CATS) {
      if (c.id === 'duplicates') {
        for (const it of groupedItems.duplicates) {
          if (!it._keepRecommended) set.set(it.path, it.size || 0)
        }
      } else {
        for (const it of groupedItems[c.id] || []) set.set(it.path, it.size || 0)
      }
    }
    return Array.from(set.values()).reduce((s, n) => s + n, 0)
  }, [groupedItems, scanResult])

  const selectedStats = useMemo(() => {
    if (!scanResult) return { count: 0, size: 0 }
    let count = 0, size = 0
    const seen = new Set()
    for (const c of CATS) {
      for (const it of groupedItems[c.id] || []) {
        if (selected.has(it.path) && !seen.has(it.path)) {
          seen.add(it.path)
          count++
          size += it.size || 0
        }
      }
    }
    return { count, size }
  }, [selected, groupedItems, scanResult])

  function toggleSelect(path) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }
  function selectAllInCategory(catId) {
    const items = groupedItems[catId] || []
    setSelected(prev => {
      const next = new Set(prev)
      for (const it of items) {
        if (catId === 'duplicates' && it._keepRecommended) continue
        next.add(it.path)
      }
      return next
    })
  }
  function clearSelectionInCategory(catId) {
    const items = groupedItems[catId] || []
    setSelected(prev => {
      const next = new Set(prev)
      for (const it of items) next.delete(it.path)
      return next
    })
  }
  function selectRecommended() {
    const next = new Set()
    for (const it of groupedItems.temp || []) next.add(it.path)
    for (const it of groupedItems.emptyDirs || []) next.add(it.path)
    for (const it of groupedItems.duplicates || []) {
      if (!it._keepRecommended) next.add(it.path)
    }
    setSelected(next)
  }

  function askConfirmation() {
    if (selectedStats.count === 0) return
    setConfirming({ paths: Array.from(selected), permanent: false })
  }

  async function executeDeletion({ paths, permanent }) {
    setConfirming(null)
    const sizeMap = {}
    for (const c of CATS) {
      for (const it of groupedItems[c.id] || []) sizeMap[it.path] = it.size || 0
    }
    setToast(null)
    const api = permanent ? window.oasis.permanentMany : window.oasis.trashMany
    const { results } = await api(paths)
    const okPaths = results.filter(r => r.ok).map(r => r.path)
    const failed = results.filter(r => !r.ok)
    if (okPaths.length) {
      const okSet = new Set(okPaths)
      setScanResult(prev => {
        if (!prev) return prev
        const clean = (arr) => arr.filter(it => !okSet.has(it.path))
        return {
          ...prev,
          huge: clean(prev.huge),
          old: clean(prev.old),
          screenshots: clean(prev.screenshots),
          temp: clean(prev.temp),
          emptyDirs: clean(prev.emptyDirs),
          duplicates: prev.duplicates
            .map(group => group.filter(it => !okSet.has(it.path)))
            .filter(group => group.length > 1),
        }
      })
      setSelected(prev => {
        const next = new Set(prev)
        okPaths.forEach(p => next.delete(p))
        return next
      })
    }
    const recovered = okPaths.reduce((s, p) => s + (sizeMap[p] || 0), 0)
    const verb = permanent ? '영구 삭제' : '휴지통으로'
    if (failed.length === 0) showToast(`${okPaths.length}개 ${verb} · ${formatBytes(recovered)} 회수`, 'ok')
    else showToast(`완료 ${okPaths.length} · 실패 ${failed.length}`, failed.length > okPaths.length ? 'error' : 'info')
  }

  /* ─── 렌더 ─── */

  if (!isElectron) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-stone-50 text-stone-700">
        <div className="max-w-md text-center px-6">
          <p className="text-lg font-semibold text-stone-900">Electron 환경에서 실행해 주세요</p>
          <p className="text-sm mt-2 text-stone-500">터미널에서 <code className="bg-stone-100 px-1.5 py-0.5 text-stone-700 text-xs">npm run dev</code></p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-stone-50 text-stone-900">
      <Header
        scanResult={scanResult}
        totalRecoverable={totalRecoverable}
        scanning={scanning}
        onRescan={startScan}
      />

      <main className="flex-1 overflow-hidden">
        {!scanResult && (
          <ScanLanding
            roots={roots}
            onAddRoot={addRoot}
            onRemoveRoot={removeRoot}
            onStart={startScan}
            onCancel={cancelScan}
            scanning={scanning}
            progress={progress}
          />
        )}

        {scanResult && activeCat === null && (
          <ResultSummary
            scanResult={scanResult}
            catStats={catStats}
            totalRecoverable={totalRecoverable}
            onOpenCategory={(catId) => setActiveCat(catId)}
            onSelectRecommended={selectRecommended}
          />
        )}

        {scanResult && activeCat && (
          <CategoryView
            catId={activeCat}
            items={groupedItems[activeCat] || []}
            selected={selected}
            onToggle={toggleSelect}
            onSelectAll={() => selectAllInCategory(activeCat)}
            onClear={() => clearSelectionInCategory(activeCat)}
            onBack={() => setActiveCat(null)}
            onReveal={(p) => window.oasis.reveal(p)}
            onOpen={(p) => window.oasis.open(p)}
          />
        )}
      </main>

      {selectedStats.count > 0 && (
        <div className="border-t border-stone-200 bg-white px-6 py-3 flex items-center justify-between shrink-0">
          <div className="text-sm tnum">
            <span className="text-stone-500">선택</span>
            <span className="ml-1.5 font-semibold">{selectedStats.count}</span>
            <span className="ml-3 text-stone-400">·</span>
            <span className="ml-3 font-semibold">{formatBytes(selectedStats.size)}</span>
            <span className="ml-1 text-stone-500">회수</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setSelected(new Set())}
              className="text-xs text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline">
              선택 해제
            </button>
            <button onClick={askConfirmation}
              className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm">
              삭제…
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 text-sm shadow-sm border
          ${toast.kind === 'error' ? 'bg-stone-900 text-white border-stone-900'
            : toast.kind === 'ok' ? 'bg-stone-900 text-white border-stone-900'
            : 'bg-white text-stone-900 border-stone-200'}`}>
          {toast.msg}
        </div>
      )}

      {confirming && (
        <ConfirmDeleteModal
          state={confirming}
          onChange={setConfirming}
          onCancel={() => setConfirming(null)}
          onConfirm={executeDeletion}
          totalSize={selectedStats.size}
          totalCount={selectedStats.count}
        />
      )}
    </div>
  )
}

/* ───────── 삭제 확인 모달 ───────── */

function ConfirmDeleteModal({ state, onChange, onCancel, onConfirm, totalSize, totalCount }) {
  const isPermanent = state.permanent
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onMouseDown={onCancel}>
      <div className="bg-white border border-stone-200 shadow-xl max-w-md w-full mx-4"
           onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-3">
          <p className="eyebrow">{isPermanent ? '⚠ 영구 삭제' : '휴지통으로 이동'}</p>
          <h3 className="text-lg font-semibold mt-1.5 tracking-tight">
            {totalCount}개 항목 · {formatBytes(totalSize)}
          </h3>
          <p className="text-sm text-stone-600 mt-3 leading-relaxed">
            {isPermanent ? (
              <>이 항목들은 <strong className="text-stone-900">즉시 영구 삭제</strong>됩니다.<br />
              휴지통을 거치지 않으며 <strong className="text-stone-900">복원할 수 없습니다.</strong></>
            ) : (
              <>이 항목들은 휴지통으로 이동합니다.<br />
              실수했다면 휴지통에서 바로 복원할 수 있습니다.</>
            )}
          </p>
        </div>

        <div className="px-6 py-4 border-t border-stone-200 bg-stone-50">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isPermanent}
              onChange={(e) => onChange({ ...state, permanent: e.target.checked })}
              className="accent-stone-900 w-4 h-4 mt-0.5 cursor-pointer"
            />
            <div>
              <p className="text-sm font-medium">휴지통 우회 · 영구 삭제</p>
              <p className="text-xs text-stone-500 mt-0.5">디스크 용량을 즉시 회수. 복원 불가.</p>
            </div>
          </label>
        </div>

        <div className="px-6 py-4 flex items-center justify-end gap-3 border-t border-stone-200">
          <button onClick={onCancel}
            className="text-sm text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline">
            취소
          </button>
          <button onClick={() => onConfirm(state)}
            className={`px-4 py-2 text-sm font-medium text-white ${isPermanent ? 'bg-red-700 hover:bg-red-800' : 'bg-stone-900 hover:bg-stone-800'}`}>
            {isPermanent ? '영구 삭제' : '휴지통으로'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────── 헤더 ───────── */

function Header({ scanResult, totalRecoverable, scanning, onRescan }) {
  return (
    <header className="px-8 py-5 border-b border-stone-200 bg-white shrink-0">
      <div className="flex items-end justify-between max-w-6xl mx-auto">
        <div>
          <p className="eyebrow">Office Oasis</p>
          <h1 className="text-xl font-semibold tracking-tight mt-1">바탕화면 대청소</h1>
        </div>
        {scanResult && (
          <div className="flex items-center gap-8 text-sm">
            <div className="text-right">
              <p className="eyebrow">스캔됨</p>
              <p className="font-semibold tnum mt-0.5">
                {scanResult.totals.fileCount.toLocaleString()}
                <span className="text-stone-500 font-normal ml-1">파일</span>
              </p>
            </div>
            <div className="text-right">
              <p className="eyebrow">정리 가능</p>
              <p className="font-semibold tnum mt-0.5">{formatBytes(totalRecoverable)}</p>
            </div>
            <button onClick={onRescan} disabled={scanning}
              className="text-sm text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline disabled:opacity-40">
              다시 스캔
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

/* ───────── 랜딩 ───────── */

function ScanLanding({ roots, onAddRoot, onRemoveRoot, onStart, onCancel, scanning, progress }) {
  return (
    <div className="h-full overflow-auto thin-scroll">
      <div className="max-w-2xl mx-auto px-8 py-16">
        <p className="eyebrow">청소 준비</p>
        <h2 className="text-3xl font-semibold tracking-tight mt-2 leading-tight">
          어디를 정리해 드릴까요.
        </h2>
        <p className="text-stone-500 mt-3 leading-relaxed">
          선택한 폴더를 재귀 탐색해 거대 파일·오래된 파일·스크린샷·임시 파일·중복·빈 폴더를 찾아냅니다.<br />
          한 번에 휴지통으로 옮기고, 필요하면 복원할 수 있습니다.
        </p>

        <div className="mt-10">
          <div className="flex items-baseline justify-between mb-3">
            <p className="eyebrow">대상 폴더</p>
            <button onClick={onAddRoot} disabled={scanning}
              className="text-xs text-stone-500 hover:text-stone-900 inline-flex items-center gap-1 underline-offset-4 hover:underline disabled:opacity-40">
              <Plus className="w-3 h-3" /> 폴더 추가
            </button>
          </div>
          {roots.length === 0 && <p className="text-sm text-stone-400">기본 폴더가 로드 중…</p>}
          <ul className="border-t border-stone-200">
            {roots.map((r) => (
              <li key={r} className="flex items-center justify-between py-2.5 border-b border-stone-200 text-sm">
                <span className="text-stone-700 truncate font-mono text-xs" title={r}>{r}</span>
                <button onClick={() => onRemoveRoot(r)} disabled={scanning}
                  className="text-stone-400 hover:text-stone-900 disabled:opacity-30 shrink-0 ml-3">
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        {!scanning && (
          <button onClick={onStart} disabled={roots.length === 0}
            className="mt-10 w-full py-3.5 bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium tracking-wide disabled:opacity-30">
            스캔 시작
          </button>
        )}

        {scanning && (
          <div className="mt-10 border-t border-stone-200 pt-6">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-sm font-medium">{phaseLabel(progress)}</p>
              <button onClick={onCancel}
                className="text-xs text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline">
                취소
              </button>
            </div>
            <ProgressBar progress={progress} />
            <p className="mt-3 text-[11px] text-stone-400 font-mono truncate">
              {progress?.currentPath ? shortPath(progress.currentPath, 80) : '준비 중…'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function phaseLabel(p) {
  if (!p) return '준비 중'
  switch (p.phase) {
    case 'walk':      return `파일 목록 수집 중 · ${(p.count || 0).toLocaleString()}`
    case 'walk-done': return '목록 수집 완료'
    case 'hash':      return '중복 검사 (해시 비교)'
    case 'hash-done': return '중복 검사 완료'
    default:          return p.phase
  }
}

function ProgressBar({ progress }) {
  let pct = null
  if (progress?.phase === 'hash' && progress.total) {
    pct = Math.min(100, (progress.current / progress.total) * 100)
  }
  return (
    <div className="h-px bg-stone-200 relative overflow-hidden">
      <div
        className={`h-full bg-stone-900 transition-all ${pct == null ? 'animate-pulse w-1/3' : ''}`}
        style={pct != null ? { width: `${pct}%` } : undefined}
      />
    </div>
  )
}

/* ───────── 결과 요약 ───────── */

function ResultSummary({ scanResult, catStats, totalRecoverable, onOpenCategory, onSelectRecommended }) {
  return (
    <div className="h-full overflow-auto thin-scroll">
      <div className="max-w-3xl mx-auto px-8 py-12">
        {/* 영웅 통계: 그라데이션 카드 대신 큰 숫자 + 얇은 가로선 */}
        <div className="border-b border-stone-200 pb-8 mb-2">
          <p className="eyebrow">정리 가능 용량</p>
          <p className="text-6xl font-semibold tracking-tight tnum mt-2">
            {formatBytes(totalRecoverable)}
          </p>
          <div className="flex items-end justify-between mt-4">
            <p className="text-sm text-stone-500">
              전체 {scanResult.totals.fileCount.toLocaleString()}개 파일 · {formatBytes(scanResult.totals.totalSize)} 중
            </p>
            <button onClick={onSelectRecommended}
              className="text-sm text-stone-900 hover:text-stone-600 underline-offset-4 underline">
              안전한 항목만 자동 선택 ↗
            </button>
          </div>
        </div>

        {/* 카테고리 — 카드가 아닌 행 리스트 */}
        <ul>
          {CATS.map((c) => {
            const stat = catStats[c.id] || { count: 0, size: 0 }
            const empty = stat.count === 0
            return (
              <li key={c.id} className="border-b border-stone-200">
                <button
                  onClick={() => !empty && onOpenCategory(c.id)}
                  disabled={empty}
                  className={`w-full flex items-baseline py-5 group ${empty ? 'opacity-30' : 'hover:bg-stone-100/60 cursor-pointer'}`}
                >
                  <div className="flex-1 text-left pl-2">
                    <p className="font-semibold text-base">{c.label}</p>
                    <p className="text-xs text-stone-500 mt-0.5">{c.hint}</p>
                  </div>
                  <div className="w-24 text-right tnum text-stone-700">{stat.count.toLocaleString()}</div>
                  <div className="w-32 text-right tnum font-semibold">{formatBytes(stat.size)}</div>
                  <div className="w-10 text-right pr-2">
                    {!empty && (
                      <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-900 inline" />
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/* ───────── 카테고리 디테일 ───────── */

function CategoryView({ catId, items, selected, onToggle, onSelectAll, onClear, onBack, onReveal, onOpen }) {
  const cat = CATS.find(c => c.id === catId)
  const sorted = useMemo(() => items.slice().sort((a, b) => (b.size || 0) - (a.size || 0)), [items])
  const allSelected = items.length > 0 && items.every(it => selected.has(it.path) || (catId === 'duplicates' && it._keepRecommended))

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-4 border-b border-stone-200 bg-white flex items-center justify-between shrink-0">
        <div className="flex items-baseline gap-4">
          <button onClick={onBack}
            className="text-sm text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline">
            ← 뒤로
          </button>
          <div>
            <p className="eyebrow">{cat.hint}</p>
            <h2 className="font-semibold mt-0.5">{cat.label} <span className="text-stone-400 font-normal ml-1">{items.length.toLocaleString()}</span></h2>
          </div>
        </div>
        <button onClick={allSelected ? onClear : onSelectAll}
          className="text-xs text-stone-500 hover:text-stone-900 underline-offset-4 hover:underline">
          {allSelected ? '전체 해제' : '카테고리 전체 선택'}
        </button>
      </div>

      <div className="flex-1 overflow-auto thin-scroll">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-stone-50 border-b border-stone-200">
            <tr className="text-left">
              <th className="px-4 py-2.5 w-10"></th>
              <th className="px-4 py-2.5 eyebrow font-medium">이름</th>
              <th className="px-4 py-2.5 eyebrow font-medium">경로</th>
              <th className="px-4 py-2.5 eyebrow font-medium text-right w-28">용량</th>
              <th className="px-4 py-2.5 eyebrow font-medium w-28">수정</th>
              <th className="px-4 py-2.5 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16 text-stone-400">항목 없음</td></tr>
            )}
            {sorted.map((it) => {
              const isSelected = selected.has(it.path)
              const isKeep = catId === 'duplicates' && it._keepRecommended
              return (
                <tr key={it.path}
                    className={`border-b border-stone-100 hover:bg-stone-100/50 ${isSelected ? 'bg-stone-100' : ''} ${isKeep ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggle(it.path)}
                      disabled={isKeep}
                      className="accent-stone-900 w-3.5 h-3.5 cursor-pointer disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {isKeep && <span className="text-stone-900 mr-2 not-italic font-sans text-[10px] tracking-wider">KEEP</span>}
                    {it.name}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-stone-400" title={it.path}>
                    {shortPath(it.path, 70)}
                  </td>
                  <td className="px-4 py-2.5 text-right tnum">{formatBytes(it.size)}</td>
                  <td className="px-4 py-2.5 text-stone-500 text-xs tnum">
                    {it.mtimeMs ? `${ageDays(it.mtimeMs)}일 전` : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <button onClick={() => onReveal(it.path)}
                        className="p-1.5 text-stone-400 hover:text-stone-900"
                        title="탐색기에서 보기">
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => onOpen(it.path)}
                        className="p-1.5 text-stone-400 hover:text-stone-900"
                        title="열기">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
