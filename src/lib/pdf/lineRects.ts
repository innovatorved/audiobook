import { HIGHLIGHT_SENTENCE_RIGHT_EXTEND_PX, LINE_TOLERANCE } from '@/lib/pdf/constants'
import type { WordPosition } from '@/lib/types'
const WORD_GAP = 1
const MAX_LINE_LEFT_STEP = 120
const SENTENCE_BOUNDARY_GAP = 3

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

function groupWordsIntoLines(words: WordPosition[]): WordPosition[][] {
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

  return lines
}

function overlapsVerticalBand(
  word: WordPosition,
  bandTop: number,
  bandBottom: number,
  pad = 10,
): boolean {
  const wordBottom = word.top + word.height
  const wordMid = word.top + word.height / 2
  return (
    wordMid >= bandTop - pad &&
    wordMid <= bandBottom + pad &&
    word.top <= bandBottom + pad &&
    wordBottom >= bandTop - pad
  )
}

function wordRightEdge(words: WordPosition[], index: number): number {
  const word = words[index]
  let right = word.left + word.width
  if (index < words.length - 1) {
    right = Math.max(right, words[index + 1].left - WORD_GAP)
  }
  return right
}

function lineRightForSentenceOnPageLine(
  pageOnLine: WordPosition[],
  sentOnLine: WordPosition[],
): number {
  const sentenceIndex = sentOnLine[0].sentenceIndex
  const sentIds = new Set(sentOnLine.map((w) => w.globalIndex))
  const hitIndices = pageOnLine
    .map((w, i) => (sentIds.has(w.globalIndex) ? i : -1))
    .filter((i) => i >= 0)

  if (hitIndices.length === 0) {
    return (
      Math.max(...sentOnLine.map((w) => w.left + w.width)) +
      HIGHLIGHT_SENTENCE_RIGHT_EXTEND_PX
    )
  }

  const firstIdx = Math.min(...hitIndices)
  const lastIdx = Math.max(...hitIndices)
  let right = pageOnLine[firstIdx].left
  let nextSentenceLeft = Number.POSITIVE_INFINITY

  for (let i = firstIdx; i <= lastIdx; i++) {
    right = Math.max(right, wordRightEdge(pageOnLine, i))
  }

  for (let i = lastIdx + 1; i < pageOnLine.length; i++) {
    if (pageOnLine[i].sentenceIndex !== sentenceIndex) {
      nextSentenceLeft = pageOnLine[i].left
      break
    }
    const leftStep = pageOnLine[i].left - pageOnLine[i - 1].left
    if (leftStep > MAX_LINE_LEFT_STEP) break
    right = Math.max(right, wordRightEdge(pageOnLine, i))
  }

  const extendedRight = right + HIGHLIGHT_SENTENCE_RIGHT_EXTEND_PX
  if (Number.isFinite(nextSentenceLeft)) {
    return Math.min(extendedRight, Math.max(right, nextSentenceLeft - SENTENCE_BOUNDARY_GAP))
  }
  return extendedRight
}

function lineLeftFromPageWords(
  pageOnLine: WordPosition[],
  sentOnLine: WordPosition[],
  startIdx: number,
): number {
  const sentenceIndex = sentOnLine[0].sentenceIndex
  const sentLeft = Math.min(...sentOnLine.map((w) => w.left))
  let left = sentLeft

  const firstSent = sentOnLine.reduce(
    (min, w) => (w.globalIndex < min.globalIndex ? w : min),
    sentOnLine[0],
  )
  const anchorIdx = pageOnLine.findIndex((w) => w.globalIndex === firstSent.globalIndex)
  if (anchorIdx > 0) {
    for (let i = anchorIdx - 1; i >= startIdx; i--) {
      if (pageOnLine[i].sentenceIndex !== sentenceIndex) break
      const leftStep = pageOnLine[i + 1].left - pageOnLine[i].left
      if (leftStep > MAX_LINE_LEFT_STEP) break
      left = Math.min(left, pageOnLine[i].left)
    }
  }

  return left
}

/** Click targets — each line starts at the first word ON THAT LINE. */
export function mergePageWordsIntoClickLines(pageWords: WordPosition[]): LineRect[] {
  return groupWordsIntoLines(pageWords).map((line) => {
    line.sort((a, b) => a.left - b.left)
    const first = line[0]
    const right = Math.max(...line.map((w, i) => wordRightEdge(line, i)))
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

/** Sentence highlight — one rect per visual page line (display only). */
export function mergeSentenceHighlightRects(
  sentenceWords: WordPosition[],
  pageWords: WordPosition[],
): LineRect[] {
  if (sentenceWords.length === 0 || pageWords.length === 0) return []

  const sentenceIndex = sentenceWords[0].sentenceIndex
  const pageLines = groupWordsIntoLines(pageWords)
  const rects: LineRect[] = []

  for (const pageLine of pageLines) {
    pageLine.sort((a, b) => a.left - b.left)
    const bandTop = Math.min(...pageLine.map((w) => w.top))
    const bandBottom = Math.max(...pageLine.map((w) => w.top + w.height))

    const sentOnLine = sentenceWords.filter((w) =>
      overlapsVerticalBand(w, bandTop, bandBottom),
    )
    if (sentOnLine.length === 0) continue

    const minSentLeft = Math.min(...sentOnLine.map((w) => w.left))
    const startIdx = pageLine.findIndex((w) => w.left >= minSentLeft - 48)
    const resolvedStart = startIdx >= 0 ? startIdx : 0
    const lineStartWord = sentOnLine.reduce(
      (min, w) => (w.globalIndex < min.globalIndex ? w : min),
      sentOnLine[0],
    )

    const left = lineLeftFromPageWords(pageLine, sentOnLine, resolvedStart)
    const right = lineRightForSentenceOnPageLine(pageLine, sentOnLine)

    rects.push({
      left,
      top: bandTop,
      width: Math.max(0, right - left),
      height: Math.max(...pageLine.map((w) => w.height)),
      sentenceIndex,
      startWordIndex: lineStartWord.globalIndex,
    })
  }

  return mergeHighlightRectsByBand(rects)
}

function mergeHighlightRectsByBand(rects: LineRect[]): LineRect[] {
  if (rects.length <= 1) return rects

  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left)
  const merged: LineRect[] = []

  for (const rect of sorted) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      Math.abs(rect.top - prev.top) <= LINE_TOLERANCE &&
      rect.left <= prev.left + prev.width + 48
    ) {
      const left = Math.min(prev.left, rect.left)
      const right = Math.max(prev.left + prev.width, rect.left + rect.width)
      prev.left = left
      prev.width = right - left
      prev.top = Math.min(prev.top, rect.top)
      prev.height = Math.max(prev.height, rect.height)
      continue
    }
    merged.push({ ...rect })
  }

  return merged
}

/** @deprecated Use mergePageWordsIntoClickLines or mergeSentenceHighlightRects */
export function mergeWordsIntoLineRects(
  words: WordPosition[],
  pageWords?: WordPosition[],
): LineRect[] {
  if (pageWords && pageWords.length > 0) {
    return mergeSentenceHighlightRects(words, pageWords)
  }
  return mergePageWordsIntoClickLines(words)
}
