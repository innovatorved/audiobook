import { useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from '@/components/pdf/PdfPage'
import { PDF_RENDER_SCALE } from '@/lib/pdf/constants'
import type { WordPosition } from '@/lib/types'

interface PdfScrollerProps {
  pdfDoc: PDFDocumentProxy
  totalPages: number
  activeWord: WordPosition | null
  activeSentenceWords: WordPosition[]
  activePageNum: number
  followHighlight?: boolean
  initialPage?: number
  resetFollowKey?: number
  onVisiblePageChange?: (pageNum: number) => void
  onLineClick?: (sentenceIndex: number, wordIndex: number) => void
  words: WordPosition[]
}

const PAGE_CHROME = 56
const FALLBACK_PAGE_HEIGHT = 900

export function PdfScroller({
  pdfDoc,
  totalPages,
  activeWord,
  activeSentenceWords,
  activePageNum,
  followHighlight = false,
  initialPage,
  resetFollowKey = 0,
  onVisiblePageChange,
  onLineClick,
  words,
}: PdfScrollerProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const pageCache = useRef<Map<number, Awaited<ReturnType<PDFDocumentProxy['getPage']>>>>(new Map())
  const pageHeightsRef = useRef<Map<number, number>>(new Map())
  const userScrolledRef = useRef(false)
  const lastFollowedPageRef = useRef(-1)
  const initialScrollDoneRef = useRef(false)

  const [heightEstimatesReady, setHeightEstimatesReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    pageHeightsRef.current.clear()
    setHeightEstimatesReady(false)

    void (async () => {
      for (let i = 1; i <= totalPages; i++) {
        if (cancelled) return
        const page = await pdfDoc.getPage(i)
        const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
        pageHeightsRef.current.set(i, viewport.height + PAGE_CHROME)
      }
      if (!cancelled) setHeightEstimatesReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [pdfDoc, totalPages])

  const virtualizer = useVirtualizer({
    count: totalPages,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      pageHeightsRef.current.get(index + 1) ?? FALLBACK_PAGE_HEIGHT,
    overscan: 2,
  })

  const getPage = useCallback(
    async (pageNum: number) => {
      if (pageCache.current.has(pageNum)) {
        return pageCache.current.get(pageNum)!
      }
      const page = await pdfDoc.getPage(pageNum)
      pageCache.current.set(pageNum, page)
      return page
    },
    [pdfDoc],
  )

  useEffect(() => {
    userScrolledRef.current = false
    lastFollowedPageRef.current = -1
  }, [resetFollowKey])

  useEffect(() => {
    if (initialScrollDoneRef.current || !initialPage || initialPage < 1 || !heightEstimatesReady) {
      return
    }
    initialScrollDoneRef.current = true
    virtualizer.scrollToIndex(initialPage - 1, { align: 'start', behavior: 'auto' })
  }, [initialPage, virtualizer, heightEstimatesReady])

  useEffect(() => {
    if (!followHighlight || userScrolledRef.current || activePageNum < 1) return
    if (activePageNum === lastFollowedPageRef.current) return
    lastFollowedPageRef.current = activePageNum
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    virtualizer.scrollToIndex(activePageNum - 1, {
      align: 'center',
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    })
  }, [activePageNum, followHighlight, virtualizer])

  const handleUserScroll = useCallback(() => {
    userScrolledRef.current = true
  }, [])

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    if (virtualItems.length > 0) {
      onVisiblePageChange?.(virtualItems[0].index + 1)
    }
  }, [virtualItems, onVisiblePageChange])

  return (
    <div
      ref={parentRef}
      className="reader-canvas h-full min-h-0 overflow-y-auto px-4 pb-36 pt-4 sm:px-6"
      onWheel={handleUserScroll}
      onTouchStart={handleUserScroll}
    >
      <div
        className="relative mx-auto max-w-3xl"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            className="absolute left-0 w-full"
            style={{
              top: virtualItem.start,
              height: virtualItem.size,
            }}
          >
            <PdfPageWrapper
              pageNum={virtualItem.index + 1}
              getPage={getPage}
              activeWord={activeWord}
              activeSentenceWords={activeSentenceWords}
              onLineClick={onLineClick}
              pageWords={words.filter((w) => w.pageNum === virtualItem.index + 1)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function PdfPageWrapper({
  pageNum,
  getPage,
  activeWord,
  activeSentenceWords,
  onLineClick,
  pageWords,
}: {
  pageNum: number
  getPage: (n: number) => Promise<Awaited<ReturnType<PDFDocumentProxy['getPage']>>>
  activeWord: WordPosition | null
  activeSentenceWords: WordPosition[]
  onLineClick?: (sentenceIndex: number, wordIndex: number) => void
  pageWords: WordPosition[]
}) {
  const [page, setPage] = useState<Awaited<ReturnType<PDFDocumentProxy['getPage']>> | null>(null)

  useEffect(() => {
    let cancelled = false
    void getPage(pageNum).then((p) => {
      if (!cancelled) setPage(p)
    })
    return () => {
      cancelled = true
    }
  }, [pageNum, getPage])

  const pageSentenceWords = activeSentenceWords.filter((w) => w.pageNum === pageNum)

  return (
    <PdfPage
      page={page}
      pageNum={pageNum}
      activeWord={activeWord}
      activeSentenceWords={pageSentenceWords}
      isVisible={true}
      onLineClick={onLineClick}
      pageWords={pageWords}
    />
  )
}
