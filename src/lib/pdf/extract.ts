import { Util } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { WordPosition } from '@/lib/types'
import { PDF_RENDER_SCALE } from '@/lib/pdf/constants'
import { clampWordWidths } from '@/lib/pdf/clampWordWidths'
import { sortWordsByReadingOrder } from '@/lib/pdf/sortWords'

/**
 * Compute viewport/canvas text-item bounds from PDF.js TextItem.
 * item.width and item.height are in PDF user points (1/72 inch) and must be
 * scaled by viewport.scale to match the rendered canvas coordinate space.
 */
export function getTextItemBounds(
  item: { str: string; transform: number[]; width: number; height: number },
  viewport: ReturnType<PDFPageProxy['getViewport']>,
): { left: number; top: number; width: number; height: number } {
  const tx = Util.transform(viewport.transform, item.transform)
  const scale = viewport.scale
  const width = item.width * scale
  const rawHeight = item.height > 0 ? item.height * scale : Math.hypot(tx[2], tx[3])
  const fontHeight = rawHeight > 0 ? rawHeight : 16 * scale
  // Anchor to visual text glyphs from baseline tx[5]:
  // Ascent is ~0.75 of font size above baseline, descent is ~0.15 of font size below.
  const ascent = fontHeight * 0.75
  const height = fontHeight * 0.90
  const top = tx[5] - ascent

  return {
    left: tx[4],
    top,
    width,
    height,
  }
}

/** Split multi-word PDF items proportionally within the item's native width. */
export function splitItemIntoWords(
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

  return clampWordWidths(sortWordsByReadingOrder(words))
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

  return allWords
}
