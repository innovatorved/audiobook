import {
  rememberVoice,
  resolveVoiceForEngine,
} from '@/lib/preferences'
import { tagRecommendedVoices } from '@/lib/tts/recommended'
import { usePlayerStore } from '@/stores/playerStore'
import type { VoiceInfo } from '@/lib/types'

export function syncVoiceWithEngineVoices(voices: VoiceInfo[]): string {
  const tagged = tagRecommendedVoices(voices)

  if (tagged.length === 0) {
    usePlayerStore.getState().setVoices(tagged)
    return usePlayerStore.getState().voice
  }

  const store = usePlayerStore.getState()
  const previousVoice = store.voice
  const resolved = resolveVoiceForEngine(tagged, previousVoice)

  store.setVoices(tagged)
  if (resolved !== previousVoice) {
    store.setVoice(resolved)
  }
  rememberVoice(resolved)

  return resolved
}
