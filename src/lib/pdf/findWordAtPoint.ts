import type { WordPosition } from '@/lib/types'

const LINE_TOLERANCE = 6

export function findWordAtPoint(
  words: WordPosition[],
  x: number,
  y: number,
): WordPosition | null {
  for (const w of words) {
    if (
      x >= w.left &&
      x <= w.left + w.width &&
      y >= w.top &&
      y <= w.top + w.height
    ) {
      return w
    }
  }

  let best: WordPosition | null = null
  let bestScore = Infinity

  for (const w of words) {
    const midY = w.top + w.height / 2
    const dy = Math.abs(y - midY)
    if (dy > w.height + LINE_TOLERANCE) continue

    const dx =
      x < w.left ? w.left - x : x > w.left + w.width ? x - (w.left + w.width) : 0
    const score = dy * 8 + dx
    if (score < bestScore) {
      bestScore = score
      best = w
    }
  }

  return best
}
