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
    const rects = mergeWordsIntoLineRects(onPage)
    // #region agent log
    if (rects.length > 0 && showActiveWord) {
      fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'highlight-bounds-v1',location:'PdfPage.tsx:sentenceLineRects',message:'sentence line rects computed',data:{pageNum,rectCount:rects.length,canvasW:dimensions.width,rects:rects.map(r=>({l:r.left,t:r.top,w:r.width,h:r.height,start:r.startWordIndex})),wordCount:onPage.length},timestamp:Date.now(),hypothesisId:'line-width'})}).catch(()=>{});
    }
    // #endregion
    return rects
  }, [activeSentenceWords, dimensions.width, dimensions.height, pageNum, showActiveWord])

  const sentenceLineRectsRef = useRef(sentenceLineRects)
  const showActiveWordRef = useRef(showActiveWord)
  sentenceLineRectsRef.current = sentenceLineRects
  showActiveWordRef.current = showActiveWord

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
    // #region agent log
    fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'post-fix-v2',location:'PdfPage.tsx:renderStart',message:'page render started',data:{pageNum,cached:!!cached},timestamp:Date.now(),hypothesisId:'F-H'})}).catch(()=>{});
    // #endregion

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
        // #region agent log
        const aw = showActiveWordRef.current
        fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'post-fix-v2',location:'PdfPage.tsx:renderDone',message:'page render done',data:{pageNum,canvasW:viewport.width,canvasH:viewport.height,activeWord:aw&&isOnCanvas(aw,viewport.width,viewport.height)?{t:aw.text,l:aw.left,top:aw.top,w:aw.width}:null,sentenceRects:sentenceLineRectsRef.current.slice(0,2)},timestamp:Date.now(),hypothesisId:'C-E'})}).catch(()=>{});
        // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7591/ingest/acdd59a1-09b9-4861-90da-6cce280b37ad',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e6bc8'},body:JSON.stringify({sessionId:'8e6bc8',runId:'playback-v5',location:'PdfPage.tsx:handlePageClick',message:'page text clicked',data:{pageNum,word:word.text,sentenceIndex:word.sentenceIndex,x,y},timestamp:Date.now(),hypothesisId:'click-read'})}).catch(()=>{});
    // #endregion
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
