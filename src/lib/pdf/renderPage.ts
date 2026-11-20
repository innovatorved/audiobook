import type { PDFPageProxy } from 'pdfjs-dist'
import { PDF_RENDER_SCALE } from '@/lib/pdf/constants'

export const PDF_DISPLAY_DPR_CAP = 2.5
export const PDF_MOBILE_DPR_CAP = 1.5

export function getPdfDisplayDpr(): number {
  const isMobileViewport = typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 768
  const cap = isMobileViewport ? PDF_MOBILE_DPR_CAP : PDF_DISPLAY_DPR_CAP
  return Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, cap)
}

export function getPdfLogicalViewport(page: PDFPageProxy) {
  return page.getViewport({ scale: PDF_RENDER_SCALE })
}

export async function renderPdfPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<{ width: number; height: number; cancelled?: boolean }> {
  const viewport = getPdfLogicalViewport(page)
  if (signal?.aborted) {
    return { width: viewport.width, height: viewport.height, cancelled: true }
  }

  const dpr = getPdfDisplayDpr()
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { width: viewport.width, height: viewport.height }
  }

  canvas.width = Math.floor(viewport.width * dpr)
  canvas.height = Math.floor(viewport.height * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewport.width, viewport.height)

  const renderTask = page.render({ canvasContext: ctx, viewport, canvas })
  const onAbort = () => {
    try {
      renderTask.cancel()
    } catch {
      // already finished or cancelled
    }
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    await renderTask.promise
    return { width: viewport.width, height: viewport.height }
  } catch (err) {
    if (
      signal?.aborted ||
      (err instanceof Error && err.name === 'RenderingCancelledException')
    ) {
      return { width: viewport.width, height: viewport.height, cancelled: true }
    }
    throw err
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
