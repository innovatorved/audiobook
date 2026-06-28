const ORT_WASM = '/ort/ort-wasm-simd-threaded.wasm'
const ORT_MJS = '/ort/ort-wasm-simd-threaded.mjs'

let preloadPromise: Promise<void> | null = null

/** Warm ORT wasm assets during model download so compile fails fast if missing. */
export function preloadOrtWasm(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = (async () => {
      const [wasmResp, mjsResp] = await Promise.all([
        fetch(ORT_WASM, { cache: 'force-cache' }),
        fetch(ORT_MJS, { cache: 'force-cache' }),
      ])
      if (!wasmResp.ok) {
        throw new Error(
          `ORT runtime missing (${ORT_WASM} returned ${wasmResp.status}). Rebuild and redeploy.`,
        )
      }
      if (!mjsResp.ok) {
        throw new Error(
          `ORT runtime missing (${ORT_MJS} returned ${mjsResp.status}). Rebuild and redeploy.`,
        )
      }
      await Promise.all([wasmResp.arrayBuffer(), mjsResp.text()])
    })()
  }
  return preloadPromise
}
