import type { PiperPreload } from '@/lib/tts/piperDownload'
import { PIPER_VOICES } from '@/lib/tts/piperVoices'

const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'

export type PiperVoiceProvider = {
  destroy(): void
  list(): Promise<Record<string, unknown>>
  fetch(voice: string): Promise<[Record<string, unknown>, string]>
}

class PiperPreloadFetchProvider {
  private readonly cache = new Map<string, unknown>()
  private readonly blobUrls: string[] = []

  seed(url: string, data: unknown): void {
    if (typeof data === 'string' && data.startsWith('blob:')) {
      this.blobUrls.push(data)
    }
    this.cache.set(url, data)
  }

  destroy(): void {
    for (const url of this.blobUrls) {
      URL.revokeObjectURL(url)
    }
    this.blobUrls.length = 0
    this.cache.clear()
  }

  async fetch(url: string): Promise<unknown> {
    const hit = this.cache.get(url)
    if (hit !== undefined) return hit

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Could not fetch Piper asset: ${url}`)
    }
    const data = url.endsWith('.json')
      ? await response.json()
      : URL.createObjectURL(await response.blob())
    if (typeof data === 'string' && data.startsWith('blob:')) {
      this.blobUrls.push(data)
    }
    this.cache.set(url, data)
    return data
  }
}

function voiceModelPath(voiceId: string): string {
  const parts = voiceId.split('-')
  const lang = parts[0].split('_')[0]
  return `${HF_BASE}${lang}/${parts.join('/')}/${voiceId}`
}

export function createPiperCachedProvider(preload: PiperPreload): PiperVoiceProvider {
  const fetchProvider = new PiperPreloadFetchProvider()
  const modelPath = voiceModelPath(preload.voiceId)

  fetchProvider.seed(`${modelPath}.onnx.json`, preload.config)
  const onnxBlob = new Blob([preload.onnxBuffer], { type: 'application/octet-stream' })
  fetchProvider.seed(`${modelPath}.onnx`, URL.createObjectURL(onnxBlob))

  return {
    destroy: () => fetchProvider.destroy(),
    list: async () =>
      Object.fromEntries(preload.voices.map((v) => [v.id, { name: v.label }])),
    fetch: async (voice: string) => {
      if (voice !== preload.voiceId) {
        throw new Error(`Piper voice "${voice}" is not loaded. Pick a loaded voice in settings.`)
      }
      const path = voiceModelPath(voice)
      const config = (await fetchProvider.fetch(`${path}.onnx.json`)) as Record<string, unknown>
      const onnxUrl = (await fetchProvider.fetch(`${path}.onnx`)) as string
      return [config, onnxUrl]
    },
  }
}

export { PIPER_VOICES }
