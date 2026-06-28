import { db, ensureDbOpen } from '@/lib/db/index'
import { digestSha256 } from '@/lib/hash/sha256'
import type { KittenPreload } from '@/lib/tts/kittenEngine'

export type KittenManifest = {
  repo: string
  files: Record<string, { size: number; parts: number }>
}

export async function fetchKittenManifest(): Promise<KittenManifest> {
  const resp = await fetch('/kitten-model/manifest.json')
  if (!resp.ok) {
    throw new Error(
      'Voice model bundle missing. Rebuild and redeploy with npm run build.',
    )
  }
  return (await resp.json()) as KittenManifest
}

export async function hashKittenManifest(manifest: KittenManifest): Promise<string> {
  const text = JSON.stringify(manifest)
  return digestSha256(new TextEncoder().encode(text).buffer)
}

function cloneArrayBuffer(buf: ArrayBuffer): ArrayBuffer | null {
  if (buf.byteLength === 0) return null
  try {
    return buf.slice(0)
  } catch {
    return null
  }
}

export async function loadCachedKittenModel(
  manifestHash: string,
): Promise<KittenPreload | null> {
  await ensureDbOpen()
  const record = await db.voiceModelCache.get(manifestHash)
  if (!record) return null

  const modelBuffer = cloneArrayBuffer(record.modelBuffer)
  const voicesBuffer = cloneArrayBuffer(record.voicesBuffer)
  if (!modelBuffer || !voicesBuffer) return null

  return {
    modelBuffer,
    voicesBuffer,
    config: record.config,
  }
}

async function writeCachedKittenModel(
  manifestHash: string,
  preload: KittenPreload,
): Promise<void> {
  await ensureDbOpen()
  try {
    await db.voiceModelCache.put({
      manifestHash,
      modelBuffer: preload.modelBuffer,
      voicesBuffer: preload.voicesBuffer,
      config: preload.config,
      updatedAt: Date.now(),
    })
  } catch (err) {
    console.warn('[TTS] Could not cache voice model locally:', err)
  }
}

export function saveCachedKittenModel(
  manifestHash: string,
  preload: KittenPreload,
): void {
  const run = () => {
    void writeCachedKittenModel(manifestHash, preload)
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 5000 })
  } else {
    setTimeout(run, 0)
  }
}
