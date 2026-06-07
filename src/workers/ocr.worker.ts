import { createWorker } from 'tesseract.js'

interface OcrRequest {
  type: 'recognize'
  imageData: ImageData
  pageNum: number
}

interface OcrResponse {
  type: 'result'
  pageNum: number
  words: Array<{
    text: string
    left: number
    top: number
    width: number
    height: number
  }>
}

interface OcrError {
  type: 'error'
  pageNum: number
  message: string
}

let worker: Awaited<ReturnType<typeof createWorker>> | null = null

async function ensureWorker() {
  if (!worker) {
    worker = await createWorker('eng')
  }
  return worker
}

self.onmessage = async (event: MessageEvent<OcrRequest>) => {
  const msg = event.data

  if (msg.type === 'recognize') {
    try {
      const tesseract = await ensureWorker()
      const canvas = new OffscreenCanvas(msg.imageData.width, msg.imageData.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not get canvas context')
      ctx.putImageData(msg.imageData, 0, 0)

      const result = await tesseract.recognize(canvas, 'eng')
      const words = (result.data.words ?? [])
        .filter((w) => w.text.trim().length > 0)
        .map((w) => ({
          text: w.text,
          left: w.bbox.x0,
          top: w.bbox.y0,
          width: w.bbox.x1 - w.bbox.x0,
          height: w.bbox.y1 - w.bbox.y0,
        }))

      const response: OcrResponse = {
        type: 'result',
        pageNum: msg.pageNum,
        words,
      }
      self.postMessage(response)
    } catch (err) {
      const error: OcrError = {
        type: 'error',
        pageNum: msg.pageNum,
        message: err instanceof Error ? err.message : 'OCR failed',
      }
      self.postMessage(error)
    }
  }
}
