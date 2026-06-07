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
  const backgroundColor =
    variant === 'active'
      ? 'var(--color-speaking-active)'
      : 'var(--color-speaking)'

  const bounds = rect ?? word
  if (!bounds) return null

  const box = toHighlightBounds(bounds, variant)

  const Tag = interactive ? 'button' : 'div'

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      className={
        interactive
          ? 'absolute cursor-pointer border-0 p-0 transition-opacity duration-150 hover:opacity-90'
          : 'pointer-events-none absolute transition-opacity duration-150'
      }
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        backgroundColor,
        borderRadius: variant === 'active' ? 4 : 5,
        boxShadow:
          variant === 'active'
            ? '0 0 0 1px oklch(0.44 0.11 28 / 22%)'
            : '0 0 0 1px oklch(0.62 0.15 52 / 10%)',
      }}
      title={interactive ? 'Read from this line' : undefined}
      aria-label={interactive ? 'Read from this line' : undefined}
      onClick={interactive ? onClick : undefined}
    />
  )
}
