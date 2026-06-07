import {
  getPreferredVoice,
  rememberVoiceForEngine,
  resolveVoiceForEngine,
} from '@/lib/preferences'
import { tagRecommendedVoices } from '@/lib/tts/recommended'
import { usePlayerStore } from '@/stores/playerStore'
import type { TtsEngineType, VoiceInfo } from '@/lib/types'

export function syncVoiceWithEngineVoices(
  voices: VoiceInfo[],
  engine: TtsEngineType | null,
): string {
  const tagged = engine ? tagRecommendedVoices(engine, voices) : voices

  if (!engine || tagged.length === 0) {
    usePlayerStore.getState().setVoices(tagged)
    return usePlayerStore.getState().voice
  }

  const store = usePlayerStore.getState()
  const previousVoice = store.voice
  const resolved = resolveVoiceForEngine(tagged, engine, previousVoice)

  store.setVoices(tagged)
  if (resolved !== previousVoice) {
    store.setVoice(resolved)
    rememberVoiceForEngine(engine, resolved)
  } else {
    rememberVoiceForEngine(engine, resolved)
  }

  return resolved
}
