import { useEffect, useRef, useState, useCallback } from 'react'
import Matter from 'matter-js'
import { Sparkles, ListChecks, Trash2 } from 'lucide-react'

const ZONES = [
  { id: 'urgent',  emoji: '🔥', label: '당장 할 일',   color: '#ef4444', accent: '#fecaca' },
  { id: 'pending', emoji: '🥶', label: '컨펌 대기',     color: '#3b82f6', accent: '#bfdbfe' },
  { id: 'trash',   emoji: '🗑️', label: '퇴사시 삭제', color: '#64748b', accent: '#cbd5e1' },
]

const STORAGE_KEY = 'office-oasis:files-v1'
const MAX_CAPACITY_BYTES = 500 * 1024 * 1024 // 500MB 시각화 상한

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}
function saveToStorage(files) {
  try {
    // sessionUrl(blob URL)은 새로고침 후 무효이므로 저장 제외
    const stripped = files.map(({ sessionUrl, ...rest }) => rest)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped))
  } catch { /* ignore quota */ }
}

function formatBytes(n) {
  if (!n && n !== 0) return '-'
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`
}

function pickZoneByX(x, width) {
  if (x < width / 3) return 'urgent'
  if (x < (width / 3) * 2) return 'pending'
  return 'trash'
}

export default function App() {
  const sceneRef = useRef(null)
  const engineRef = useRef(null)
  const renderRef = useRef(null)
  const runnerRef = useRef(null)
  const bodyMapRef = useRef(new Map()) // body.id -> file metadata

  const [files, setFiles] = useState(() => loadFromStorage())
  const [panicMode, setPanicMode] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // 파일 메타가 바뀔 때마다 LocalStorage 동기화
  useEffect(() => { saveToStorage(files) }, [files])

  // 윈도우 전역 드롭 차단 (캔버스 밖에 떨어뜨려도 브라우저가 파일 열지 않게)
  useEffect(() => {
    const prevent = (e) => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  // Space = 상사 감지 모드 토글, Esc = 해제
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        setPanicMode(p => !p)
      } else if (e.key === 'Escape') {
        setPanicMode(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // 파일 메타로부터 물리 바디 생성
  function createFileBody(meta, canvasW, dropX) {
    const zone = ZONES.find(z => z.id === meta.zone) ?? ZONES[1]
    const sizeFactor = Math.min(1, (meta.size || 0) / (50 * 1024 * 1024))
    const w = 92 + sizeFactor * 70
    const h = 36 + sizeFactor * 18
    const zoneW = canvasW / 3
    const zoneIdx = ZONES.findIndex(z => z.id === meta.zone)
    const fallbackX = zoneIdx * zoneW + zoneW / 2 + (Math.random() - 0.5) * (zoneW * 0.4)
    const x = typeof dropX === 'number' ? dropX : fallbackX
    return Matter.Bodies.rectangle(x, 40, w, h, {
      restitution: 0.42,
      friction: 0.45,
      frictionAir: 0.012,
      density: 0.0012,
      chamfer: { radius: 8 },
      render: {
        fillStyle: zone.color,
        strokeStyle: zone.accent,
        lineWidth: 2,
      },
    })
  }

  // Matter.js 초기화
  useEffect(() => {
    const container = sceneRef.current
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight

    const engine = Matter.Engine.create({ gravity: { x: 0, y: 1.0 } })
    const world = engine.world

    const render = Matter.Render.create({
      element: container,
      engine,
      options: {
        width,
        height,
        background: 'transparent',
        wireframes: false,
        pixelRatio: window.devicePixelRatio || 1,
      },
    })

    // 경계 (보이지 않는 정적 벽)
    const wallStyle = { isStatic: true, render: { fillStyle: 'transparent' } }
    const ground   = Matter.Bodies.rectangle(width / 2, height - 14, width * 2, 28, {
      isStatic: true,
      render: { fillStyle: '#1e293b' },
    })
    const leftWall  = Matter.Bodies.rectangle(-20, height / 2, 40, height * 2, wallStyle)
    const rightWall = Matter.Bodies.rectangle(width + 20, height / 2, 40, height * 2, wallStyle)
    const ceiling   = Matter.Bodies.rectangle(width / 2, -200, width * 2, 40, wallStyle)
    const divider1  = Matter.Bodies.rectangle(width / 3, height - 60, 3, 100, {
      isStatic: true,
      render: { fillStyle: 'rgba(148,163,184,0.25)' },
    })
    const divider2  = Matter.Bodies.rectangle((width / 3) * 2, height - 60, 3, 100, {
      isStatic: true,
      render: { fillStyle: 'rgba(148,163,184,0.25)' },
    })

    Matter.World.add(world, [ground, leftWall, rightWall, ceiling, divider1, divider2])

    // 마우스 드래그 (블록을 잡아서 던질 수 있게)
    const mouse = Matter.Mouse.create(render.canvas)
    const mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse,
      constraint: { stiffness: 0.18, render: { visible: false } },
    })
    Matter.World.add(world, mouseConstraint)
    render.mouse = mouse

    // 캔버스에 라벨/구역명을 덧그리기
    Matter.Events.on(render, 'afterRender', () => {
      const ctx = render.context
      const pr = render.options.pixelRatio || 1
      const w = render.canvas.width / pr
      const h = render.canvas.height / pr

      // 구역 타이틀
      ctx.save()
      ctx.textAlign = 'center'
      ctx.font = '600 18px system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'
      const zoneW = w / 3
      ZONES.forEach((z, i) => {
        const x = zoneW * i + zoneW / 2
        ctx.fillStyle = 'rgba(226,232,240,0.55)'
        ctx.fillText(`${z.emoji} ${z.label}`, x, h - 52)
      })
      ctx.restore()

      // 블록 위 파일명 + 용량
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      Matter.Composite.allBodies(world).forEach(b => {
        const meta = bodyMapRef.current.get(b.id)
        if (!meta) return
        ctx.save()
        ctx.translate(b.position.x, b.position.y)
        ctx.rotate(b.angle)
        ctx.fillStyle = '#ffffff'
        ctx.font = '600 12px system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'
        const name = meta.name.length > 14 ? meta.name.slice(0, 12) + '…' : meta.name
        ctx.fillText(name, 0, -4)
        ctx.font = '500 10px ui-monospace, Consolas, monospace'
        ctx.fillStyle = 'rgba(255,255,255,0.75)'
        ctx.fillText(formatBytes(meta.size), 0, 10)
        ctx.restore()
      })
      ctx.restore()
    })

    Matter.Render.run(render)
    const runner = Matter.Runner.create()
    Matter.Runner.run(runner, engine)

    engineRef.current = engine
    renderRef.current = render
    runnerRef.current = runner

    // 새로고침 후에도 블록이 다시 나타나도록 메타로부터 복원
    const persisted = loadFromStorage()
    persisted.forEach((meta) => {
      const body = createFileBody(meta, width)
      bodyMapRef.current.set(body.id, meta)
      Matter.World.add(world, body)
    })

    // 리사이즈: 캔버스 크기 갱신
    const onResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      render.options.width = w
      render.options.height = h
      render.canvas.width = w * (render.options.pixelRatio || 1)
      render.canvas.height = h * (render.options.pixelRatio || 1)
      render.canvas.style.width = w + 'px'
      render.canvas.style.height = h + 'px'
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      Matter.Render.stop(render)
      Matter.Runner.stop(runner)
      Matter.World.clear(world, false)
      Matter.Engine.clear(engine)
      if (render.canvas?.parentNode) render.canvas.parentNode.removeChild(render.canvas)
      render.textures = {}
      bodyMapRef.current.clear()
      engineRef.current = null
      renderRef.current = null
      runnerRef.current = null
    }
  }, [])

  // 드래그 앤 드롭으로 파일이 들어오면 블록 생성
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const container = sceneRef.current
    if (!container || !engineRef.current) return
    const rect = container.getBoundingClientRect()
    const dropX = e.clientX - rect.left
    const canvasW = rect.width
    const baseZone = pickZoneByX(dropX, canvasW)

    const filesArr = Array.from(e.dataTransfer?.files || [])
    if (!filesArr.length) return

    const newMetas = []
    filesArr.forEach((f, idx) => {
      const meta = {
        id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        name: f.name,
        size: f.size,
        type: f.type || 'unknown',
        zone: baseZone,
        createdAt: Date.now(),
        sessionUrl: URL.createObjectURL(f), // 다운로드용, 세션 내에서만 유효
      }
      const body = createFileBody(meta, canvasW, dropX + (idx * 14))
      Matter.Body.setVelocity(body, { x: (Math.random() - 0.5) * 2, y: 4 })
      bodyMapRef.current.set(body.id, meta)
      Matter.World.add(engineRef.current.world, body)
      newMetas.push(meta)
    })
    setFiles(prev => [...prev, ...newMetas])
  }, [])

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true) }
  const handleDragLeave = (e) => {
    // 컨테이너 안에서 자식으로 옮겨가는 경우는 무시
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragOver(false)
  }

  function clearAll() {
    if (!window.confirm('정말 모든 파일을 비울까요?')) return
    if (engineRef.current) {
      const world = engineRef.current.world
      Matter.Composite.allBodies(world).forEach(b => {
        if (bodyMapRef.current.has(b.id)) Matter.World.remove(world, b)
      })
    }
    bodyMapRef.current.clear()
    files.forEach(f => f.sessionUrl && URL.revokeObjectURL(f.sessionUrl))
    setFiles([])
  }

  function downloadOne(meta) {
    if (!meta.sessionUrl) {
      alert('새로고침 이후에는 원본 파일이 사라져 다운로드할 수 없습니다. 다시 끌어다 놓아 주세요.')
      return
    }
    const a = document.createElement('a')
    a.href = meta.sessionUrl
    a.download = meta.name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const totalBytes = files.reduce((s, f) => s + (f.size || 0), 0)
  const capacityPct = Math.min(100, (totalBytes / MAX_CAPACITY_BYTES) * 100)

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-900 text-slate-100 no-select">
      {/* TOP BAR */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-slate-700/60 bg-slate-900/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-fuchsia-400" />
          <div className="text-left">
            <h1 className="text-lg font-bold tracking-tight leading-tight">바탕화면 대청소 블록</h1>
            <p className="text-[11px] text-slate-400">Office Oasis · 끌어다 놓으면 떨어집니다</p>
          </div>
        </div>

        <div className="flex-1 mx-8 max-w-md hidden sm:block">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>적재 용량 ({files.length}개)</span>
            <span>{formatBytes(totalBytes)} / {formatBytes(MAX_CAPACITY_BYTES)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 transition-all"
              style={{ width: `${capacityPct}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPanicMode(p => !p)}
            className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs flex items-center gap-1.5 border border-slate-700"
            title="Space 키로도 전환됩니다"
          >
            <ListChecks className="w-4 h-4" /> 상사 감지 모드
          </button>
          <button
            onClick={clearAll}
            className="px-3 py-1.5 rounded-md bg-rose-600/90 hover:bg-rose-500 text-xs flex items-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" /> 전체 비우기
          </button>
        </div>
      </header>

      {/* MAIN AREA */}
      <main className="relative flex-1 overflow-hidden">
        <div
          ref={sceneRef}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900"
        />

        {dragOver && (
          <div className="absolute inset-4 border-4 border-dashed border-fuchsia-400/70 rounded-2xl pointer-events-none flex items-center justify-center">
            <div className="text-2xl font-bold text-fuchsia-300 drop-shadow">여기에 떨어뜨리세요 💫</div>
          </div>
        )}

        {files.length === 0 && !dragOver && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-slate-500">
              <p className="text-xl">파일을 끌어다 놓아 보세요 ✨</p>
              <p className="text-sm mt-2">왼쪽 → 🔥 당장 할 일 · 가운데 → 🥶 컨펌 대기 · 오른쪽 → 🗑️ 퇴사시 삭제</p>
              <p className="text-xs mt-4 text-slate-600">Space 키 = 상사 감지 모드 (엑셀 화면으로 즉시 전환)</p>
            </div>
          </div>
        )}

        {/* 상사 감지 모드: 엑셀 풍 리스트 오버레이 */}
        {panicMode && (
          <div className="absolute inset-0 bg-white text-slate-900 overflow-auto thin-scroll">
            <div className="sticky top-0 z-10 bg-emerald-700 text-white px-4 py-1.5 text-sm font-medium flex items-center justify-between">
              <span>📊 분기실적_정리표.xlsx — Microsoft Excel</span>
              <button onClick={() => setPanicMode(false)} className="text-xs underline">[보고서 닫기]</button>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300">
                  <th className="border border-slate-300 px-3 py-1.5 text-left w-12">No.</th>
                  <th className="border border-slate-300 px-3 py-1.5 text-left">파일명</th>
                  <th className="border border-slate-300 px-3 py-1.5 text-left">분류</th>
                  <th className="border border-slate-300 px-3 py-1.5 text-left">유형</th>
                  <th className="border border-slate-300 px-3 py-1.5 text-right">용량</th>
                  <th className="border border-slate-300 px-3 py-1.5 text-left">등록일</th>
                  <th className="border border-slate-300 px-3 py-1.5 text-center w-20">동작</th>
                </tr>
              </thead>
              <tbody>
                {files.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8 text-slate-400">데이터 없음</td></tr>
                )}
                {files.map((f, idx) => {
                  const zone = ZONES.find(z => z.id === f.zone) ?? ZONES[1]
                  return (
                    <tr key={f.id} className={idx % 2 ? 'bg-slate-50' : ''}>
                      <td className="border border-slate-300 px-3 py-1">{idx + 1}</td>
                      <td className="border border-slate-300 px-3 py-1 font-mono text-xs">{f.name}</td>
                      <td className="border border-slate-300 px-3 py-1">{zone.emoji} {zone.label}</td>
                      <td className="border border-slate-300 px-3 py-1 text-slate-500">{f.type || '-'}</td>
                      <td className="border border-slate-300 px-3 py-1 text-right tabular-nums">{formatBytes(f.size)}</td>
                      <td className="border border-slate-300 px-3 py-1 text-slate-500">{new Date(f.createdAt).toLocaleString('ko-KR')}</td>
                      <td className="border border-slate-300 px-3 py-1 text-center">
                        <button
                          onClick={() => downloadOne(f)}
                          className="text-xs text-emerald-700 hover:underline"
                        >
                          다운로드
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="text-center text-xs text-slate-400 py-3">Space 키를 다시 누르면 원래 화면으로 돌아갑니다.</p>
          </div>
        )}
      </main>
    </div>
  )
}
