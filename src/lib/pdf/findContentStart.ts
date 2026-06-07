import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { SentenceInfo, WordPosition } from '@/lib/types'

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

/** Skip cover/copyright lines; pick the first substantial body sentence. */
export function findContentStartSentence(sentences: SentenceInfo[]): number {
  for (let i = 0; i < sentences.length; i++) {
    const text = sentences[i].text.trim()
    const wordCount = text.split(/\s+/).filter(Boolean).length
    const letterCount = (text.match(/[a-zA-Z]/g) ?? []).length
    if (wordCount >= 6 && letterCount >= 20) return i
  }
  return findFirstSentenceIndex(sentences)
}
