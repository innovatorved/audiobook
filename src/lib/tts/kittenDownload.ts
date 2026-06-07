/**
 * Browser-side Kitten model download with byte-level progress.
 * Mirrors kitten-tts-js model-loader caching without modifying node_modules.
 */

const HF_BASE = 'https://huggingface.co'
const CACHE_NAME = 'kitten-tts'

/** Approximate download sizes when Content-Length is missing (micro default). */
const ESTIMATED_BYTES: Record<string, number> = {
  'KittenML/kitten-tts-nano-0.8': 25 * 1024 * 1024,
  'KittenML/kitten-tts-micro-0.8': 43 * 1024 * 1024,
  'KittenML/kitten-tts-mini-0.8': 80 * 1024 * 1024,
}

export type KittenDownloadProgress = {
  loaded: number
  total: number
  status: 'downloading' | 'cached' | 'ready'
}

async function cacheGet(key: string): Promise<ArrayBuffer | null> {
  if (typeof caches === 'undefined') return null
  const cache = await caches.open(CACHE_NAME)
  const resp = await cache.match('/' + key)
  if (!resp) return null
  return resp.arrayBuffer()
}

async function cacheSet(key: string, buffer: ArrayBuffer): Promise<void> {
  if (typeof caches === 'undefined') return
  const cache = await caches.open(CACHE_NAME)
  await cache.put('/' + key, new Response(buffer))
}

function hfUrl(repoId: string, filename: string): string {
  return `${HF_BASE}/${repoId}/resolve/main/${filename}`
}

async function fetchWithProgress(
  url: string,
  onBytes: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} downloading ${url.split('/').pop() ?? 'model file'}`)
  }

  const contentLength = Number(resp.headers.get('content-length') ?? 0)
  const body = resp.body
  if (!body) {
    const buffer = await resp.arrayBuffer()
    onBytes(buffer.byteLength, contentLength || buffer.byteLength)
    return buffer
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  onBytes(0, contentLength || 0)

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onBytes(loaded, contentLength || Math.max(loaded, contentLength))
  }

  const buffer = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buffer.buffer
}

async function fetchCached(
  repoId: string,
  filename: string,
  onFileProgress: (loaded: number, total: number, fromCache: boolean) => void,
): Promise<ArrayBuffer> {
  const cacheKey = `${repoId.replace('/', '__')}__${filename.replace(/\//g, '_')}`
  const cached = await cacheGet(cacheKey)
  if (cached) {
    onFileProgress(cached.byteLength, cached.byteLength, true)
    return cached
  }

  const url = hfUrl(repoId, filename)
  const buffer = await fetchWithProgress(url, (loaded, total) => {
    onFileProgress(loaded, total, false)
  })
  await cacheSet(cacheKey, buffer)
  return buffer
}

export async function downloadKittenModel(
  repoId: string,
  onProgress: (progress: KittenDownloadProgress) => void,
): Promise<{ modelBuffer: ArrayBuffer; voicesBuffer: ArrayBuffer; config: Record<string, unknown> }> {
  const estimatedTotal = ESTIMATED_BYTES[repoId] ?? 43 * 1024 * 1024
  const fileProgress = new Map<string, { loaded: number; total: number; fromCache: boolean }>()

  const report = () => {
    let loaded = 0
    let total = 0
    let allCached = true
    for (const { loaded: l, total: t, fromCache } of fileProgress.values()) {
      loaded += l
      total += t
      if (!fromCache) allCached = false
    }
    onProgress({
      loaded,
      total: Math.max(total, estimatedTotal),
      status: allCached && total > 0 && loaded >= total ? 'cached' : 'downloading',
    })
  }

  onProgress({ loaded: 0, total: estimatedTotal, status: 'downloading' })

  const configBuffer = await fetchCached(repoId, 'config.json', (loaded, total, fromCache) => {
    fileProgress.set('config.json', { loaded, total, fromCache })
    report()
  })
  const config = JSON.parse(new TextDecoder().decode(configBuffer)) as Record<string, unknown>

  const modelFile = config.model_file as string | undefined
  const voicesFile = (config.voices as string | undefined) ?? 'voices.npz'
  if (!modelFile) throw new Error(`config.json missing 'model_file' for ${repoId}`)

  const [modelBuffer, voicesBuffer] = await Promise.all([
    fetchCached(repoId, modelFile, (loaded, total, fromCache) => {
      fileProgress.set(modelFile, { loaded, total, fromCache })
      report()
    }),
    fetchCached(repoId, voicesFile, (loaded, total, fromCache) => {
      fileProgress.set(voicesFile, { loaded, total, fromCache })
      report()
    }),
  ])

  onProgress({ loaded: estimatedTotal, total: estimatedTotal, status: 'ready' })
  return { modelBuffer, voicesBuffer, config }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
