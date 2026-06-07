import { LINE_TOLERANCE } from '@/lib/pdf/constants'

const WORD_GAP = 2
const MAX_EXPAND_SLACK_RATIO = 1.5

type WordLike = { left: number; top: number; width: number; height: number; text?: string }

function clampLineWordWidths(line: WordLike[]): void {
  line.sort((a, b) => a.left - b.left)

  for (let i = 0; i < line.length - 1; i++) {
    const word = line[i]
    const nextLeft = line[i + 1].left
    const gap = nextLeft - word.left - WORD_GAP
    if (gap <= 0) continue

    if (word.width > gap) {
      word.width = gap
      continue
    }

    const reportedRight = word.left + word.width
    const slack = nextLeft - reportedRight
    const maxSlack = (word.height || 12) * MAX_EXPAND_SLACK_RATIO
    if (slack > 0 && slack <= maxSlack) {
      word.width = gap
    }
  }
}

export function clampWordWidths<T extends WordLike>(words: T[]): T[] {
  if (words.length === 0) return words

  const sorted = [...words].sort((a, b) => {
    const topDiff = a.top - b.top
    if (Math.abs(topDiff) > LINE_TOLERANCE) return topDiff
    return a.left - b.left
  })

  const lines: T[][] = []
  let currentLine: T[] = []
  let lineTop = sorted[0].top

  for (const word of sorted) {
    if (currentLine.length === 0 || Math.abs(word.top - lineTop) <= LINE_TOLERANCE) {
      currentLine.push(word)
      if (currentLine.length === 1) lineTop = word.top
    } else {
      lines.push(currentLine)
      currentLine = [word]
      lineTop = word.top
    }
  }
  if (currentLine.length > 0) lines.push(currentLine)

  for (const line of lines) {
    clampLineWordWidths(line)
  }

  return sorted
}
