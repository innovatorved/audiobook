import type { KittenManifest } from '@/lib/tts/kittenModelCache'

const MODEL_BASE = '/kitten-model'

export type KittenDownloadProgress = {
  loaded: number
  total: number
  status: 'downloading' | 'cached' | 'ready'
}

type FileMeta = { size: number; parts: number }

async function fetchBuffer(
  url: string,
  onBytes: (delta: number) => void,
): Promise<ArrayBuffer> {
  const resp = await fetch(url, { cache: 'force-cache' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`)
  if (!resp.body) {
    const buf = await resp.arrayBuffer()
    onBytes(buf.byteLength)
    return buf
  }
  const reader = resp.body.getReader()
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
    return fetchBuffer(urls[0], onBytes)
  }
  const buffers: ArrayBuffer[] = []
  for (const url of urls) {
    buffers.push(await fetchBuffer(url, onBytes))
    await yieldToMain()
  }
  const combined = new Uint8Array(meta.size)
  let offset = 0
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset)
    offset += buf.byteLength
    await yieldToMain()
  }
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

/** Preload manifest + model parts so download starts before app JS boots. */
export function preloadKittenModelAssets(): void {
  if (typeof document === 'undefined') return
  const hints = [
    '/kitten-model/manifest.json',
    '/ort/ort-wasm-simd-threaded.wasm',
    '/ort/ort-wasm-simd-threaded.mjs',
    '/kitten-model/kitten_tts_micro_v0_8.ort.part0',
    '/kitten-model/kitten_tts_micro_v0_8.ort.part1',
    '/kitten-model/kitten_tts_micro_v0_8.ort.part2',
    '/kitten-model/kitten_tts_micro_v0_8.ort.part3',
    '/kitten-model/kitten_tts_micro_v0_8.ort.part4',
    '/kitten-model/kitten_tts_micro_v0_8.ort.part5',
    '/kitten-model/kitten_tts_micro_v0_8.ort.part6',
  ]
  for (const href of hints) {
    if (document.querySelector(`link[rel="preload"][href="${href}"]`)) continue
    const link = document.createElement('link')
    link.rel = 'preload'
    link.href = href
    link.as = 'fetch'
    link.crossOrigin = 'anonymous'
    document.head.appendChild(link)
  }
}
