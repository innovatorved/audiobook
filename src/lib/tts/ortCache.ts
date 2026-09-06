import { db, ensureDbOpen } from '@/lib/db/index'

export const ORT_WASM_CACHE_KEY = 'ort-wasm-simd-threaded'

export async function loadCachedOrtWasm(): Promise<ArrayBuffer | null> {
  await ensureDbOpen()
  const record = await db.ortWasmCache.get(ORT_WASM_CACHE_KEY)
  if (!record || !record.wasmBuffer || record.wasmBuffer.byteLength === 0) return null
  return record.wasmBuffer
}

async function writeCachedOrtWasm(wasmBuffer: ArrayBuffer): Promise<void> {
  await ensureDbOpen()
  try {
    await db.ortWasmCache.put({
      id: ORT_WASM_CACHE_KEY,
      wasmBuffer,
      updatedAt: Date.now(),
    })
  } catch (err) {
    console.warn('[TTS] Could not cache ORT wasm locally:', err)
  }
}

export function saveCachedOrtWasm(wasmBuffer: ArrayBuffer): void {
  const run = () => {
    void writeCachedOrtWasm(wasmBuffer)
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 5000 })
  } else {
    setTimeout(run, 0)
  }
}
