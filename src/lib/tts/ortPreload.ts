import { loadCachedOrtWasm, saveCachedOrtWasm } from '@/lib/tts/ortCache'

const ORT_BASE = '/ort'
const ORT_MJS = `${ORT_BASE}/ort-wasm-simd-threaded.jsep.mjs`
const ORT_MANIFEST = `${ORT_BASE}/manifest.json`

type OrtManifest = {
  mjs: string
  wasm: string
  size: number
  parts: number
  chunkSize: number
}

let preloadPromise: Promise<void> | null = null
let wasmBinary: ArrayBuffer | null = null

async function fetchOrtWasmFromNetwork(): Promise<ArrayBuffer> {
  const [manifestResp, mjsResp] = await Promise.all([
    fetch(ORT_MANIFEST, { cache: 'force-cache' }),
    fetch(ORT_MJS, { cache: 'force-cache' }),
  ])
  if (!manifestResp.ok) {
    throw new Error(
      `ORT runtime manifest missing (${ORT_MANIFEST} returned ${manifestResp.status}). Rebuild and redeploy.`,
    )
  }
  if (!mjsResp.ok) {
    throw new Error(
      `ORT runtime missing (${ORT_MJS} returned ${mjsResp.status}). Rebuild and redeploy.`,
    )
  }

  const [manifest] = await Promise.all([
    manifestResp.json() as Promise<OrtManifest>,
    mjsResp.text(),
  ])

  const combined = new Uint8Array(manifest.size)
  await Promise.all(
    Array.from({ length: manifest.parts }, async (_, idx) => {
      const partUrl = `${ORT_BASE}/${manifest.wasm}.part${idx}`
      const resp = await fetch(partUrl, { cache: 'force-cache' })
      if (!resp.ok) {
        throw new Error(`ORT runtime part missing (${partUrl} returned ${resp.status})`)
      }
      const buf = await resp.arrayBuffer()
      combined.set(new Uint8Array(buf), idx * manifest.chunkSize)
    }),
  )

  return combined.buffer
}

/** Warm ORT WebGPU/WASM assets during model download so compile fails fast if missing. */
export function preloadOrtWasm(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = (async () => {
      const cached = await loadCachedOrtWasm()
      if (cached && cached.byteLength > 20 * 1024 * 1024) {
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

/** Clone of preloaded ORT WebGPU/WASM binary for transfer into the voice worker. */
export async function getOrtWasmBinary(): Promise<ArrayBuffer> {
  await preloadOrtWasm()
  if (!wasmBinary || wasmBinary.byteLength === 0) {
    throw new Error('ORT runtime wasm failed to preload')
  }
  return wasmBinary.slice(0)
}
