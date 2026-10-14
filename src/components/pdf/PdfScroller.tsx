import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Ref, RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from '@/components/pdf/PdfPage'
import { PDF_RENDER_SCALE } from '@/lib/pdf/constants'
import type { WordPosition } from '@/lib/types'

export type PdfScrollerHandle = {
  scrollToPage: (pageNum: number, options?: { onlyIfOffscreen?: boolean }) => void
  lockUserScroll: () => void
}

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
  onUserNavigate?: () => void
  suppressUserNavigateRef?: RefObject<boolean>
  onLineClick?: (sentenceIndex: number, wordIndex: number) => void
  onLineTouchStart?: (sentenceIndex: number, wordIndex: number) => void
  onEmptyPageClick?: (pageNum: number, x: number, y: number) => void
  onReturnToPlayback?: () => void
  playbackPageNum?: number
  words: WordPosition[]
  scrollerRef?: Ref<PdfScrollerHandle>
}

const PAGE_CHROME = 56
const FALLBACK_PAGE_HEIGHT = 900
const EMPTY_WORDS: WordPosition[] = []

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
  onUserNavigate,
  suppressUserNavigateRef,
  onLineClick,
  onLineTouchStart,
  onEmptyPageClick,
  onReturnToPlayback,
  playbackPageNum,
  words,
  scrollerRef,
}: PdfScrollerProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const pageCache = useRef<Map<number, Awaited<ReturnType<PDFDocumentProxy['getPage']>>>>(new Map())
  const nativePageSizesRef = useRef<Map<number, { width: number; height: number }>>(new Map())
  const defaultNativeSizeRef = useRef<{ width: number; height: number } | null>(null)
  const userScrolledRef = useRef(false)
  const programmaticScrollUntilRef = useRef(0)
  const followScrollingRef = useRef(false)
  const lastAutoScrollTopRef = useRef(0)
  const autoPageScrollUntilRef = useRef(0)
  const activeScrollTargetRef = useRef<number | null>(null)
  const touchStartYRef = useRef(0)
  const lastFollowedPageRef = useRef(-1)
  const followRafRef = useRef<number | null>(null)
  const activeWordRef = useRef(activeWord)
  const activePageNumRef = useRef(activePageNum)
  const followHighlightRef = useRef(followHighlight)
  const columnWidthRef = useRef(0)
  const initialScrollDoneRef = useRef(false)

  const [heightEstimatesReady, setHeightEstimatesReady] = useState(false)
  const [columnWidth, setColumnWidth] = useState(0)

  const wordsByPage = useMemo(() => {
    const map = new Map<number, WordPosition[]>()
    for (const w of words) {
      let arr = map.get(w.pageNum)
      if (!arr) {
        arr = []
        map.set(w.pageNum, arr)
      }
      arr.push(w)
    }
    return map
  }, [words])

  useEffect(() => {
    activeWordRef.current = activeWord
  }, [activeWord])

  useEffect(() => {
    activePageNumRef.current = activePageNum
  }, [activePageNum])

  useEffect(() => {
    followHighlightRef.current = followHighlight
    if (followHighlight && parentRef.current) {
      lastAutoScrollTopRef.current = parentRef.current.scrollTop
    }
  }, [followHighlight])

  useEffect(() => {
    columnWidthRef.current = columnWidth
  }, [columnWidth])

  const markProgrammaticScroll = useCallback((durationMs = 400) => {
    if (parentRef.current) {
      lastAutoScrollTopRef.current = parentRef.current.scrollTop
    }
    programmaticScrollUntilRef.current = Math.max(
      programmaticScrollUntilRef.current,
      Date.now() + durationMs,
    )
  }, [])

  const markAutoScrollPosition = useCallback((scrollTop: number) => {
    lastAutoScrollTopRef.current = scrollTop
    followScrollingRef.current = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        followScrollingRef.current = false
      })
    })
  }, [])

  const markAutoPageScroll = useCallback((durationMs = 450) => {
    autoPageScrollUntilRef.current = Date.now() + durationMs
    activeScrollTargetRef.current = null
  }, [])

  useLayoutEffect(() => {
    const el = columnRef.current
    if (!el) return
    const update = () => {
      const width = el.clientWidth
      if (width > 0) setColumnWidth(width)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    pageCache.current.clear()
    nativePageSizesRef.current.clear()
    defaultNativeSizeRef.current = null
    setHeightEstimatesReady(false)

    void (async () => {
      if (totalPages < 1) {
        if (!cancelled) setHeightEstimatesReady(true)
        return
      }
      const firstPage = await pdfDoc.getPage(1)
      if (cancelled) return
      pageCache.current.set(1, firstPage)
      const firstViewport = firstPage.getViewport({ scale: PDF_RENDER_SCALE })
      const firstSize = { width: firstViewport.width, height: firstViewport.height }
      nativePageSizesRef.current.set(1, firstSize)
      defaultNativeSizeRef.current = firstSize
      setHeightEstimatesReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [pdfDoc, totalPages])

  const estimateSize = useCallback(
    (index: number) => {
      const native = nativePageSizesRef.current.get(index + 1) ?? defaultNativeSizeRef.current
      if (!native || columnWidth <= 0) return FALLBACK_PAGE_HEIGHT
      const scale = Math.min(1, columnWidth / native.width)
      return native.height * scale + PAGE_CHROME
    },
    [columnWidth],
  )

  // TanStack Virtual returns un-memoizable functions; we rely on its internal stability.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: totalPages,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: followHighlight ? 3 : 2,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [columnWidth, heightEstimatesReady, virtualizer])

  const getPage = useCallback(
    async (pageNum: number) => {
      const cached = pageCache.current.get(pageNum)
      if (cached) {
        return cached
      }
      const page = await pdfDoc.getPage(pageNum)
      pageCache.current.set(pageNum, page)
      if (!nativePageSizesRef.current.has(pageNum)) {
        const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
        nativePageSizesRef.current.set(pageNum, {
          width: viewport.width,
          height: viewport.height,
        })
      }
      return page
    },
    [pdfDoc],
  )

  useEffect(() => {
    userScrolledRef.current = false
    lastFollowedPageRef.current = -1
    activeScrollTargetRef.current = null
    if (parentRef.current) {
      lastAutoScrollTopRef.current = parentRef.current.scrollTop
    }
  }, [resetFollowKey])

  const computeWordViewportPosition = useCallback(
    (
      word: WordPosition,
      scrollEl: HTMLElement,
    ): { wordTop: number; wordBottom: number; idealScrollTop: number } | null => {
      const width = columnWidthRef.current
      const native = nativePageSizesRef.current.get(word.pageNum) ?? defaultNativeSizeRef.current
      if (!native || width <= 0) return null

      const pageItem = virtualizer
        .getVirtualItems()
        .find((item) => item.index + 1 === word.pageNum)
      if (!pageItem) return null

      const scale = Math.min(1, width / native.width)
      const wordTop = pageItem.start + word.top * scale
      const wordBottom = wordTop + word.height * scale
      const idealScrollTop = Math.max(0, wordTop - scrollEl.clientHeight * 0.34)
      return { wordTop, wordBottom, idealScrollTop }
    },
    [virtualizer],
  )

  const isPageInView = useCallback(
    (pageNum: number) =>
      virtualizer.getVirtualItems().some((item) => item.index + 1 === pageNum),
    [virtualizer],
  )

  useEffect(() => {
    if (initialScrollDoneRef.current || !initialPage || initialPage < 1 || !heightEstimatesReady) {
      return
    }
    initialScrollDoneRef.current = true
    markProgrammaticScroll()
    virtualizer.scrollToIndex(initialPage - 1, { align: 'start', behavior: 'auto' })
  }, [initialPage, virtualizer, heightEstimatesReady, markProgrammaticScroll])

  useEffect(() => {
    if (!followHighlight) {
      if (followRafRef.current !== null) {
        cancelAnimationFrame(followRafRef.current)
        followRafRef.current = null
      }
      activeScrollTargetRef.current = null
      return
    }

    const prefersReducedMotion = () =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const tick = () => {
      if (!followHighlightRef.current || userScrolledRef.current) {
        followRafRef.current = requestAnimationFrame(tick)
        return
      }

      const scrollEl = parentRef.current
      const word = activeWordRef.current
      if (!scrollEl || !word) {
        followRafRef.current = requestAnimationFrame(tick)
        return
      }

      const followPage = word.pageNum > 0 ? word.pageNum : activePageNumRef.current
      if (followPage > 0 && followPage !== lastFollowedPageRef.current) {
        lastFollowedPageRef.current = followPage
        if (!isPageInView(followPage)) {
          markAutoPageScroll(prefersReducedMotion() ? 200 : 500)
          virtualizer.scrollToIndex(followPage - 1, {
            align: 'start',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          })
          followRafRef.current = requestAnimationFrame(tick)
          return
        }
      }

      if (Date.now() < autoPageScrollUntilRef.current) {
        followRafRef.current = requestAnimationFrame(tick)
        return
      }

      const pos = computeWordViewportPosition(word, scrollEl)
      if (pos !== null) {
        const viewTop = scrollEl.scrollTop
        const viewHeight = scrollEl.clientHeight
        const relTop = pos.wordTop - viewTop
        const relBottom = pos.wordBottom - viewTop

        const comfortTop = viewHeight * 0.18
        const comfortBottom = viewHeight * 0.68

        if (relTop < comfortTop || relBottom > comfortBottom) {
          activeScrollTargetRef.current = pos.idealScrollTop
        }

        const target = activeScrollTargetRef.current
        if (target !== null) {
          const diff = target - scrollEl.scrollTop
          if (Math.abs(diff) <= 3) {
            activeScrollTargetRef.current = null
          } else {
            if (prefersReducedMotion()) {
              scrollEl.scrollTop = target
              activeScrollTargetRef.current = null
            } else {
              const step = Math.abs(diff) > 220 ? 0.14 : 0.1
              scrollEl.scrollTop += diff * step
            }
            markAutoScrollPosition(scrollEl.scrollTop)
          }
        }
      } else if (followPage > 0 && !isPageInView(followPage)) {
        markAutoPageScroll(500)
        virtualizer.scrollToIndex(followPage - 1, {
          align: 'start',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        })
      }

      followRafRef.current = requestAnimationFrame(tick)
    }

    followRafRef.current = requestAnimationFrame(tick)
    return () => {
      if (followRafRef.current !== null) {
        cancelAnimationFrame(followRafRef.current)
        followRafRef.current = null
      }
    }
  }, [
    followHighlight,
    activePageNum,
    virtualizer,
    markAutoScrollPosition,
    markAutoPageScroll,
    computeWordViewportPosition,
    isPageInView,
  ])

  const lockUserScroll = useCallback(() => {
    markProgrammaticScroll()
  }, [markProgrammaticScroll])

  const markUserScrolled = useCallback(() => {
    if (suppressUserNavigateRef?.current === true) return
    if (userScrolledRef.current) return
    userScrolledRef.current = true
    onUserNavigate?.()
  }, [onUserNavigate, suppressUserNavigateRef])

  const handleScroll = useCallback(() => {
    if (!followHighlightRef.current || userScrolledRef.current) return
    if (suppressUserNavigateRef?.current === true) return
    if (followScrollingRef.current) return
    if (Date.now() < programmaticScrollUntilRef.current) return
    if (Date.now() < autoPageScrollUntilRef.current) return

    const el = parentRef.current
    if (!el) return

    const deltaFromAuto = Math.abs(el.scrollTop - lastAutoScrollTopRef.current)
    if (deltaFromAuto > 8) {
      markUserScrolled()
    }
  }, [markUserScrolled, suppressUserNavigateRef])

  useEffect(() => {
    const el = parentRef.current
    if (!el) return

    const onWheel = (event: WheelEvent) => {
      if (!followHighlightRef.current || userScrolledRef.current) return
      if (suppressUserNavigateRef?.current === true) return
      if (Math.abs(event.deltaY) > 0 || Math.abs(event.deltaX) > 0) {
        markUserScrolled()
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? 0
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!followHighlightRef.current || userScrolledRef.current) return
      if (suppressUserNavigateRef?.current === true) return
      const y = event.touches[0]?.clientY ?? touchStartYRef.current
      if (Math.abs(y - touchStartYRef.current) > 6) {
        markUserScrolled()
      }
    }

    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
    }
  }, [markUserScrolled, suppressUserNavigateRef])

  const handleLineClick = useCallback(
    (sentenceIndex: number, wordIndex: number) => {
      markProgrammaticScroll()
      lockUserScroll()
      onLineClick?.(sentenceIndex, wordIndex)
    },
    [onLineClick, markProgrammaticScroll, lockUserScroll],
  )

  const scrollToPage = useCallback(
    (pageNum: number, options?: { onlyIfOffscreen?: boolean }) => {
      if (pageNum < 1 || pageNum > totalPages) return
      const skipped = options?.onlyIfOffscreen && isPageInView(pageNum)
      if (skipped) return
      markProgrammaticScroll()
      virtualizer.scrollToIndex(pageNum - 1, { align: 'start', behavior: 'auto' })
    },
    [totalPages, virtualizer, isPageInView, markProgrammaticScroll],
  )

  useImperativeHandle(scrollerRef, () => ({ scrollToPage, lockUserScroll }), [
    scrollToPage,
    lockUserScroll,
  ])

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    if (virtualItems.length > 0) {
      onVisiblePageChange?.(virtualItems[0].index + 1)
    }
  }, [virtualItems, onVisiblePageChange])

  return (
    <div
      ref={parentRef}
      className="reader-canvas h-full min-h-0 overflow-x-hidden overflow-y-auto px-4 pb-40 pt-7 sm:px-10 sm:pt-12 sm:pb-44"
      onScroll={handleScroll}
    >
      <div
        ref={columnRef}
        className="relative mx-auto w-full max-w-4xl"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtualItem) => {
          const pageNum = virtualItem.index + 1
          return (
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
                pageNum={pageNum}
                getPage={getPage}
                activeWord={activeWord?.pageNum === pageNum ? activeWord : null}
                activeSentenceWords={activeSentenceWords}
                onLineClick={handleLineClick}
                onLineTouchStart={onLineTouchStart}
                onEmptyPageClick={onEmptyPageClick}
                onReturnToPlayback={onReturnToPlayback}
                playbackPageNum={playbackPageNum}
                pageWords={wordsByPage.get(pageNum) ?? EMPTY_WORDS}
                maxWidth={columnWidth}
                estimatedNativeSize={
                  nativePageSizesRef.current.get(pageNum) ??
                  defaultNativeSizeRef.current ??
                  undefined
                }
              />
            </div>
          )
        })}
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
  onLineTouchStart,
  onEmptyPageClick,
  onReturnToPlayback,
  playbackPageNum,
  pageWords,
  maxWidth,
  estimatedNativeSize,
}: {
  pageNum: number
  getPage: (n: number) => Promise<Awaited<ReturnType<PDFDocumentProxy['getPage']>>>
  activeWord: WordPosition | null
  activeSentenceWords: WordPosition[]
  onLineClick?: (sentenceIndex: number, wordIndex: number) => void
  onLineTouchStart?: (sentenceIndex: number, wordIndex: number) => void
  onEmptyPageClick?: (pageNum: number, x: number, y: number) => void
  onReturnToPlayback?: () => void
  playbackPageNum?: number
  pageWords: WordPosition[]
  maxWidth: number
  estimatedNativeSize?: { width: number; height: number }
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

  const pageSentenceWords = useMemo(() => {
    if (activeSentenceWords.length === 0) return EMPTY_WORDS
    const filtered = activeSentenceWords.filter((w) => w.pageNum === pageNum)
    return filtered.length > 0 ? filtered : EMPTY_WORDS
  }, [activeSentenceWords, pageNum])

  return (
    <PdfPage
      page={page}
      pageNum={pageNum}
      activeWord={activeWord}
      activeSentenceWords={pageSentenceWords}
      isVisible={true}
      onLineClick={onLineClick}
      onLineTouchStart={onLineTouchStart}
      onEmptyPageClick={onEmptyPageClick}
      onReturnToPlayback={onReturnToPlayback}
      playbackPageNum={playbackPageNum}
      pageWords={pageWords}
      maxWidth={maxWidth}
      estimatedNativeSize={estimatedNativeSize}
    />
  )
}
