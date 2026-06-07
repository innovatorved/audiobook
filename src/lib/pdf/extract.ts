import { Util } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { WordPosition } from '@/lib/types'
import { PDF_RENDER_SCALE } from '@/lib/pdf/constants'
import { clampWordWidths } from '@/lib/pdf/clampWordWidths'

/**
 * PDF.js canonical text-item bounds (see mozilla/pdf.js#12031, #8655).
 * item.width / item.height are already in device space — do NOT rescale.
 */
function getTextItemBounds(
  item: { str: string; transform: number[]; width: number; height: number },
  viewport: ReturnType<PDFPageProxy['getViewport']>,
): { left: number; top: number; width: number; height: number } {
  const tx = Util.transform(viewport.transform, item.transform)

  return {
    left: tx[4],
    top: tx[5] - item.height,
    width: item.width,
    height: item.height,
  }
}

/** Split multi-word PDF items proportionally within the item's native width. */
function splitItemIntoWords(
  str: string,
  itemLeft: number,
  itemTop: number,
  itemWidth: number,
  itemHeight: number,
): Array<{ text: string; left: number; top: number; width: number; height: number }> {
  const trimmed = str.trim()
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return []

  if (parts.length === 1) {
    return [{ text: parts[0], left: itemLeft, top: itemTop, width: itemWidth, height: itemHeight }]
  }

  const totalChars = parts.reduce((sum, p) => sum + p.length, 0)
  const gaps = parts.length - 1
  const unit = itemWidth / Math.max(totalChars + gaps * 0.25, 1)

  let x = itemLeft
  return parts.map((text) => {
    const width = unit * text.length
    const word = { text, left: x, top: itemTop, width, height: itemHeight }
    x += width + unit * 0.25
    return word
  })
}

export async function extractWordsFromPage(
  page: PDFPageProxy,
  pageNum: number,
  scale = PDF_RENDER_SCALE,
): Promise<Omit<WordPosition, 'globalIndex' | 'sentenceIndex'>[]> {
  const viewport = page.getViewport({ scale })
  const textContent = await page.getTextContent()
  const words: Omit<WordPosition, 'globalIndex' | 'sentenceIndex'>[] = []

  for (const item of textContent.items) {
    if (!('str' in item) || !item.str.trim()) continue

    const typedItem = item as { str: string; transform: number[]; width: number; height: number }
    const bounds = getTextItemBounds(typedItem, viewport)

    const split = splitItemIntoWords(
      typedItem.str,
      bounds.left,
      bounds.top,
      bounds.width,
      bounds.height,
    )
    for (const w of split) {
      words.push({
        text: w.text,
        pageNum,
        left: w.left,
        top: w.top,
        width: w.width,
        height: w.height,
      })
    }
  }

  return words
}

export async function extractAllDigitalWords(
  doc: PDFDocumentProxy,
  scale = PDF_RENDER_SCALE,
): Promise<Omit<WordPosition, 'globalIndex' | 'sentenceIndex'>[]> {
  const allWords: Omit<WordPosition, 'globalIndex' | 'sentenceIndex'>[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const pageWords = await extractWordsFromPage(page, i, scale)
    allWords.push(...pageWords)
  }

  return clampWordWidths(allWords)
}
