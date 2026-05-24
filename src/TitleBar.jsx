import { Minus, Square, X, Maximize2 } from 'lucide-react'

/**
 * 공용 커스텀 타이틀바
 * - 부모에 drag-region 클래스를 두고, 버튼들은 no-drag.
 * - variant: 'light' | 'dark'
 */
export function WindowControls({ variant = 'light', onClose, closeIcon = 'X', extraButtons = null }) {
  const isDark = variant === 'dark'
  const base = isDark
    ? 'text-white/50 hover:text-white hover:bg-white/10'
    : 'text-stone-400 hover:text-stone-900 hover:bg-stone-200/60'
  const closeHover = isDark ? 'hover:bg-rose-500/30 hover:text-rose-200' : 'hover:bg-rose-100 hover:text-rose-700'

  return (
    <div className="no-drag flex items-center gap-0.5">
      {extraButtons}
      <button
        onClick={() => window.oasis?.winMinimize()}
        className={`p-1.5 rounded ${base}`}
        title="최소화"
      >
        <Minus className="w-3.5 h-3.5" strokeWidth={1.8} />
      </button>
      <button
        onClick={() => window.oasis?.winMaximizeToggle()}
        className={`p-1.5 rounded ${base}`}
        title="최대화/복원"
      >
        <Square className="w-3 h-3" strokeWidth={1.8} />
      </button>
      <button
        onClick={onClose || (() => window.oasis?.winHide())}
        className={`p-1.5 rounded ${base} ${closeHover}`}
        title="닫기"
      >
        <X className="w-4 h-4" strokeWidth={1.8} />
      </button>
    </div>
  )
}

export { Maximize2 }
