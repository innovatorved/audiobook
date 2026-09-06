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

export async function loadCachedKittenModel(
  manifestHash: string,
): Promise<KittenPreload | null> {
  await ensureDbOpen()
  const record = await db.voiceModelCache.get(manifestHash)
  if (!record || !record.modelBuffer || !record.voicesBuffer) return null
  if (record.modelBuffer.byteLength === 0 || record.voicesBuffer.byteLength === 0) return null

  return {
    modelBuffer: record.modelBuffer,
    voicesBuffer: record.voicesBuffer,
    config: record.config,
  }
}

/** Fallback to the latest cached voice model in IndexedDB when offline. */
export async function loadLatestCachedKittenModel(): Promise<{
  preload: KittenPreload
  manifestHash: string
} | null> {
  await ensureDbOpen()
  const record = await db.voiceModelCache.orderBy('updatedAt').reverse().first()
  if (!record || !record.modelBuffer || !record.voicesBuffer) return null
  if (record.modelBuffer.byteLength === 0 || record.voicesBuffer.byteLength === 0) return null

  return {
    preload: {
      modelBuffer: record.modelBuffer,
      voicesBuffer: record.voicesBuffer,
      config: record.config,
    },
    manifestHash: record.manifestHash,
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
