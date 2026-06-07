import { usePlayerStore } from '@/stores/playerStore'
import { resolveEngineType } from '@/lib/tts/deployment'
import type { TtsEngineType, VoiceInfo } from '@/lib/types'

const STORAGE_KEY = 'audiobook-prefs'

export const DEFAULT_VOICE_BY_ENGINE: Record<TtsEngineType, string> = {
  kitten: 'Bella',
  piper: 'en_US-lessac-medium',
}

export interface UserPreferences {
  engine: TtsEngineType
  voiceByEngine: Partial<Record<TtsEngineType, string>>
  speed: number
  volume: number
}

const DEFAULT_PREFERENCES: UserPreferences = {
  engine: 'kitten',
  voiceByEngine: {
    kitten: 'Bella',
    piper: 'en_US-lessac-medium',
  },
  speed: 1,
  volume: 1,
}

function normalizeEngine(value: unknown): TtsEngineType {
  if (value === 'piper' || value === 'kitten') return resolveEngineType(value)
  return 'kitten'
}

export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFERENCES }
    const parsed = JSON.parse(raw) as Partial<UserPreferences> & { engine?: unknown }
    return {
      engine: normalizeEngine(parsed.engine),
      voiceByEngine: {
        ...DEFAULT_PREFERENCES.voiceByEngine,
        ...parsed.voiceByEngine,
      },
      speed: parsed.speed ?? DEFAULT_PREFERENCES.speed,
      volume: parsed.volume ?? DEFAULT_PREFERENCES.volume,
    }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function savePreferences(patch: Partial<UserPreferences>): UserPreferences {
  const current = loadPreferences()
  const next: UserPreferences = {
    engine: patch.engine ? normalizeEngine(patch.engine) : current.engine,
    voiceByEngine: {
      ...current.voiceByEngine,
      ...patch.voiceByEngine,
    },
    speed: patch.speed ?? current.speed,
    volume: patch.volume ?? current.volume,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function getPreferredVoice(engine: TtsEngineType): string {
  const prefs = loadPreferences()
  return prefs.voiceByEngine[engine] ?? DEFAULT_VOICE_BY_ENGINE[engine]
}

export function isVoicePlausibleForEngine(voice: string, engine: TtsEngineType): boolean {
  switch (engine) {
    case 'piper':
      return voice.includes('-')
    case 'kitten':
      return !voice.includes('-')
    default:
      return true
  }
}

export function sanitizeVoiceForEngine(voice: string, engine: TtsEngineType): string {
  return isVoicePlausibleForEngine(voice, engine) ? voice : getPreferredVoice(engine)
}

export function resolveVoiceForEngine(
  voices: VoiceInfo[],
  engine: TtsEngineType,
  currentVoice?: string,
): string {
  if (voices.length === 0) {
    return currentVoice ?? getPreferredVoice(engine)
  }

  const ids = new Set(voices.map((v) => v.id))
  const preferred = getPreferredVoice(engine)

  if (currentVoice && ids.has(currentVoice)) return currentVoice
  if (ids.has(preferred)) return preferred

  const fallback = DEFAULT_VOICE_BY_ENGINE[engine]
  if (ids.has(fallback)) return fallback

  return voices[0].id
}

export function rememberVoiceForEngine(engine: TtsEngineType, voice: string): void {
  savePreferences({ voiceByEngine: { [engine]: voice } })
}

export function applyPreferencesToStore(): UserPreferences {
  const prefs = loadPreferences()
  const voice = getPreferredVoice(prefs.engine)

  usePlayerStore.setState({
    engine: prefs.engine,
    voice,
    speed: prefs.speed,
    volume: prefs.volume,
  })
  return prefs
}
