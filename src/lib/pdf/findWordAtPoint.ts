import { mergePageWordsIntoClickLines } from '@/lib/pdf/lineRects'
import type { WordPosition } from '@/lib/types'

const LINE_TOLERANCE = 12
const LINE_CLICK_PAD_X = 6
const LINE_CLICK_PAD_Y = 10

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

/** Whole text line is clickable — better for paragraph / whitespace clicks. */
export function findClickTargetAtPoint(
  words: WordPosition[],
  x: number,
  y: number,
): WordPosition | null {
  if (words.length === 0) return null

  const lineRects = mergePageWordsIntoClickLines(words)
  for (const line of lineRects) {
    if (
      x >= line.left - LINE_CLICK_PAD_X &&
      x <= line.left + line.width + LINE_CLICK_PAD_X &&
      y >= line.top - LINE_CLICK_PAD_Y &&
      y <= line.top + line.height + LINE_CLICK_PAD_Y
    ) {
      const lineWords = words
        .filter(
          (w) =>
            Math.abs(w.top + w.height / 2 - (line.top + line.height / 2)) <=
              LINE_TOLERANCE &&
            w.left >= line.left - 4 &&
            w.left <= line.left + line.width + 4,
        )
        .sort((a, b) => a.left - b.left)
      const start = nearestWordOnLine(lineWords, x) ?? lineWords[0]
      if (start) return start
    }
  }

  return findWordAtPoint(words, x, y)
}

function nearestWordOnLine(lineWords: WordPosition[], x: number): WordPosition | null {
  if (lineWords.length === 0) return null

  const direct = lineWords.find(
    (w) => x >= w.left && x <= w.left + w.width,
  )
  if (direct) return direct

  let best = lineWords[0]
  let bestDist = Infinity
  for (const w of lineWords) {
    const mid = w.left + w.width / 2
    const dist = Math.abs(x - mid)
    if (dist < bestDist) {
      bestDist = dist
      best = w
    }
  }
  return best
}
