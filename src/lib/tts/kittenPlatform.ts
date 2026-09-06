/** Desktop Chrome stalls on large worker transfers; mobile/Android uses the worker path. */
export function shouldUseMainThreadOrt(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isChrome = /Chrome\//.test(ua) && !/Brave|Edg\//.test(ua)
  if (!isChrome) return false
  // Android Chrome freezes when compiling on the main thread (Brave mobile works via worker).
  if (/Android/i.test(ua)) return false
  return true
}

/** Android prefers inline worker to avoid blob-URL COEP issues on Cloudflare Pages. */
export function prefersInlineWorker(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent)
}

/** Multi-threaded ONNX Runtime Web requires cross-origin isolation (COOP + COEP) for SharedArrayBuffer. */
export function isCrossOriginIsolated(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    Boolean(globalThis.crossOriginIsolated) &&
    typeof SharedArrayBuffer !== 'undefined'
  )
}
