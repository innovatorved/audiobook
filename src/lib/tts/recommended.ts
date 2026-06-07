import type { TtsEngineType, VoiceInfo } from '@/lib/types'

export const RECOMMENDED_ENGINE: TtsEngineType = 'kitten'

const RECOMMENDED_BY_ENGINE: Record<TtsEngineType, ReadonlySet<string>> = {
  kitten: new Set(['Bella', 'Jasper', 'Luna', 'Bruno']),
  piper: new Set([
    'en_US-lessac-medium',
    'en_US-amy-medium',
    'en_US-ryan-medium',
    'en_US-ljspeech-medium',
  ]),
}

export function tagRecommendedVoices(
  engine: TtsEngineType,
  voices: VoiceInfo[],
): VoiceInfo[] {
  const recommended = RECOMMENDED_BY_ENGINE[engine]
  return voices.map((voice) => ({
    ...voice,
    recommended: recommended.has(voice.id),
  }))
}

export function isRecommendedEngine(engine: TtsEngineType): boolean {
  return engine === RECOMMENDED_ENGINE
}
