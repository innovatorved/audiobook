import type { VoiceInfo } from '@/lib/types'

const RECOMMENDED_VOICES = new Set(['Bella', 'Jasper', 'Luna', 'Bruno'])

export function tagRecommendedVoices(voices: VoiceInfo[]): VoiceInfo[] {
  return voices.map((voice) => ({
    ...voice,
    recommended: RECOMMENDED_VOICES.has(voice.id),
  }))
}
