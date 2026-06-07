import type { TtsEngineType } from '@/lib/types'

/** Set at build time — false on Cloudflare Pages (Piper assets exceed 25 MiB limit). */
export function isPiperAvailable(): boolean {
  return import.meta.env.VITE_PIPER_AVAILABLE === true
}

export function resolveEngineType(engine: TtsEngineType): TtsEngineType {
  if (engine === 'piper' && !isPiperAvailable()) return 'kitten'
  return engine
}
