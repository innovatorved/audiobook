import type { SentenceInfo, WordPosition } from '@/lib/types'

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
  const clickedWord = words.find((w) => w.globalIndex === wordIndex)
  if (!sentence || !clickedWord || clickedWord.globalIndex <= sentence.startWordIndex) {
    return { text: baseText }
  }

  const sliceWords = words.filter(
    (w) =>
      w.globalIndex >= clickedWord.globalIndex &&
      w.globalIndex <= sentence.endWordIndex,
  )
  const sliceText = sliceWords.map((w) => w.text).join(' ').trim()
  if (!sliceText) {
    return { text: baseText }
  }

  return { text: sliceText, fromWordIndex: clickedWord.globalIndex }
}
