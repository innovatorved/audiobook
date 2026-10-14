import type { SentenceInfo, WordPosition } from '@/lib/types'

export function getWordByGlobalIndex(
  words: WordPosition[],
  wordIndex: number,
): WordPosition | undefined {
  if (wordIndex < 0 || words.length === 0) return undefined
  const direct = words[wordIndex]
  if (direct && direct.globalIndex === wordIndex) return direct
  return words.find((w) => w.globalIndex === wordIndex)
}

export function sliceWordsByGlobalRange(
  words: WordPosition[],
  startWordIndex: number,
  endWordIndex: number,
): WordPosition[] {
  if (endWordIndex < startWordIndex || words.length === 0) return []
  const first = words[startWordIndex]
  const last = words[endWordIndex]
  if (
    first &&
    first.globalIndex === startWordIndex &&
    last &&
    last.globalIndex === endWordIndex
  ) {
    return words.slice(startWordIndex, endWordIndex + 1)
  }
  return words.filter(
    (w) => w.globalIndex >= startWordIndex && w.globalIndex <= endWordIndex,
  )
}

/** Exact TTS text for a seek — must match beginStream slice logic. */
export function streamTextForSeek(
  sentences: SentenceInfo[],
  words: WordPosition[],
  sentenceTexts: string[],
  sentenceIndex: number,
  wordIndex?: number,
): { text: string; fromWordIndex?: number } {
  const baseText = sentenceTexts[sentenceIndex]?.trim() ?? ''
  if (!baseText || wordIndex === undefined) {
    return { text: baseText }
  }

  const sentence = sentences[sentenceIndex]
  const clickedWord = getWordByGlobalIndex(words, wordIndex)
  if (!sentence || !clickedWord || clickedWord.globalIndex <= sentence.startWordIndex) {
    return { text: baseText }
  }

  const sliceWords = sliceWordsByGlobalRange(
    words,
    clickedWord.globalIndex,
    sentence.endWordIndex,
  )
  const sliceText = sliceWords.map((w) => w.text).join(' ').trim()
  if (!sliceText) {
    return { text: baseText }
  }

  return { text: sliceText, fromWordIndex: clickedWord.globalIndex }
}
