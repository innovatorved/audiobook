import type { PDFPageProxy } from 'pdfjs-dist'
import { PDF_RENDER_SCALE } from '@/lib/pdf/constants'

export const PDF_DISPLAY_DPR_CAP = 2.5

export function getPdfDisplayDpr(): number {
  return Math.min(window.devicePixelRatio || 1, PDF_DISPLAY_DPR_CAP)
}

export function getPdfLogicalViewport(page: PDFPageProxy) {
  return page.getViewport({ scale: PDF_RENDER_SCALE })
}

export async function renderPdfPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
): Promise<{ width: number; height: number }> {
  const viewport = getPdfLogicalViewport(page)
  const dpr = getPdfDisplayDpr()
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { width: viewport.width, height: viewport.height }
  }

  canvas.width = Math.floor(viewport.width * dpr)
  canvas.height = Math.floor(viewport.height * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewport.width, viewport.height)

  await page.render({ canvasContext: ctx, viewport, canvas }).promise

  return { width: viewport.width, height: viewport.height }
}
