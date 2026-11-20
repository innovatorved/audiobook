/** Always run ONNX Runtime WebGPU/WASM inside a dedicated Web Worker so inference never freezes the UI thread. */
export function shouldUseMainThreadOrt(): boolean {
  return false
}

/** Multi-threaded ONNX Runtime Web requires cross-origin isolation (COOP + COEP) for SharedArrayBuffer. */
export function isCrossOriginIsolated(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    Boolean(globalThis.crossOriginIsolated) &&
    typeof SharedArrayBuffer !== 'undefined'
  )
}
