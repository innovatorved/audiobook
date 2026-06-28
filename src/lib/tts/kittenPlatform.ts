/** Chrome stalls on large worker transfers; Brave/Safari/Firefox use the worker path. */
export function useMainThreadOrt(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Chrome\//.test(ua) && !/Brave|Edg\//.test(ua)
}
