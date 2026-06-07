import { extractSentences } from '@/lib/pipeline/text'
import type { SentenceInfo, WordPosition } from '@/lib/types'

export function buildWordMap(
  rawWords: Omit<WordPosition, 'globalIndex' | 'sentenceIndex'>[],
): { words: WordPosition[]; sentences: SentenceInfo[]; fullText: string } {
  const fullText = rawWords.map((w) => w.text).join(' ')
  const sentenceTexts = extractSentences(fullText)

  const words: WordPosition[] = []
  const sentences: SentenceInfo[] = []
  let wordCursor = 0
  let globalIndex = 0

  for (let sentenceIndex = 0; sentenceIndex < sentenceTexts.length; sentenceIndex++) {
    const sentenceText = sentenceTexts[sentenceIndex]
    const sentenceWords = sentenceText.split(/\s+/).filter(Boolean)
    const startWordIndex = globalIndex

    for (const sw of sentenceWords) {
      while (wordCursor < rawWords.length) {
        const raw = rawWords[wordCursor]
        wordCursor++
        if (raw.text.replace(/[^\w]/g, '').toLowerCase() === sw.replace(/[^\w]/g, '').toLowerCase()) {
          words.push({
            ...raw,
            globalIndex,
            sentenceIndex,
          })
          globalIndex++
          break
        }
      }
    }

    if (sentenceWords.length > 0) {
      sentences.push({
        text: sentenceText,
        startWordIndex,
        endWordIndex: globalIndex - 1,
        pageNum: words[startWordIndex]?.pageNum ?? 1,
      })
    }
  }

  // Fallback: map remaining raw words if sentence alignment missed some
  while (wordCursor < rawWords.length) {
    const raw = rawWords[wordCursor]
    words.push({
      ...raw,
      globalIndex,
      sentenceIndex: sentences.length > 0 ? sentences.length - 1 : 0,
    })
    globalIndex++
    wordCursor++
  }

  if (sentences.length === 0 && words.length > 0) {
    sentences.push({
      text: fullText,
      startWordIndex: 0,
      endWordIndex: words.length - 1,
      pageNum: words[0].pageNum,
    })
  }

  return { words, sentences, fullText }
}
