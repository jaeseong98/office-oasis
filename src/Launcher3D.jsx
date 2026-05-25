import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Html, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

/* ───────── 카테고리 색 ───────── */

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

/* ───────── 카루셀 카드 ───────── */

function CarouselCard({ tile, index, total, ringRotRef, isPausedRef, onLaunch, onContextMenu }) {
  const meshRef = useRef()
  const [hovered, setHovered] = useState(false)

  const baseAngle = (index / total) * Math.PI * 2
  const R = total <= 6 ? 2.6 : 3.4

  useFrame((_, delta) => {
    if (!meshRef.current) return
    const angle = baseAngle + ringRotRef.current
    const x = Math.sin(angle) * R
    const z = Math.cos(angle) * R
    meshRef.current.position.x = x
    meshRef.current.position.z = z
    meshRef.current.rotation.y = angle  // 카드가 바깥쪽 향함

    // 호버 시 살짝 확대 + 앞으로 떠오르기
    const targetScale = hovered ? 1.12 : 1
    const k = Math.min(1, delta * 10)
    const cur = meshRef.current.scale.x
    const next = THREE.MathUtils.lerp(cur, targetScale, k)
    meshRef.current.scale.setScalar(next)
  })

  const catColor = CAT_COLORS[tile.category] || CAT_COLORS.app

  return (
    <group
      ref={meshRef}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); isPausedRef.current = true; document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHovered(false); isPausedRef.current = false; document.body.style.cursor = 'auto' }}
      onClick={(e) => { e.stopPropagation(); onLaunch(tile) }}
      onContextMenu={(e) => { e.stopPropagation(); onContextMenu?.(tile, e) }}
    >
      {/* 베이스 카드 — 카테고리 색의 컬러풀 라운드 박스 */}
      <RoundedBox args={[1.3, 1.5, 0.08]} radius={0.12} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color={catColor} roughness={0.45} metalness={0.15} />
      </RoundedBox>

      {/* 컨텐츠 (아이콘 + 라벨) */}
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

/* ───────── 링 (자동 회전) ───────── */

function Ring({ tiles, onLaunch, onContextMenu }) {
  const ringRotRef = useRef(0)
  const isPausedRef = useRef(false)
  const groupRef = useRef()

  useFrame((state, delta) => {
    // 자동 회전 (호버 중엔 정지)
    if (!isPausedRef.current) {
      ringRotRef.current += delta * 0.18
    }
    // 마우스 Y에 따라 살짝 위·아래로 틸트
    if (groupRef.current) {
      const targetX = -state.mouse.y * 0.12
      groupRef.current.rotation.x = THREE.MathUtils.lerp(
        groupRef.current.rotation.x, targetX, Math.min(1, delta * 3),
      )
    }
  })

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {tiles.map((tile, i) => (
        <CarouselCard
          key={tile.id}
          tile={tile}
          index={i}
          total={tiles.length}
          ringRotRef={ringRotRef}
          isPausedRef={isPausedRef}
          onLaunch={onLaunch}
          onContextMenu={onContextMenu}
        />
      ))}
    </group>
  )
}

/* ───────── 메인 ───────── */

export default function Launcher3D({ tiles, onLaunch, onContextMenu }) {
  return (
    <div className="w-full h-full relative" style={{
      background: 'radial-gradient(ellipse at 50% 30%, #ffffff 0%, #f5f5f4 60%, #e7e5e4 100%)',
    }}>
      <Canvas
        camera={{ position: [0, 0.8, 7.5], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        shadows
      >
        {/* fog — 뒤쪽 카드를 부드럽게 페이드 (DOF 흉내) */}
        <fog attach="fog" args={['#fafaf9', 7, 12]} />

        {/* 라이팅 */}
        <ambientLight intensity={0.65} />
        <directionalLight position={[3, 6, 5]} intensity={0.75} castShadow />
        <directionalLight position={[-4, -2, 3]} intensity={0.22} color="#fde68a" />

        <Ring tiles={tiles} onLaunch={onLaunch} onContextMenu={onContextMenu} />
      </Canvas>

      {/* 안내 텍스트 */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] text-stone-400 pointer-events-none tracking-wider">
        호버하면 회전 정지 · 클릭해서 실행
      </div>
    </div>
  )
}
