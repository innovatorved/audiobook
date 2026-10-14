import type { KittenManifest } from '@/lib/tts/kittenModelCache'

const MODEL_BASE = '/kitten-model'
const PART_CHUNK_SIZE = 8 * 1024 * 1024
const PART_DOWNLOAD_CONCURRENCY = 3

export type KittenDownloadProgress = {
  loaded: number
  total: number
  status: 'downloading' | 'cached' | 'ready'
}

type FileMeta = { size: number; parts: number }

async function fetchIntoTarget(
  url: string,
  target: Uint8Array | null,
  targetOffset: number,
  onBytes: (delta: number) => void,
): Promise<ArrayBuffer> {
  const resp = await fetch(url, { cache: 'force-cache' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`)
  if (!resp.body) {
    const buf = await resp.arrayBuffer()
    onBytes(buf.byteLength)
    if (target) {
      target.set(new Uint8Array(buf), targetOffset)
      return target.buffer as ArrayBuffer
    }
    return buf
  }

  const reader = resp.body.getReader()
  if (target) {
    let offset = targetOffset
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      target.set(value, offset)
      offset += value.byteLength
      onBytes(value.byteLength)
    }
    return target.buffer as ArrayBuffer
  }

  const contentLength = Number(resp.headers.get('content-length') ?? 0)
  if (contentLength > 0) {
    const out = new Uint8Array(contentLength)
    let offset = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (offset + value.byteLength <= out.byteLength) {
        out.set(value, offset)
      }
      offset += value.byteLength
      onBytes(value.byteLength)
    }
    return offset === out.byteLength ? out.buffer : out.buffer.slice(0, offset)
  }

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
    onBytes(value.byteLength)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out.buffer
}

function fileUrls(filename: string, meta: FileMeta): string[] {
  if (meta.parts === 1) {
    return [`${MODEL_BASE}/${filename}`]
  }
  return Array.from({ length: meta.parts }, (_, i) => `${MODEL_BASE}/${filename}.part${i}`)
}

async function yieldToMain(): Promise<void> {
  if (
    typeof globalThis !== 'undefined' &&
    'scheduler' in globalThis &&
    typeof (globalThis.scheduler as { yield?: () => Promise<void> })?.yield === 'function'
  ) {
    await (globalThis.scheduler as { yield: () => Promise<void> }).yield()
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function fetchFile(
  filename: string,
  meta: FileMeta,
  onBytes: (delta: number) => void,
): Promise<ArrayBuffer> {
  const urls = fileUrls(filename, meta)
  if (urls.length === 1) {
    return fetchIntoTarget(urls[0], new Uint8Array(meta.size), 0, onBytes)
  }

  const combined = new Uint8Array(meta.size)
  let nextPart = 0

  const worker = async () => {
    while (nextPart < urls.length) {
      const partIdx = nextPart++
      const offset = partIdx * PART_CHUNK_SIZE
      await fetchIntoTarget(urls[partIdx], combined, offset, onBytes)
      await yieldToMain()
    }
  }

  const concurrency = Math.min(PART_DOWNLOAD_CONCURRENCY, urls.length)
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return combined.buffer
}

function findModelFile(manifest: KittenManifest): string {
  const ortFile = Object.keys(manifest.files).find((name) => name.endsWith('.ort'))
  if (ortFile) return ortFile
  const onnxFile = Object.keys(manifest.files).find((name) => name.endsWith('.onnx'))
  if (onnxFile) return onnxFile
  throw new Error('Manifest missing voice model file (.ort or .onnx)')
}

export async function downloadKittenModel(
  _repoId: string,
  onProgress: (progress: KittenDownloadProgress) => void,
  manifest?: KittenManifest,
): Promise<{ modelBuffer: ArrayBuffer; voicesBuffer: ArrayBuffer; config: Record<string, unknown> }> {
  const resolvedManifest =
    manifest ??
    (await (async () => {
      const resp = await fetch(`${MODEL_BASE}/manifest.json`, { cache: 'force-cache' })
      if (!resp.ok) {
        throw new Error(
          'Voice model bundle missing. Rebuild and redeploy with npm run build.',
        )
      }
      return (await resp.json()) as KittenManifest
    })())

  const totalSize = Object.values(resolvedManifest.files).reduce((acc, f) => acc + f.size, 0)
  let loaded = 0
  const tick = (delta: number) => {
    loaded += delta
    onProgress({ loaded, total: totalSize, status: 'downloading' })
  }

  onProgress({ loaded: 0, total: totalSize, status: 'downloading' })

  const configMeta = resolvedManifest.files['config.json']
  const voicesFile = 'voices.npz'
  const modelFile = findModelFile(resolvedManifest)
  const modelMeta = resolvedManifest.files[modelFile]
  const voicesMeta = resolvedManifest.files[voicesFile]
  if (!configMeta) throw new Error('Manifest missing config.json')
  if (!modelMeta) throw new Error(`Manifest missing ${modelFile}`)
  if (!voicesMeta) throw new Error(`Manifest missing ${voicesFile}`)

  const [configBuffer, modelBuffer, voicesBuffer] = await Promise.all([
    fetchFile('config.json', configMeta, tick),
    fetchFile(modelFile, modelMeta, tick),
    fetchFile(voicesFile, voicesMeta, tick),
  ])

  const config = JSON.parse(new TextDecoder().decode(configBuffer)) as Record<string, unknown>

  onProgress({ loaded: totalSize, total: totalSize, status: 'ready' })
  return { modelBuffer, voicesBuffer, config }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Kept as a no-op; prepareKittenInBackground() checks IndexedDB cache first before fetching parts. */
export function preloadKittenModelAssets(): void {
  // No-op: avoids downloading 68 MB via <link rel="preload"> when already cached in IndexedDB.
}
