const MODEL_BASE = '/kitten-model'

export type KittenDownloadProgress = {
  loaded: number
  total: number
  status: 'downloading' | 'cached' | 'ready'
}

type Manifest = {
  repo: string
  files: Record<string, { size: number; parts: number }>
}

async function fetchBuffer(
  url: string,
  onBytes: (delta: number) => void,
): Promise<ArrayBuffer> {
  const resp = await fetch(url)
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

async function fetchChunked(
  filename: string,
  parts: number,
  size: number,
  onBytes: (delta: number) => void,
): Promise<ArrayBuffer> {
  if (parts === 1) {
    return fetchBuffer(`${MODEL_BASE}/${filename}`, onBytes)
  }
  const buffers: ArrayBuffer[] = []
  for (let i = 0; i < parts; i++) {
    buffers.push(await fetchBuffer(`${MODEL_BASE}/${filename}.part${i}`, onBytes))
  }
  const combined = new Uint8Array(size)
  let offset = 0
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset)
    offset += buf.byteLength
  }
  return combined.buffer
}

export async function downloadKittenModel(
  _repoId: string,
  onProgress: (progress: KittenDownloadProgress) => void,
): Promise<{ modelBuffer: ArrayBuffer; voicesBuffer: ArrayBuffer; config: Record<string, unknown> }> {
  const manifestResp = await fetch(`${MODEL_BASE}/manifest.json`)
  if (!manifestResp.ok) {
    throw new Error(
      'Voice model bundle missing. Rebuild and redeploy with npm run build.',
    )
  }
  const manifest = (await manifestResp.json()) as Manifest

  const totalSize = Object.values(manifest.files).reduce((acc, f) => acc + f.size, 0)
  let loaded = 0
  const tick = (delta: number) => {
    loaded += delta
    onProgress({ loaded, total: totalSize, status: 'downloading' })
  }

  onProgress({ loaded: 0, total: totalSize, status: 'downloading' })

  const configMeta = manifest.files['config.json']
  if (!configMeta) throw new Error('Manifest missing config.json')
  const configBuffer = await fetchChunked('config.json', configMeta.parts, configMeta.size, tick)
  const config = JSON.parse(new TextDecoder().decode(configBuffer)) as Record<string, unknown>

  const modelFile = config.model_file as string | undefined
  const voicesFile = (config.voices as string | undefined) ?? 'voices.npz'
  if (!modelFile) throw new Error("config.json missing 'model_file'")
  const modelMeta = manifest.files[modelFile]
  const voicesMeta = manifest.files[voicesFile]
  if (!modelMeta) throw new Error(`Manifest missing ${modelFile}`)
  if (!voicesMeta) throw new Error(`Manifest missing ${voicesFile}`)

  const [modelBuffer, voicesBuffer] = await Promise.all([
    fetchChunked(modelFile, modelMeta.parts, modelMeta.size, tick),
    fetchChunked(voicesFile, voicesMeta.parts, voicesMeta.size, tick),
  ])

  onProgress({ loaded: totalSize, total: totalSize, status: 'ready' })
  return { modelBuffer, voicesBuffer, config }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
