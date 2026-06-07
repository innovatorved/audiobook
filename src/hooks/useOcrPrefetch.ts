import { useCallback, useEffect, useRef } from 'react'
import OcrWorker from '@/workers/ocr.worker?worker'
import { mapOcrWordsToPositions } from '@/lib/ocr/extract'
import { clampWordWidths } from '@/lib/pdf/clampWordWidths'
import { useReaderStore } from '@/stores/readerStore'
import { buildWordMap } from '@/lib/pipeline/wordMap'
import { PDF_RENDER_SCALE } from '@/lib/pdf/constants'
import { toast } from 'sonner'

const PREFETCH_WINDOW = 3

export function useOcrPrefetch() {
  const workerRef = useRef<Worker | null>(null)
  const pendingPages = useRef<Set<number>>(new Set())
  const {
    pdfDoc,
    isScanned,
    totalPages,
    addOcrPage,
    setWords,
    setExtracting,
    ocrPagesReady,
  } = useReaderStore()

  useEffect(() => {
    if (!isScanned) return

    const worker = new OcrWorker()
    workerRef.current = worker

    const pageWordsMap = new Map<number, ReturnType<typeof mapOcrWordsToPositions>>()

    worker.onmessage = (event) => {
      const data = event.data
      if (data.type === 'result') {
        pendingPages.current.delete(data.pageNum)
        const positions = clampWordWidths(mapOcrWordsToPositions(data.words, data.pageNum))
        pageWordsMap.set(data.pageNum, positions)
        addOcrPage(data.pageNum)

        const allPages = Array.from(pageWordsMap.keys()).sort((a, b) => a - b)
        const allRaw = allPages.flatMap((p) => pageWordsMap.get(p) ?? [])
        const { words, sentences, fullText: _ft } = buildWordMap(allRaw)
        const sentenceTexts = sentences.map((s) => s.text)
        setWords(words, sentences, sentenceTexts)
        setExtracting(pendingPages.current.size > 0, (allPages.length / totalPages) * 100)
      } else if (data.type === 'error') {
        pendingPages.current.delete(data.pageNum)
        toast.error(`OCR failed on page ${data.pageNum}`)
      }
    }

    if (totalPages > 50) {
      toast.warning('Large scanned PDF — OCR may be slower')
    }

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [isScanned, totalPages, addOcrPage, setWords, setExtracting])

  const renderPageToImageData = useCallback(
    async (pageNum: number): Promise<ImageData | null> => {
      if (!pdfDoc) return null
      const page = await pdfDoc.getPage(pageNum)
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      return ctx.getImageData(0, 0, canvas.width, canvas.height)
    },
    [pdfDoc],
  )

  const ocrPage = useCallback(
    async (pageNum: number) => {
      if (!workerRef.current || pendingPages.current.has(pageNum) || ocrPagesReady.has(pageNum)) {
        return
      }
      pendingPages.current.add(pageNum)
      setExtracting(true)
      const imageData = await renderPageToImageData(pageNum)
      if (!imageData) {
        pendingPages.current.delete(pageNum)
        return
      }
      workerRef.current.postMessage(
        { type: 'recognize', imageData, pageNum },
        [imageData.data.buffer],
      )
    },
    [renderPageToImageData, ocrPagesReady, setExtracting],
  )

  const prefetchAround = useCallback(
    (currentPage: number) => {
      if (!isScanned || !pdfDoc) return
      for (let i = 0; i < PREFETCH_WINDOW; i++) {
        const page = currentPage + i
        if (page <= totalPages) {
          void ocrPage(page)
        }
      }
    },
    [isScanned, pdfDoc, totalPages, ocrPage],
  )

  return { ocrPage, prefetchAround }
}
