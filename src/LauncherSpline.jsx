import { useRef, useState } from 'react'
import Spline from '@splinetool/react-spline'

const SPLINE_SCENE_URL = 'https://prod.spline.design/Z2GC06YOowZpBpiO/scene.splinecode'

// 씬에서 숨길 오브젝트 이름 패턴 (배경·다른 디바이스·이펙트 안내문 등)
const HIDE_PATTERNS = [
  /^sky$/i,
  /background.*cube/i,
  /^background/i,
  /foreground/i,
  /animated.*lines?/i,
  /^Device_Laptop/i,        // 노트북 디바이스 변형
  /^Device_4[:_]?3/i,        // 4:3 디바이스 변형
  /TURN ON DOF/i,           // 안내 라벨
]

/**
 * Spline 씬 임베드 — 배경 정리 후 16:9 데스크톱 모니터만 표시.
 * onLoad 에서 scene.traverse 로 배경/장식 오브젝트를 숨긴다.
 */
export default function LauncherSpline({ tiles, onLaunch }) {
  const splineRef = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [debug, setDebug] = useState({ hidden: [], total: 0 })

  function handleLoad(splineApp) {
    splineRef.current = splineApp
    const hidden = []
    const allNames = []
    try {
      splineApp.scene.traverse((obj) => {
        if (!obj.name) return
        allNames.push(obj.name)
        if (HIDE_PATTERNS.some((p) => p.test(obj.name))) {
          obj.visible = false
          hidden.push(obj.name)
        }
      })
      // 콘솔에 전체 오브젝트 목록 — F12 로 확인 후 추가 숨김 패턴 결정 가능
      console.log('[oasis spline] scene objects:', allNames)
      console.log('[oasis spline] hidden:', hidden)
      setDebug({ hidden, total: allNames.length })
    } catch (err) {
      console.error('[oasis spline] traversal failed:', err)
    }
    setLoaded(true)
  }

  return (
    <div className="w-full h-full relative" style={{ background: '#0a0a0a' }}>
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-stone-400 z-10 pointer-events-none">
          <p className="text-sm">Spline 씬 로딩 중…</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-stone-400">
          <div className="text-center">
            <p className="text-sm">Spline 씬 로딩 실패</p>
            <p className="text-xs text-stone-500 mt-1 font-mono">{String(error)}</p>
          </div>
        </div>
      )}
      <Spline
        scene={SPLINE_SCENE_URL}
        onLoad={handleLoad}
        onError={(e) => setError(e?.message || 'unknown')}
        style={{ width: '100%', height: '100%' }}
      />

      {loaded && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] text-white/40 pointer-events-none tracking-wider">
          Spline 씬 · 배경 {debug.hidden.length}개 숨김 · F12 → Console 에서 전체 오브젝트 목록 확인
        </div>
      )}
    </div>
  )
}
