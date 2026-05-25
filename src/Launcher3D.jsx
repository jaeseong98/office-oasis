import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, RoundedBox, Sparkles } from '@react-three/drei'
import * as THREE from 'three'

const ZOOM_KEY = 'oasis:launcher3d-zoom'
const ZOOM_MIN = 5
const ZOOM_MAX = 16
const ZOOM_DEFAULT = 9.5

function loadZoom() {
  const v = parseFloat(localStorage.getItem(ZOOM_KEY))
  if (Number.isFinite(v) && v >= ZOOM_MIN && v <= ZOOM_MAX) return v
  return ZOOM_DEFAULT
}

/* 카테고리 색 — 어두운 씬에서도 잘 보이는 톤 */
const CAT_COLORS = {
  all:      '#64748b',
  favorite: '#f59e0b',
  app:      '#0ea5e9',
  game:     '#e11d48',
  web:      '#3b82f6',
  tool:     '#64748b',
  media:    '#10b981',
}

function shortHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

/* ───────── 모니터 풍 카드 ───────── */

function MonitorCard({ tile, index, total, ringRotRef, dragRef, onLaunch, onContextMenu }) {
  const meshRef = useRef()
  const [hovered, setHovered] = useState(false)

  const baseAngle = (index / total) * Math.PI * 2
  const R = total <= 6 ? 2.8 : 3.6

  useFrame((_, delta) => {
    if (!meshRef.current) return
    const angle = baseAngle + ringRotRef.current
    meshRef.current.position.x = Math.sin(angle) * R
    meshRef.current.position.z = Math.cos(angle) * R
    meshRef.current.rotation.y = angle

    const targetScale = hovered ? 1.1 : 1
    const k = Math.min(1, delta * 10)
    meshRef.current.scale.setScalar(THREE.MathUtils.lerp(meshRef.current.scale.x, targetScale, k))
  })

  const catColor = CAT_COLORS[tile.category] || CAT_COLORS.app

  function handleClick(e) {
    e.stopPropagation()
    if (dragRef.current?.didMove) return
    onLaunch(tile)
  }

  return (
    <group ref={meshRef}>
      {/* 모니터 베젤 (어두운 프레임) */}
      <RoundedBox
        args={[1.6, 1.0, 0.08]}
        radius={0.05}
        smoothness={4}
        castShadow
        receiveShadow
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
        onClick={handleClick}
        onContextMenu={(e) => { e.stopPropagation(); onContextMenu?.(tile, e.nativeEvent || e) }}
      >
        <meshStandardMaterial color="#1a1a1a" roughness={0.55} metalness={0.35} />
      </RoundedBox>

      {/* 화면 (인셋) */}
      <mesh position={[0, 0, 0.045]}>
        <planeGeometry args={[1.48, 0.88]} />
        <meshStandardMaterial color={catColor} roughness={0.4} metalness={0.05} emissive={catColor} emissiveIntensity={0.15} />
      </mesh>

      {/* 모니터 받침 */}
      <mesh position={[0, -0.6, 0]} castShadow>
        <boxGeometry args={[0.4, 0.08, 0.12]} />
        <meshStandardMaterial color="#0f0f0f" roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, -0.52, 0]}>
        <boxGeometry args={[0.05, 0.16, 0.05]} />
        <meshStandardMaterial color="#0f0f0f" roughness={0.6} metalness={0.3} />
      </mesh>

      {/* 화면 콘텐츠 */}
      <Html
        center
        transform
        position={[0, 0, 0.09]}
        distanceFactor={6}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div style={{
          width: 280, height: 170,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 12, color: '#ffffff', textAlign: 'center',
        }}>
          {tile.iconDataUrl ? (
            <div style={{
              width: 64, height: 64, marginBottom: 10,
              background: 'rgba(255,255,255,0.96)', borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
            }}>
              <img src={tile.iconDataUrl} alt="" style={{ width: 48, height: 48, objectFit: 'contain' }} />
            </div>
          ) : (
            <div style={{
              width: 64, height: 64, marginBottom: 10,
              fontSize: 32, fontWeight: 700, color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.16)', borderRadius: 12,
            }}>
              {(tile.title || '?').trim().charAt(0).toUpperCase()}
            </div>
          )}
          <p style={{
            fontSize: 18, fontWeight: 700, margin: 0, lineHeight: 1.1,
            maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textShadow: '0 2px 12px rgba(0,0,0,0.4)',
          }}>
            {tile.title}
          </p>
          <p style={{
            fontSize: 10, color: 'rgba(255,255,255,0.75)', margin: '4px 0 0',
            fontFamily: 'ui-monospace, Consolas, monospace',
            textShadow: '0 1px 4px rgba(0,0,0,0.4)',
            letterSpacing: '0.05em', textTransform: 'uppercase',
          }}>
            {tile.type === 'url' ? shortHost(tile.target) : (tile.category || 'APP')}
          </p>
        </div>
      </Html>
    </group>
  )
}

/* ───────── 배경 — 검은 건물 같은 블록들 ───────── */

