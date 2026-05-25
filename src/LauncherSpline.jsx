import { useState } from 'react'
import Spline from '@splinetool/react-spline'

// 사용자가 제공한 Spline 씬 URL
const SPLINE_SCENE_URL = 'https://prod.spline.design/Z2GC06YOowZpBpiO/scene.splinecode'

/**
 * Spline 씬을 그대로 임베드한 런처 뷰.
 * 씬 안의 카드 오브젝트를 우리 타일 데이터로 매핑하려면 씬 디자인이
 * runtime API 친화적으로 되어 있어야 한다 (오브젝트 이름, 텍스처 교체 가능 등).
 * 현재는 씬을 그대로 보여주는 "데모/배경" 모드.
 */
export default function LauncherSpline({ tiles, onLaunch }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)

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
        onLoad={() => setLoaded(true)}
        onError={(e) => setError(e?.message || 'unknown')}
        style={{ width: '100%', height: '100%' }}
      />

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] text-white/50 pointer-events-none tracking-wider">
        Spline 데모 씬 · 마우스로 카메라 조작
      </div>
    </div>
  )
}
