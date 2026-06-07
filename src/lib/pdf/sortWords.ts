import { LINE_TOLERANCE } from '@/lib/pdf/constants'

function lineCenterY(word: { top: number; height: number }): number {
  return word.top + word.height / 2
}

/** Sort words in visual reading order: top-to-bottom, left-to-right. */
export function sortWordsByReadingOrder<T extends { top: number; left: number; height: number }>(
  words: T[],
): T[] {
  return [...words].sort((a, b) => {
    const yDiff = lineCenterY(a) - lineCenterY(b)
    if (Math.abs(yDiff) > LINE_TOLERANCE) return yDiff
    return a.left - b.left
  })
}