function BackgroundBlocks() {
  const blocks = useMemo(() => {
    const arr = []
    // 시드 고정해서 매 렌더마다 동일하게
    let seed = 1
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }
    for (let i = 0; i < 26; i++) {
      const angle = (i / 26) * Math.PI * 2 + rnd() * 0.2
      const ringR = 8 + rnd() * 6
      const x = Math.sin(angle) * ringR
      const z = Math.cos(angle) * ringR
      const h = 1.5 + rnd() * 5
      const w = 1.0 + rnd() * 1.6
      const d = 1.0 + rnd() * 1.6
      arr.push({ x, z, h, w, d })
    }
    return arr
  }, [])

  return (
    <group>
      {blocks.map((b, i) => (
        <mesh key={i} position={[b.x, b.h / 2 - 2.5, b.z]} castShadow receiveShadow>
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshStandardMaterial color="#141414" roughness={0.95} metalness={0.05} />
        </mesh>
      ))}
    </group>
  )
}

/* ───────── 격자 바닥 (대각선) ───────── */

function GridFloor() {
  return (
    <group position={[0, -2.5, 0]} rotation={[0, Math.PI / 4, 0]}>
      <gridHelper args={[40, 40, '#222', '#181818']} />
    </group>
  )
}

/* ───────── 링 ───────── */

function Ring({ tiles, ringRotRef, targetRotRef, dragRef, onLaunch, onContextMenu }) {
  useFrame((_, delta) => {
    ringRotRef.current = THREE.MathUtils.lerp(
      ringRotRef.current, targetRotRef.current, Math.min(1, delta * 6),
    )
  })

  return (
    <group>
      {tiles.map((tile, i) => (
        <MonitorCard
          key={tile.id}
          tile={tile}
          index={i}
          total={tiles.length}
          ringRotRef={ringRotRef}
          dragRef={dragRef}
          onLaunch={onLaunch}
          onContextMenu={onContextMenu}
        />
      ))}
    </group>
  )
}

/* ───────── 카메라 줌 ───────── */

function CameraZoom({ targetZ }) {
  const { camera } = useThree()
  useFrame((_, delta) => {
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, Math.min(1, delta * 6))
    camera.updateProjectionMatrix()
  })
  return null
}

/* ───────── 메인 ───────── */

export default function Launcher3D({ tiles, onLaunch, onContextMenu }) {
  const [zoom, setZoom] = useState(loadZoom)
  const [showHint, setShowHint] = useState(false)
  const hintTimerRef = useRef(null)
  const dragRef = useRef({ active: false, startX: 0, lastX: 0, didMove: false })
  const targetRotRef = useRef(0)
  const ringRotRef = useRef(0)

  useEffect(() => {
    try { localStorage.setItem(ZOOM_KEY, String(zoom)) } catch { /* ignore */ }
  }, [zoom])

  function handleWheel(e) {
    if (!e.ctrlKey) return
    e.preventDefault(); e.stopPropagation()
    const step = 0.6
    setZoom(z => THREE.MathUtils.clamp(z + (e.deltaY > 0 ? step : -step), ZOOM_MIN, ZOOM_MAX))
    setShowHint(true)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setShowHint(false), 900)
  }

  function onPointerDown(e) {
    if (e.button !== 0) return
    dragRef.current = { active: true, startX: e.clientX, lastX: e.clientX, didMove: false }
  }
  function onPointerMove(e) {
    if (!dragRef.current.active) return
    const dx = e.clientX - dragRef.current.lastX
    if (Math.abs(e.clientX - dragRef.current.startX) > 4) dragRef.current.didMove = true
    targetRotRef.current += dx * 0.006
    dragRef.current.lastX = e.clientX
  }
  function onPointerUp() {
    dragRef.current.active = false
  }

  const fogNear = zoom - 0.5
  const fogFar  = zoom + 5

  return (
    <div
      className="w-full h-full relative"
      style={{
        background: 'radial-gradient(ellipse at 50% 40%, #1a1a1a 0%, #0a0a0a 70%, #050505 100%)',
        cursor: dragRef.current.active ? 'grabbing' : 'grab',
      }}
      onWheel={handleWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <Canvas
        camera={{ position: [0, 0.8, ZOOM_DEFAULT], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        shadows
      >
        <color attach="background" args={['#0a0a0a']} />
        <fog attach="fog" args={['#050505', fogNear, fogFar]} />

        {/* 라이팅 */}
        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 8, 5]} intensity={0.7} castShadow color="#e0e7ff" />
        <pointLight position={[-4, 2, 3]} intensity={0.4} color="#f59e0b" />
        <pointLight position={[4, -1, -2]} intensity={0.2} color="#3b82f6" />

        <CameraZoom targetZ={zoom} />
        <GridFloor />
        <BackgroundBlocks />
        <Sparkles count={120} scale={[18, 8, 14]} size={2.5} speed={0.3} color="#f59e0b" opacity={0.7} />

        <Ring
          tiles={tiles}
          ringRotRef={ringRotRef}
          targetRotRef={targetRotRef}
          dragRef={dragRef}
          onLaunch={onLaunch}
          onContextMenu={onContextMenu}
        />
      </Canvas>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] text-white/40 pointer-events-none tracking-wider">
        좌우 드래그 = 회전 · 클릭 = 실행 · <span className="font-mono">Ctrl + Scroll</span> = 줌
      </div>

      {showHint && (
        <div className="absolute top-4 right-4 px-2.5 py-1 bg-white/10 text-white text-[11px] tnum rounded pointer-events-none backdrop-blur">
          줌 {(zoom).toFixed(1)}
        </div>
      )}
    </div>
  )
}
