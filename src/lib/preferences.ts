import { usePlayerStore } from '@/stores/playerStore'
import type { VoiceInfo } from '@/lib/types'
import { clampPlaybackSpeed } from '@/lib/audio/speed'

const STORAGE_KEY = 'audiobook-prefs'
const DEFAULT_VOICE = 'Bella'

export interface UserPreferences {
  voice: string
  speed: number
  volume: number
}

const DEFAULT_PREFERENCES: UserPreferences = {
  voice: DEFAULT_VOICE,
  speed: 1,
  volume: 1,
}

function normalizeVoice(value: unknown): string {
  if (typeof value === 'string' && value.length > 0 && !value.includes('-')) {
    return value
  }
  return DEFAULT_VOICE
}

export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFERENCES }
    const parsed = JSON.parse(raw) as Partial<UserPreferences> & {
      engine?: unknown
      voiceByEngine?: { kitten?: string }
    }
    const legacyVoice = parsed.voiceByEngine?.kitten
    return {
      voice: normalizeVoice(parsed.voice ?? legacyVoice),
      speed: clampPlaybackSpeed(parsed.speed ?? DEFAULT_PREFERENCES.speed),
      volume: parsed.volume ?? DEFAULT_PREFERENCES.volume,
    }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function savePreferences(patch: Partial<UserPreferences>): UserPreferences {
  const current = loadPreferences()
  const next: UserPreferences = {
    voice: patch.voice ? normalizeVoice(patch.voice) : current.voice,
    speed: clampPlaybackSpeed(patch.speed ?? current.speed),
    volume: patch.volume ?? current.volume,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function getPreferredVoice(): string {
  return loadPreferences().voice
}

export function sanitizeVoice(voice: string): string {
  return normalizeVoice(voice)
}

export function resolveVoiceForEngine(
  voices: VoiceInfo[],
  currentVoice?: string,
): string {
  if (voices.length === 0) {
    return currentVoice ?? getPreferredVoice()
  }

  const ids = new Set(voices.map((v) => v.id))
  const preferred = getPreferredVoice()

  if (currentVoice && ids.has(currentVoice)) return currentVoice
  if (ids.has(preferred)) return preferred
  if (ids.has(DEFAULT_VOICE)) return DEFAULT_VOICE

  return voices[0].id
}

export function rememberVoice(voice: string): void {
  savePreferences({ voice })
}

export function applyPreferencesToStore(): UserPreferences {
  const prefs = loadPreferences()

  usePlayerStore.setState({
    engine: 'kitten',
    voice: prefs.voice,
    speed: prefs.speed,
    volume: prefs.volume,
  })
  return prefs
}
