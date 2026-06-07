import type { VoiceInfo } from '@/lib/types'
import { PIPER_DEFAULT_VOICE, PIPER_VOICES } from '@/lib/tts/piperVoices'

const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'

export type PiperPreload = {
  voiceId: string
  config: Record<string, unknown>
  onnxBuffer: ArrayBuffer
  voices: VoiceInfo[]
}

const cache = new Map<string, PiperPreload>()

function voiceModelUrls(voiceId: string): { configUrl: string; onnxUrl: string } {
  const parts = voiceId.split('-')
  const lang = parts[0].split('_')[0]
  const folder = parts.join('/')
  const base = `${HF_BASE}${lang}/${folder}/${voiceId}`
  return { configUrl: `${base}.onnx.json`, onnxUrl: `${base}.onnx` }
}

export function getCachedPiperPreload(voiceId: string): PiperPreload | null {
  const hit = cache.get(voiceId)
  if (hit && hit.onnxBuffer.byteLength > 0) return hit
  return null
}

export async function downloadPiperVoice(
  voiceId: string = PIPER_DEFAULT_VOICE,
  onProgress?: (loaded: number, total: number) => void,
): Promise<PiperPreload> {
  const cached = getCachedPiperPreload(voiceId)
  if (cached) {
    onProgress?.(cached.onnxBuffer.byteLength, cached.onnxBuffer.byteLength)
    return cached
  }

  const { configUrl, onnxUrl } = voiceModelUrls(voiceId)
  const configRes = await fetch(configUrl)
  if (!configRes.ok) {
    throw new Error(`Could not fetch Piper voice config: ${configUrl}`)
  }
  const config = (await configRes.json()) as Record<string, unknown>

  const onnxRes = await fetch(onnxUrl)
  if (!onnxRes.ok) {
    throw new Error(`Could not fetch Piper voice model: ${onnxUrl}`)
  }

  const total = Number(onnxRes.headers.get('content-length') ?? 0)
  let loaded = 0
  const reader = onnxRes.body?.getReader()
  const chunks: Uint8Array[] = []

  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.byteLength
      onProgress?.(loaded, total || loaded)
    }
  }

  const onnxBuffer = reader
    ? (() => {
        const out = new Uint8Array(loaded)
        let offset = 0
        for (const chunk of chunks) {
          out.set(chunk, offset)
          offset += chunk.byteLength
        }
        return out.buffer
      })()
    : await onnxRes.arrayBuffer()

  const preload: PiperPreload = {
    voiceId,
    config,
    onnxBuffer,
    voices: PIPER_VOICES,
  }
  cache.set(voiceId, preload)
  onProgress?.(onnxBuffer.byteLength, onnxBuffer.byteLength)
  return preload
}
