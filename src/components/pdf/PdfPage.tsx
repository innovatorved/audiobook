import { useEffect, useMemo, useRef, useState } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import { Skeleton } from '@/components/ui/skeleton'
import { WordHighlight } from '@/components/pdf/WordHighlight'
import { PDF_RENDER_SCALE } from '@/lib/pdf/constants'
import { findWordAtPoint } from '@/lib/pdf/findWordAtPoint'
import { mergeWordsIntoLineRects } from '@/lib/pdf/lineRects'
import { getCachedPageSize, setCachedPageSize } from '@/lib/pdf/pageCanvasCache'
import type { WordPosition } from '@/lib/types'

interface PdfPageProps {
  page: PDFPageProxy | null
  pageNum: number
  activeWord: WordPosition | null
  activeSentenceWords: WordPosition[]
  pageWords: WordPosition[]
  isVisible: boolean
  onLineClick?: (sentenceIndex: number, wordIndex: number) => void
}

function isOnCanvas(
  w: { left: number; top: number; width: number; height: number },
  canvasW: number,
  canvasH: number,
): boolean {
  return (
    w.left < canvasW &&
    w.top < canvasH &&
    w.left + w.width > 0 &&
    w.top + w.height > 0
  )
}

export function PdfPage({
  page,
  pageNum,
  activeWord,
  activeSentenceWords,
  pageWords,
  isVisible,
  onLineClick,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderingRef = useRef(false)
  const [dimensions, setDimensions] = useState(() => {
    const cached = getCachedPageSize(pageNum)
    return cached ? { width: cached.width, height: cached.height } : { width: 0, height: 0 }
  })
  const [hasRendered, setHasRendered] = useState(() => getCachedPageSize(pageNum) !== undefined)

  const showActiveWord =
    activeWord && activeWord.pageNum === pageNum ? activeWord : null

  const sentenceLineRects = useMemo(() => {
    if (dimensions.width <= 0) return []
    const onPage = activeSentenceWords.filter((w) =>
      isOnCanvas(w, dimensions.width, dimensions.height),
    )
    return mergeWordsIntoLineRects(onPage)
  }, [activeSentenceWords, dimensions.width, dimensions.height])

  useEffect(() => {
    if (!page || !isVisible || renderingRef.current) return

    const cached = getCachedPageSize(pageNum)
    const canvas = canvasRef.current

    if (cached && canvas) {
      setDimensions({ width: cached.width, height: cached.height })
      setHasRendered(true)
      if (canvas.width !== cached.width) {
        renderingRef.current = true
        void (async () => {
          const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
          canvas.width = viewport.width
          canvas.height = viewport.height
          const ctx = canvas.getContext('2d')
          if (ctx) await page.render({ canvasContext: ctx, viewport, canvas }).promise
          renderingRef.current = false
        })()
      }
      return
    }

    let cancelled = false
    renderingRef.current = true

    const render = async () => {
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
      const canvasEl = canvasRef.current
      if (!canvasEl || cancelled) {
        renderingRef.current = false
        return
      }

      canvasEl.width = viewport.width
      canvasEl.height = viewport.height
      setDimensions({ width: viewport.width, height: viewport.height })

      const ctx = canvasEl.getContext('2d')
      if (!ctx) {
        renderingRef.current = false
        return
      }

      await page.render({ canvasContext: ctx, viewport, canvas: canvasEl }).promise
      if (!cancelled) {
        setCachedPageSize(pageNum, viewport.width, viewport.height)
        setHasRendered(true)
        renderingRef.current = false
      }
    }

    void render()
    return () => {
      cancelled = true
      renderingRef.current = false
    }
  }, [page, isVisible, pageNum])

  const pageStyle =
    dimensions.width > 0
      ? { width: dimensions.width, height: dimensions.height }
      : { width: '100%', minHeight: 400 }

  const showSkeleton = !hasRendered
  const showActiveOnCanvas =
    showActiveWord && dimensions.width > 0 && isOnCanvas(showActiveWord, dimensions.width, dimensions.height)
      ? showActiveWord
      : null

  const handlePageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onLineClick || dimensions.width <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const word = findWordAtPoint(pageWords, x, y)
    if (!word) return
    onLineClick(word.sentenceIndex, word.globalIndex)
  }

  return (
    <div className="relative mx-auto mb-8" data-page={pageNum}>
      <div
        className={`relative mx-auto overflow-hidden rounded-sm bg-white transition-smooth ${onLineClick ? 'cursor-pointer hover:shadow-lg' : ''}`}
        style={{
          ...pageStyle,
          boxShadow: 'var(--shadow-page)',
        }}
        onClick={onLineClick ? handlePageClick : undefined}
      >
        {showSkeleton && (
          <Skeleton className="absolute inset-0 rounded-md" />
        )}
        <canvas
          ref={canvasRef}
          className="block"
          style={{
            ...(dimensions.width > 0 ? pageStyle : undefined),
            visibility: hasRendered ? 'visible' : 'hidden',
          }}
        />
        {hasRendered && dimensions.width > 0 && (
          <div className="pointer-events-none absolute inset-0">
            {sentenceLineRects.map((rect, i) => (
              <WordHighlight
                key={`${rect.sentenceIndex}-${rect.startWordIndex}-${i}`}
                rect={rect}
                variant="sentence"
              />
            ))}
            {showActiveOnCanvas && (
              <WordHighlight word={showActiveOnCanvas} variant="active" />
            )}
          </div>
        )}
      </div>
      <p className="mt-2.5 text-center text-xs text-muted-foreground">Page {pageNum}</p>
    </div>
  )
}
