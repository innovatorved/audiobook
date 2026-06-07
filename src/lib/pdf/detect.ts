import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

export async function pageHasTextLayer(page: PDFPageProxy): Promise<boolean> {
  const textContent = await page.getTextContent()
  return textContent.items.some(
    (item) => 'str' in item && item.str.trim().length > 0,
  )
}

/** Sample pages spread across the document — not just the first few (cover pages are often blank). */
function samplePageNumbers(totalPages: number, maxSamples = 8): number[] {
  if (totalPages <= 0) return []
  if (totalPages <= maxSamples) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const picks = new Set<number>([1, 2, totalPages, totalPages - 1])
  const innerSlots = maxSamples - picks.size
  for (let i = 0; i < innerSlots; i++) {
    const page = 1 + Math.round(((i + 1) / (innerSlots + 1)) * (totalPages - 1))
    picks.add(page)
  }
  return [...picks].sort((a, b) => a - b)
}

export async function isScannedPdf(doc: PDFDocumentProxy): Promise<boolean> {
  const pages = samplePageNumbers(doc.numPages)
  for (const pageNum of pages) {
    const page = await doc.getPage(pageNum)
    if (await pageHasTextLayer(page)) return false
  }
  return true
}
