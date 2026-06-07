import type { WordPosition } from '@/lib/types'

export interface OcrWord {
  text: string
  left: number
  top: number
  width: number
  height: number
}

export function mapOcrWordsToPositions(
  words: OcrWord[],
  pageNum: number,
): Omit<WordPosition, 'globalIndex' | 'sentenceIndex'>[] {
  return words
    .filter((w) => w.text.trim().length > 0)
    .map((w) => ({
      text: w.text,
      pageNum,
      left: w.left,
      top: w.top,
      width: w.width,
      height: w.height,
    }))
}
