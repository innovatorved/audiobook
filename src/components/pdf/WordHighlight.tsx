import { toHighlightBounds } from '@/lib/pdf/highlightBounds'
import type { WordPosition } from '@/lib/types'
import type { LineRect } from '@/lib/pdf/lineRects'

interface WordHighlightProps {
  word?: WordPosition
  rect?: LineRect
  variant: 'sentence' | 'active'
  interactive?: boolean
  onClick?: () => void
}

export function WordHighlight({ word, rect, variant, interactive, onClick }: WordHighlightProps) {
  const isActive = variant === 'active'

  const bounds = rect ?? word
  if (!bounds) return null

  const box = toHighlightBounds(bounds, variant)

  const Tag = interactive ? 'button' : 'div'

  const baseClasses = interactive
    ? 'absolute cursor-pointer border-0 p-0 transition-opacity duration-150 hover:opacity-90'
    : 'pointer-events-none absolute transition-opacity duration-150'

  const style: React.CSSProperties = {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    backgroundColor: isActive ? 'var(--color-speaking-active)' : 'var(--color-speaking)',
    borderRadius: isActive ? 4 : 6,
    border: isActive
      ? '1.5px solid var(--color-speaking-border-active)'
      : '1px solid var(--color-speaking-border)',
    boxShadow: isActive
      ? '0 0 0 1px rgb(185 28 28 / 12%)'
      : '0 0 0 1px rgb(220 38 38 / 10%)',
  }

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      className={baseClasses}
      style={style}
      title={interactive ? 'Read from this line' : undefined}
      aria-label={interactive ? 'Read from this line' : undefined}
      onClick={interactive ? onClick : undefined}
    />
  )
}
