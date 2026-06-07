import {
  HIGHLIGHT_ACTIVE_PAD_X,
  HIGHLIGHT_ACTIVE_PAD_Y,
  HIGHLIGHT_ACTIVE_RIGHT_EXTEND_PX,
  HIGHLIGHT_DISPLAY_RATIO,
  HIGHLIGHT_SENTENCE_PAD_X,
  HIGHLIGHT_SENTENCE_PAD_Y,
} from '@/lib/pdf/constants'

export interface HighlightBounds {
  left: number
  top: number
  width: number
  height: number
}

export function toHighlightBounds(
  bounds: { left: number; top: number; width: number; height: number },
  variant: 'sentence' | 'active',
): HighlightBounds {
  const padX = variant === 'active' ? HIGHLIGHT_ACTIVE_PAD_X : HIGHLIGHT_SENTENCE_PAD_X
  const padY = variant === 'active' ? HIGHLIGHT_ACTIVE_PAD_Y : HIGHLIGHT_SENTENCE_PAD_Y
  const rightExtend = variant === 'active' ? HIGHLIGHT_ACTIVE_RIGHT_EXTEND_PX : 0

  const displayHeight = bounds.height * HIGHLIGHT_DISPLAY_RATIO
  const verticalInset = (bounds.height - displayHeight) / 2

  return {
    left: bounds.left - padX,
    top: bounds.top + verticalInset - padY,
    width: bounds.width + rightExtend + padX * 2,
    height: displayHeight + padY * 2,
  }
}
