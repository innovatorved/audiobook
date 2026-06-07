import { extractSentences } from '@/lib/pipeline/text'
import type { SentenceInfo, WordPosition } from '@/lib/types'

type RawWord = Omit<WordPosition, 'globalIndex' | 'sentenceIndex'>

function normalizeToken(text: string): string {
  return text.replace(/[^\w]/g, '').toLowerCase()
}

function mapPageWords(
  rawWords: RawWord[],
  startGlobalIndex: number,
  startSentenceIndex: number,
): { words: WordPosition[]; sentences: SentenceInfo[]; nextGlobalIndex: number } {
  const fullText = rawWords.map((w) => w.text).join(' ')
  const sentenceTexts = extractSentences(fullText)

  const words: WordPosition[] = []
  const sentences: SentenceInfo[] = []
  let wordCursor = 0
  let globalIndex = startGlobalIndex

  for (let i = 0; i < sentenceTexts.length; i++) {
    const sentenceText = sentenceTexts[i]
    const sentenceWords = sentenceText.split(/\s+/).filter(Boolean)
    const startWordIndex = globalIndex
    const sentenceIndex = startSentenceIndex + sentences.length

    for (const sw of sentenceWords) {
      const target = normalizeToken(sw)
      if (!target) continue

      let matched = false
      while (wordCursor < rawWords.length) {
        const raw = rawWords[wordCursor]
        wordCursor++
        if (normalizeToken(raw.text) === target) {
          words.push({
            ...raw,
            globalIndex,
            sentenceIndex,
          })
          globalIndex++
          matched = true
          break
        }
      }
      if (!matched) break
    }

    if (globalIndex > startWordIndex) {
      sentences.push({
        text: sentenceText,
        startWordIndex,
        endWordIndex: globalIndex - 1,
        pageNum: rawWords[0]?.pageNum ?? 1,
      })
    }
  }

  while (wordCursor < rawWords.length) {
    const raw = rawWords[wordCursor]
    const sentenceIndex =
      sentences.length > 0
        ? startSentenceIndex + sentences.length - 1
        : startSentenceIndex
    words.push({
      ...raw,
      globalIndex,
      sentenceIndex,
    })
    globalIndex++
    wordCursor++
  }

  if (sentences.length === 0 && words.length > 0) {
    sentences.push({
      text: fullText,
      startWordIndex: startGlobalIndex,
      endWordIndex: globalIndex - 1,
      pageNum: rawWords[0]?.pageNum ?? 1,
    })
  }

  return { words, sentences, nextGlobalIndex: globalIndex }
}

export function buildWordMap(
  rawWords: RawWord[],
): { words: WordPosition[]; sentences: SentenceInfo[]; fullText: string } {
  if (rawWords.length === 0) {
    return { words: [], sentences: [], fullText: '' }
  }

  const pageNums = [...new Set(rawWords.map((w) => w.pageNum))].sort((a, b) => a - b)
  const words: WordPosition[] = []
  const sentences: SentenceInfo[] = []
  const fullTextParts: string[] = []
  let globalIndex = 0
  let sentenceIndex = 0

  for (const pageNum of pageNums) {
    const pageRaw = rawWords.filter((w) => w.pageNum === pageNum)
    const pageResult = mapPageWords(pageRaw, globalIndex, sentenceIndex)
    words.push(...pageResult.words)
    for (const sentence of pageResult.sentences) {
      sentences.push({
        ...sentence,
        startWordIndex: sentence.startWordIndex,
        endWordIndex: sentence.endWordIndex,
      })
    }
    globalIndex = pageResult.nextGlobalIndex
    sentenceIndex += pageResult.sentences.length
    if (pageRaw.length > 0) {
      fullTextParts.push(pageRaw.map((w) => w.text).join(' '))
    }
  }

  return { words, sentences, fullText: fullTextParts.join(' ') }
}
