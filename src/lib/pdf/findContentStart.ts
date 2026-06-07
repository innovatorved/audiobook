import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { SentenceInfo, WordPosition } from '@/lib/types'
import {
  PAGE_FOOTER_BAND_RATIO,
  PAGE_HEADER_BAND_RATIO,
} from '@/lib/pdf/constants'

const COPYRIGHT_PATTERNS = [
  /copyright/i,
  /©/,
  /all rights reserved/i,
  /\bisbn\b/i,
  /published by/i,
  /edition was/i,
  /first published/i,
  /printed in/i,
  /library of congress/i,
  /no part of this/i,
  /penguin books/i,
  /harpercollins/i,
  /simon\s*&\s*schuster/i,
]

export function findFirstTextPageFromWords(
  words: Pick<WordPosition, 'pageNum'>[],
): number {
  if (words.length === 0) return 1
  return words[0].pageNum
}

export async function findFirstTextPage(doc: PDFDocumentProxy): Promise<number> {
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const textContent = await page.getTextContent()
    const hasText = textContent.items.some(
      (item) => 'str' in item && item.str.trim().length > 0,
    )
    if (hasText) return i
  }
  return 1
}

export function findFirstSentenceOnPage(
  sentences: SentenceInfo[],
  pageNum: number,
): number {
  const idx = sentences.findIndex((s) => s.pageNum === pageNum && s.text.trim().length > 0)
  return idx >= 0 ? idx : 0
}

export function findFirstSentenceIndex(sentences: SentenceInfo[]): number {
  const idx = sentences.findIndex((s) => s.text.trim().length > 0)
  return idx >= 0 ? idx : 0
}

function matchesCopyrightPattern(text: string): boolean {
  return COPYRIGHT_PATTERNS.some((pattern) => pattern.test(text))
}

function getPageVerticalSpan(
  words: WordPosition[],
  pageNum: number,
): { minTop: number; span: number } {
  const pageWords = words.filter((w) => w.pageNum === pageNum)
  if (pageWords.length === 0) return { minTop: 0, span: 1 }

  const minTop = Math.min(...pageWords.map((w) => w.top))
  const maxBottom = Math.max(...pageWords.map((w) => w.top + w.height))
  return { minTop, span: Math.max(maxBottom - minTop, 1) }
}

function isHeaderOrFooterSentence(
  sentence: SentenceInfo,
  words: WordPosition[],
): boolean {
  const sentenceWords = words.filter(
    (w) =>
      w.globalIndex >= sentence.startWordIndex && w.globalIndex <= sentence.endWordIndex,
  )
  if (sentenceWords.length === 0) return false

  const { minTop, span } = getPageVerticalSpan(words, sentence.pageNum)
  let inBand = 0

  for (const word of sentenceWords) {
    const ratio = (word.top - minTop) / span
    if (ratio < PAGE_HEADER_BAND_RATIO || ratio > PAGE_FOOTER_BAND_RATIO) {
      inBand++
    }
  }

  return inBand / sentenceWords.length > 0.5
}

function isSubstantialBodySentence(text: string): boolean {
  const wordCount = text.split(/\s+/).filter(Boolean).length
  const letterCount = (text.match(/[a-zA-Z]/g) ?? []).length
  return wordCount >= 6 && letterCount >= 20
}

function shouldSkipSentence(
  sentence: SentenceInfo,
  words: WordPosition[],
): boolean {
  const text = sentence.text.trim()
  if (!text) return true
  if (matchesCopyrightPattern(text)) return true
  if (isHeaderOrFooterSentence(sentence, words)) return true
  return false
}

/** Skip cover/copyright lines; pick the first substantial body sentence. */
export function findContentStartSentence(
  sentences: SentenceInfo[],
  words: WordPosition[] = [],
): number {
  const pageNums = [...new Set(sentences.map((s) => s.pageNum))].sort((a, b) => a - b)

  for (const pageNum of pageNums) {
    const pageSentenceIndices = sentences
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.pageNum === pageNum)
      .filter(({ s }) => !shouldSkipSentence(s, words))

    if (pageSentenceIndices.length < 3) continue

    const substantial = pageSentenceIndices.find(({ s }) => isSubstantialBodySentence(s.text))
    if (substantial) return substantial.i
  }

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]
    if (shouldSkipSentence(sentence, words)) continue
    if (isSubstantialBodySentence(sentence.text.trim())) return i
  }

  for (let i = 0; i < sentences.length; i++) {
    if (!shouldSkipSentence(sentences[i], words)) return i
  }

  return findFirstSentenceIndex(sentences)
}
