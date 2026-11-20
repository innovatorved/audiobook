import type { VoiceInfo } from '@/lib/types'

const RECOMMENDED_VOICES = new Set(['Heart', 'Bella', 'Nova', 'Michael'])

export function tagRecommendedVoices(voices: VoiceInfo[]): VoiceInfo[] {
  return voices.map((voice) => ({
    ...voice,
    recommended: RECOMMENDED_VOICES.has(voice.id),
  }))
}
