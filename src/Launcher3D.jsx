import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Html, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

/* ───────── 카테고리 색 (라이트 테마와 결 맞춤) ───────── */

const CAT_COLORS = {
  all:      '#a8a29e',
  favorite: '#d97706',
  app:      '#0284c7',
  game:     '#be123c',
  web:      '#1d4ed8',
  tool:     '#57534e',
  media:    '#047857',
}

function shortHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

/* ───────── 3D 카드 ───────── */

function Card3D({ tile, position, onLaunch, onContextMenu }) {
  const meshRef = useRef()
  const [hovered, setHovered] = useState(false)
  const catColor = CAT_COLORS[tile.category] || CAT_COLORS.app

  useFrame((_, delta) => {
    if (!meshRef.current) return
    const target = hovered ? 1.12 : 1
    meshRef.current.scale.x = THREE.MathUtils.lerp(meshRef.current.scale.x, target, Math.min(1, delta * 12))
    meshRef.current.scale.y = THREE.MathUtils.lerp(meshRef.current.scale.y, target, Math.min(1, delta * 12))
    meshRef.current.scale.z = THREE.MathUtils.lerp(meshRef.current.scale.z, target, Math.min(1, delta * 12))
    const zTarget = hovered ? 0.45 : 0
    meshRef.current.position.z = THREE.MathUtils.lerp(meshRef.current.position.z, zTarget, Math.min(1, delta * 12))
  })

  return (
    <group
      ref={meshRef}
      position={position}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
      onClick={(e) => { e.stopPropagation(); onLaunch(tile) }}
      onContextMenu={(e) => { e.stopPropagation(); onContextMenu?.(tile, e) }}
    >
      <RoundedBox args={[1.4, 1.4, 0.1]} radius={0.08} smoothness={4}>
        <meshStandardMaterial color={hovered ? '#ffffff' : '#fafafa'} roughness={0.4} metalness={0.05} />
      </RoundedBox>
      {/* 카테고리 색 띠 */}
      <mesh position={[0, 0.66, 0.06]}>
        <planeGeometry args={[1.4, 0.06]} />
        <meshBasicMaterial color={catColor} />
      </mesh>
      {/* HTML 오버레이 — 아이콘 + 라벨 */}
      <Html
        center
        position={[0, 0, 0.07]}
        transform
        distanceFactor={4.5}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div style={{
          width: 220, height: 220,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 12, color: '#1c1917',
        }}>
          {tile.iconDataUrl ? (
            <img src={tile.iconDataUrl} alt="" style={{ width: 96, height: 96, objectFit: 'contain', marginBottom: 14 }} />
          ) : (
            <div style={{
              width: 96, height: 96, marginBottom: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: catColor, color: 'white', fontSize: 40, fontWeight: 700,
            }}>
              {(tile.title || '?').trim().charAt(0).toUpperCase()}
            </div>
          )}
          <p style={{ fontSize: 18, fontWeight: 600, margin: 0, textAlign: 'center', lineHeight: 1.2,
                      maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tile.title}
          </p>
          <p style={{ fontSize: 13, color: '#a8a29e', margin: '6px 0 0', fontFamily: 'monospace' }}>
            {tile.type === 'url' ? shortHost(tile.target) : (tile.category || '앱')}
          </p>
        </div>
      </Html>
    </group>
  )
}

/* ───────── 씬 — 카드 그리드 + 마우스 패럴랙스 ───────── */

function Scene({ tiles, onLaunch, onContextMenu }) {
  const groupRef = useRef()

  useFrame((state, delta) => {
    if (!groupRef.current) return
    const targetY = state.mouse.x * 0.25
    const targetX = -state.mouse.y * 0.15
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetY, Math.min(1, delta * 3))
    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, targetX, Math.min(1, delta * 3))
  })

  const positions = useMemo(() => {
    const cols = Math.min(6, Math.ceil(Math.sqrt(tiles.length * 1.6)))
    const gap = 1.7
    const result = []
    for (let i = 0; i < tiles.length; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = (col - (cols - 1) / 2) * gap
      const y = -(row - (Math.ceil(tiles.length / cols) - 1) / 2) * gap
      // 살짝 깊이감 — 행마다 작은 z 오프셋
      const z = (row % 2 === 0 ? 0 : -0.15)
      result.push([x, y, z])
    }
    return result
  }, [tiles.length])

  return (
    <group ref={groupRef}>
      {tiles.map((tile, i) => (
        <Card3D
          key={tile.id}
          tile={tile}
          position={positions[i]}
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
    <div className="w-full h-full" style={{
      background: 'radial-gradient(ellipse at center, #f5f5f4 0%, #e7e5e4 100%)',
    }}>
      <Canvas
        camera={{ position: [0, 0, 8], fov: 55 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 6, 5]} intensity={0.55} castShadow />
        <directionalLight position={[-5, -3, 4]} intensity={0.25} color="#fde68a" />
        <Scene tiles={tiles} onLaunch={onLaunch} onContextMenu={onContextMenu} />
      </Canvas>
    </div>
  )
}
