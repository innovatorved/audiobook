import { useEffect, useMemo, useRef, useState } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import { Skeleton } from '@/components/ui/skeleton'
import { WordHighlight } from '@/components/pdf/WordHighlight'
import { findClickTargetAtPoint } from '@/lib/pdf/findWordAtPoint'
import { getPdfDisplayDpr, renderPdfPageToCanvas } from '@/lib/pdf/renderPage'
import { mergeSentenceHighlightRects } from '@/lib/pdf/lineRects'
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
  onEmptyPageClick?: (pageNum: number, x: number, y: number) => void
  onReturnToPlayback?: () => void
  playbackPageNum?: number
  maxWidth: number
  estimatedNativeSize?: { width: number; height: number }
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
  onEmptyPageClick,
  onReturnToPlayback,
  playbackPageNum,
  maxWidth,
  estimatedNativeSize,
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
    return mergeSentenceHighlightRects(onPage, pageWords)
  }, [activeSentenceWords, pageWords, dimensions.width, dimensions.height])

  useEffect(() => {
    if (!page || !isVisible || renderingRef.current) return

    const cached = getCachedPageSize(pageNum)
    const canvas = canvasRef.current

    if (cached && canvas) {
      setDimensions({ width: cached.width, height: cached.height })
      setHasRendered(true)
      const expectedWidth = Math.floor(cached.width * getPdfDisplayDpr())
      if (canvas.width !== expectedWidth) {
        renderingRef.current = true
        void (async () => {
          await renderPdfPageToCanvas(page, canvas)
          renderingRef.current = false
        })()
      }
      return
    }

    let cancelled = false
    renderingRef.current = true

    const render = async () => {
      const canvasEl = canvasRef.current
      if (!canvasEl || cancelled) {
        renderingRef.current = false
        return
      }

      const { width, height } = await renderPdfPageToCanvas(page, canvasEl)
      if (!cancelled) {
        setDimensions({ width, height })
        setCachedPageSize(pageNum, width, height)
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

  const nativeWidth = dimensions.width > 0 ? dimensions.width : (estimatedNativeSize?.width ?? 0)
  const nativeHeight = dimensions.height > 0 ? dimensions.height : (estimatedNativeSize?.height ?? 0)
  const displayScale =
    nativeWidth > 0 && maxWidth > 0 ? Math.min(1, maxWidth / nativeWidth) : 1
  const displayWidth = nativeWidth > 0 ? nativeWidth * displayScale : 0
  const displayHeight = nativeHeight > 0 ? nativeHeight * displayScale : 0

  const pageStyle =
    nativeWidth > 0
      ? { width: displayWidth, height: displayHeight }
      : { width: '100%', minHeight: 400 }

  const showSkeleton = !hasRendered
  const showActiveOnCanvas =
    showActiveWord && nativeWidth > 0 && isOnCanvas(showActiveWord, nativeWidth, nativeHeight)
      ? showActiveWord
      : null

  const handlePageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onLineClick) return
    if (nativeWidth <= 0 || displayScale <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / displayScale
    const y = (event.clientY - rect.top) / displayScale

    if (pageWords.length === 0) {
      onEmptyPageClick?.(pageNum, x, y)
      return
    }
    const word = findClickTargetAtPoint(pageWords, x, y)
    if (!word) return
    onLineClick(word.sentenceIndex, word.globalIndex)
  }

  const showEmptyOverlay = hasRendered && pageWords.length === 0 && onReturnToPlayback

  return (
    <div className="relative mx-auto mb-12" data-page={pageNum}>
      <div
        className={`reader-page relative mx-auto overflow-hidden rounded-xl transition-smooth ${onLineClick ? 'cursor-pointer hover:brightness-[1.01]' : ''}`}
        style={pageStyle}
        onClick={onLineClick ? handlePageClick : undefined}
      >
        {showSkeleton && (
          <Skeleton className="absolute inset-0 rounded-md" />
        )}
        <canvas
          ref={canvasRef}
          className="reader-page-canvas block"
          style={{
            width: nativeWidth > 0 ? displayWidth : '100%',
            height: nativeHeight > 0 ? displayHeight : undefined,
            visibility: hasRendered ? 'visible' : 'hidden',
          }}
        />
        {showEmptyOverlay && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/75 px-6 text-center backdrop-blur-[2px]"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold text-foreground">No readable text here</p>
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              Page {pageNum} may be blank or an image. Return to page {playbackPageNum ?? '…'} where
              playback is active.
            </p>
            <button
              type="button"
              className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-smooth hover:opacity-90"
              onClick={onReturnToPlayback}
            >
              Return to playback
            </button>
          </div>
        )}
        {hasRendered && nativeWidth > 0 && (
          <div
            className="pointer-events-none absolute top-0 left-0"
            style={{
              width: nativeWidth,
              height: nativeHeight,
              transform: `scale(${displayScale})`,
              transformOrigin: 'top left',
            }}
          >
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
      <p className="mt-4 text-center text-[11px] font-medium tracking-wide text-muted-foreground/80">
        Page {pageNum}
      </p>
    </div>
  )
}
