import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

export async function pageHasTextLayer(page: PDFPageProxy): Promise<boolean> {
  const textContent = await page.getTextContent()
  return textContent.items.some(
    (item) => 'str' in item && item.str.trim().length > 0,
  )
}

export async function isScannedPdf(doc: PDFDocumentProxy): Promise<boolean> {
  const sample = Math.min(5, doc.numPages)
  for (let i = 1; i <= sample; i++) {
    const page = await doc.getPage(i)
    if (await pageHasTextLayer(page)) return false
  }
  return true
}
