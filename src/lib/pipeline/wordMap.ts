import { extractSentences } from '@/lib/pipeline/text'
import type { SentenceInfo, WordPosition } from '@/lib/types'

type RawWord = Omit<WordPosition, 'globalIndex' | 'sentenceIndex'>

function mapPageWords(
  rawWords: RawWord[],
  startGlobalIndex: number,
  startSentenceIndex: number,
): { words: WordPosition[]; sentences: SentenceInfo[]; nextGlobalIndex: number; pageText: string } {
  if (rawWords.length === 0) {
    return { words: [], sentences: [], nextGlobalIndex: startGlobalIndex, pageText: '' }
  }

  const wordCharStarts = new Array<number>(rawWords.length)
  let charOffset = 0
  const parts = new Array<string>(rawWords.length)
  for (let i = 0; i < rawWords.length; i++) {
    wordCharStarts[i] = charOffset
    const text = rawWords[i].text
    parts[i] = text
    charOffset += text.length + 1
  }

  const fullText = parts.join(' ')
  const sentenceTexts = extractSentences(fullText)

  const words: WordPosition[] = []
  const sentences: SentenceInfo[] = []
  let wordCursor = 0
  let globalIndex = startGlobalIndex
  let searchCharOffset = 0
  const pageNum = rawWords[0]?.pageNum ?? 1

  for (let i = 0; i < sentenceTexts.length; i++) {
    const sentenceText = sentenceTexts[i]
    if (!sentenceText) continue

    const foundAt = fullText.indexOf(sentenceText, searchCharOffset)
    const sentEndChar =
      foundAt >= 0 ? foundAt + sentenceText.length : searchCharOffset + sentenceText.length
    searchCharOffset = sentEndChar

    const startWordIndex = globalIndex
    const sentenceIndex = startSentenceIndex + sentences.length
    const matchedWords: WordPosition[] = []

    while (wordCursor < rawWords.length && wordCharStarts[wordCursor] < sentEndChar) {
      const raw = rawWords[wordCursor]
      const word: WordPosition = {
        ...raw,
        globalIndex,
        sentenceIndex,
      }
      words.push(word)
      matchedWords.push(word)
      globalIndex++
      wordCursor++
    }

    if (matchedWords.length > 0) {
      sentences.push({
        text: matchedWords.map((w) => w.text).join(' '),
        startWordIndex,
        endWordIndex: globalIndex - 1,
        pageNum,
      })
    }
  }

  if (wordCursor < rawWords.length) {
    const fallbackStartWordIndex = globalIndex
    const sentenceIndex =
      sentences.length > 0
        ? startSentenceIndex + sentences.length - 1
        : startSentenceIndex
    const trailingWords: WordPosition[] = []

    while (wordCursor < rawWords.length) {
      const raw = rawWords[wordCursor]
      const word: WordPosition = {
        ...raw,
        globalIndex,
        sentenceIndex,
      }
      words.push(word)
      trailingWords.push(word)
      globalIndex++
      wordCursor++
    }

    if (sentences.length > 0) {
      const lastSent = sentences[sentences.length - 1]
      lastSent.endWordIndex = globalIndex - 1
      lastSent.text = `${lastSent.text} ${trailingWords.map((w) => w.text).join(' ')}`.trim()
    } else {
      sentences.push({
        text: fullText,
        startWordIndex: fallbackStartWordIndex,
        endWordIndex: globalIndex - 1,
        pageNum,
      })
    }
  }

  return { words, sentences, nextGlobalIndex: globalIndex, pageText: fullText }
}

export function buildWordMap(
  rawWords: RawWord[],
): { words: WordPosition[]; sentences: SentenceInfo[]; fullText: string } {
  if (rawWords.length === 0) {
    return { words: [], sentences: [], fullText: '' }
  }

  const byPage = new Map<number, RawWord[]>()
  for (const w of rawWords) {
    let list = byPage.get(w.pageNum)
    if (!list) {
      list = []
      byPage.set(w.pageNum, list)
    }
    list.push(w)
  }

  const pageNums = [...byPage.keys()].sort((a, b) => a - b)
  const words: WordPosition[] = []
  const sentences: SentenceInfo[] = []
  const fullTextParts: string[] = []
  let globalIndex = 0
  let sentenceIndex = 0

  for (const pageNum of pageNums) {
    const pageRaw = byPage.get(pageNum)
    if (!pageRaw || pageRaw.length === 0) continue
    const pageResult = mapPageWords(pageRaw, globalIndex, sentenceIndex)
    for (const w of pageResult.words) words.push(w)
    for (const s of pageResult.sentences) sentences.push(s)
    globalIndex = pageResult.nextGlobalIndex
    sentenceIndex += pageResult.sentences.length
    if (pageResult.pageText) {
      fullTextParts.push(pageResult.pageText)
    }
  }

  return { words, sentences, fullText: fullTextParts.join(' ') }
}
