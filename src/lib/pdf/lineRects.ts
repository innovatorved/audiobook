import { HIGHLIGHT_SENTENCE_RIGHT_EXTEND_PX } from '@/lib/pdf/constants'
import type { WordPosition } from '@/lib/types'

const LINE_TOLERANCE = 6
const WORD_GAP = 1

function lineCenterY(word: WordPosition): number {
  return word.top + word.height / 2
}

export interface LineRect {
  left: number
  top: number
  width: number
  height: number
  sentenceIndex: number
  startWordIndex: number
}

export function mergeWordsIntoLineRects(words: WordPosition[]): LineRect[] {
  if (words.length === 0) return []

  const sorted = [...words].sort((a, b) => {
    const yDiff = lineCenterY(a) - lineCenterY(b)
    if (Math.abs(yDiff) > LINE_TOLERANCE) return yDiff
    return a.left - b.left
  })

  const lines: WordPosition[][] = []
  let currentLine: WordPosition[] = []
  let lineCenter = lineCenterY(sorted[0])

  for (const word of sorted) {
    const center = lineCenterY(word)
    if (currentLine.length === 0 || Math.abs(center - lineCenter) <= LINE_TOLERANCE) {
      currentLine.push(word)
      if (currentLine.length === 1) lineCenter = center
    } else {
      lines.push(currentLine)
      currentLine = [word]
      lineCenter = center
    }
  }
  if (currentLine.length > 0) lines.push(currentLine)

  return lines.map((line) => {
    line.sort((a, b) => a.left - b.left)
    const first = line[0]

    let right = 0
    for (const word of line) {
      right = Math.max(right, word.left + word.width)
    }
    for (let i = 0; i < line.length - 1; i++) {
      right = Math.max(right, line[i + 1].left - WORD_GAP)
    }
    right += HIGHLIGHT_SENTENCE_RIGHT_EXTEND_PX

    return {
      left: first.left,
      top: Math.min(...line.map((w) => w.top)),
      width: Math.max(0, right - first.left),
      height: Math.max(...line.map((w) => w.height)),
      sentenceIndex: first.sentenceIndex,
      startWordIndex: first.globalIndex,
    }
  })
}
