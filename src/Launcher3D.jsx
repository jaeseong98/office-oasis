import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, RoundedBox } from '@react-three/drei'
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

const CAT_COLORS = {
  all:      '#94a3b8',
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

/* ───────── 카드 ───────── */

function CarouselCard({ tile, index, total, ringRotRef, dragRef, onLaunch, onContextMenu }) {
  const meshRef = useRef()
  const [hovered, setHovered] = useState(false)

  const baseAngle = (index / total) * Math.PI * 2
  const R = total <= 6 ? 2.6 : 3.4

  useFrame((_, delta) => {
    if (!meshRef.current) return
    const angle = baseAngle + ringRotRef.current
    meshRef.current.position.x = Math.sin(angle) * R
    meshRef.current.position.z = Math.cos(angle) * R
    meshRef.current.rotation.y = angle

    const targetScale = hovered ? 1.12 : 1
    const k = Math.min(1, delta * 10)
    const cur = meshRef.current.scale.x
    const next = THREE.MathUtils.lerp(cur, targetScale, k)
    meshRef.current.scale.setScalar(next)
  })

  const catColor = CAT_COLORS[tile.category] || CAT_COLORS.app

  function handleClick(e) {
    e.stopPropagation()
    // 드래그한 거면 실행 안 함
    if (dragRef.current?.didMove) return
    onLaunch(tile)
  }

  return (
    <group ref={meshRef}>
      <RoundedBox
        args={[1.3, 1.5, 0.08]}
        radius={0.12}
        smoothness={4}
        castShadow
        receiveShadow
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
        onClick={handleClick}
        onContextMenu={(e) => { e.stopPropagation(); onContextMenu?.(tile, e.nativeEvent || e) }}
      >
        <meshStandardMaterial color={catColor} roughness={0.45} metalness={0.15} />
      </RoundedBox>

      <Html
        center
        transform
        position={[0, 0, 0.05]}
        distanceFactor={6}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div style={{
          width: 220, height: 250,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 16, color: '#ffffff', textAlign: 'center',
        }}>
          {tile.iconDataUrl ? (
            <div style={{
              width: 96, height: 96, marginBottom: 16,
              background: 'rgba(255,255,255,0.96)', borderRadius: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
            }}>
              <img src={tile.iconDataUrl} alt="" style={{ width: 72, height: 72, objectFit: 'contain' }} />
            </div>
          ) : (
            <div style={{
              width: 96, height: 96, marginBottom: 16,
              fontSize: 50, fontWeight: 700, color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.16)', borderRadius: 18,
            }}>
              {(tile.title || '?').trim().charAt(0).toUpperCase()}
            </div>
          )}
          <p style={{
            fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.15,
            maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textShadow: '0 2px 10px rgba(0,0,0,0.35)',
          }}>
            {tile.title}
          </p>
          <p style={{
            fontSize: 12, color: 'rgba(255,255,255,0.85)', margin: '6px 0 0',
            fontFamily: 'ui-monospace, Consolas, monospace',
            textShadow: '0 2px 6px rgba(0,0,0,0.3)',
          }}>
            {tile.type === 'url' ? shortHost(tile.target) : (tile.category || '앱')}
          </p>
        </div>
      </Html>
    </group>
  )
}

/* ───────── 링 (드래그로 회전) ───────── */

function Ring({ tiles, ringRotRef, targetRotRef, dragRef, onLaunch, onContextMenu }) {
  useFrame((_, delta) => {
    // target 으로 부드럽게 따라감
    ringRotRef.current = THREE.MathUtils.lerp(
      ringRotRef.current,
      targetRotRef.current,
      Math.min(1, delta * 6),
    )
  })

  return (
    <group>
      {tiles.map((tile, i) => (
        <CarouselCard
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
    e.preventDefault()
    e.stopPropagation()
    const step = 0.6
    setZoom(z => THREE.MathUtils.clamp(z + (e.deltaY > 0 ? step : -step), ZOOM_MIN, ZOOM_MAX))
    setShowHint(true)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setShowHint(false), 900)
  }

  // 드래그 — 좌우로 끌면 링 회전
  function onPointerDown(e) {
    if (e.button !== 0) return
    dragRef.current = { active: true, startX: e.clientX, lastX: e.clientX, didMove: false }
  }
  function onPointerMove(e) {
    if (!dragRef.current.active) return
    const dx = e.clientX - dragRef.current.lastX
    if (Math.abs(e.clientX - dragRef.current.startX) > 4) {
      dragRef.current.didMove = true
    }
    // 픽셀 → 라디안 변환 (감도)
    targetRotRef.current += dx * 0.006
    dragRef.current.lastX = e.clientX
  }
  function onPointerUp() {
    // didMove 는 다음 onClick 에서 카드가 읽고 나서 자연스럽게 리셋됨 (다음 pointerdown 까지 유지)
    dragRef.current.active = false
  }

  const fogNear = zoom - 0.5
  const fogFar  = zoom + 4.5

  return (
    <div
      className="w-full h-full relative"
      style={{
        background: 'radial-gradient(ellipse at 50% 30%, #ffffff 0%, #f5f5f4 60%, #e7e5e4 100%)',
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
        gl={{ antialias: true, alpha: true }}
        shadows
      >
        <fog attach="fog" args={['#fafaf9', fogNear, fogFar]} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[3, 6, 5]} intensity={0.75} castShadow />
        <directionalLight position={[-4, -2, 3]} intensity={0.22} color="#fde68a" />

        <CameraZoom targetZ={zoom} />
        <Ring
          tiles={tiles}
          ringRotRef={ringRotRef}
          targetRotRef={targetRotRef}
          dragRef={dragRef}
          onLaunch={onLaunch}
          onContextMenu={onContextMenu}
        />
      </Canvas>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] text-stone-400 pointer-events-none tracking-wider">
        좌우 드래그 = 회전 · 클릭 = 실행 · <span className="font-mono">Ctrl + Scroll</span> = 줌
      </div>

      {showHint && (
        <div className="absolute top-4 right-4 px-2.5 py-1 bg-stone-900/80 text-white text-[11px] tnum rounded pointer-events-none">
          줌 {(zoom).toFixed(1)}
        </div>
      )}
    </div>
  )
}
