import { loadCachedOrtWasm, saveCachedOrtWasm } from '@/lib/tts/ortCache'

const ORT_WASM = '/ort/ort-wasm-simd-threaded.wasm'
const ORT_MJS = '/ort/ort-wasm-simd-threaded.mjs'

let preloadPromise: Promise<void> | null = null
let wasmBinary: ArrayBuffer | null = null

async function fetchOrtWasmFromNetwork(): Promise<ArrayBuffer> {
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
  const buffer = await wasmResp.arrayBuffer()
  await mjsResp.text()
  return buffer
}

/** Warm ORT wasm assets during model download so compile fails fast if missing. */
export function preloadOrtWasm(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = (async () => {
      const cached = await loadCachedOrtWasm()
      if (cached && cached.byteLength > 0) {
        wasmBinary = cached
        return
      }

      const buffer = await fetchOrtWasmFromNetwork()
      wasmBinary = buffer
      saveCachedOrtWasm(buffer)
    })()
  }
  return preloadPromise
}

/** Clone of preloaded ORT wasm (~13 MiB) for transfer into the voice worker. */
export async function getOrtWasmBinary(): Promise<ArrayBuffer> {
  await preloadOrtWasm()
  if (!wasmBinary || wasmBinary.byteLength === 0) {
    throw new Error('ORT runtime wasm failed to preload')
  }
  return wasmBinary.slice(0)
}
