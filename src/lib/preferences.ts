import { usePlayerStore } from '@/stores/playerStore'
import type { TtsEngineType, VoiceInfo } from '@/lib/types'
import { clampPlaybackSpeed } from '@/lib/audio/speed'

const STORAGE_KEY = 'audiobook-prefs'
const DEFAULT_VOICE = 'Bella'
const DEFAULT_ENGINE: TtsEngineType = 'kitten'

export type ThemePreference = 'light' | 'dark' | 'system'

export interface UserPreferences {
  engine: TtsEngineType
  voice: string
  voiceByEngine: Partial<Record<TtsEngineType, string>>
  speed: number
  volume: number
  theme: ThemePreference
}

const DEFAULT_PREFERENCES: UserPreferences = {
  engine: DEFAULT_ENGINE,
  voice: DEFAULT_VOICE,
  voiceByEngine: { kitten: DEFAULT_VOICE },
  speed: 1,
  volume: 1,
  theme: 'dark',
}

function normalizeTheme(value: unknown): ThemePreference {
  if (value === 'light' || value === 'dark' || value === 'system') return value
  return DEFAULT_PREFERENCES.theme
}

function normalizeEngine(value: unknown): TtsEngineType {
  return value === 'browser' || value === 'kitten' ? value : DEFAULT_ENGINE
}

function normalizeVoice(value: unknown, engine: TtsEngineType): string {
  if (engine === 'browser') {
    return typeof value === 'string' && value.length > 0 ? value : ''
  }
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
      voiceByEngine?: Partial<Record<TtsEngineType, string>>
    }
    const engine = normalizeEngine(parsed.engine)
    const voiceByEngine = {
      kitten: normalizeVoice(parsed.voiceByEngine?.kitten ?? parsed.voice, 'kitten'),
      browser: normalizeVoice(parsed.voiceByEngine?.browser, 'browser'),
    }
    return {
      engine,
      voice: normalizeVoice(voiceByEngine[engine] ?? parsed.voice, engine),
      voiceByEngine,
      speed: clampPlaybackSpeed(parsed.speed ?? DEFAULT_PREFERENCES.speed),
      volume: parsed.volume ?? DEFAULT_PREFERENCES.volume,
      theme: normalizeTheme(parsed.theme),
    }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function savePreferences(patch: Partial<UserPreferences>): UserPreferences {
  const current = loadPreferences()
  const engine = normalizeEngine(patch.engine ?? current.engine)
  const voiceByEngine = { ...current.voiceByEngine }
  if (patch.voice !== undefined) {
    voiceByEngine[engine] = normalizeVoice(patch.voice, engine)
  }
  if (patch.voiceByEngine) {
    for (const [key, value] of Object.entries(patch.voiceByEngine)) {
      const entryEngine = normalizeEngine(key)
      voiceByEngine[entryEngine] = normalizeVoice(value, entryEngine)
    }
  }
  const next: UserPreferences = {
    engine,
    voice: normalizeVoice(voiceByEngine[engine] ?? current.voice, engine),
    voiceByEngine,
    speed: clampPlaybackSpeed(patch.speed ?? current.speed),
    volume: patch.volume ?? current.volume,
    theme: normalizeTheme(patch.theme ?? current.theme),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function getPreferredVoice(engine = loadPreferences().engine): string {
  const prefs = loadPreferences()
  return normalizeVoice(prefs.voiceByEngine[engine] ?? prefs.voice, engine)
}

export function sanitizeVoice(voice: string, engine: TtsEngineType = 'kitten'): string {
  return normalizeVoice(voice, engine)
}

export function resolveVoiceForEngine(
  voices: VoiceInfo[],
  currentVoice?: string,
): string {
  if (voices.length === 0) {
    return currentVoice ?? getPreferredVoice()
  }

  const ids = new Set(voices.map((v) => v.id))
  const engine = usePlayerStore.getState().engine
  const preferred = getPreferredVoice(engine)

  if (currentVoice && ids.has(currentVoice)) return currentVoice
  if (ids.has(preferred)) return preferred
  if (ids.has(DEFAULT_VOICE)) return DEFAULT_VOICE

  return voices[0].id
}

export function rememberVoice(voice: string): void {
  const engine = usePlayerStore.getState().engine
  savePreferences({ voice, voiceByEngine: { [engine]: voice } })
}

export function applyPreferencesToStore(): UserPreferences {
  const prefs = loadPreferences()

  usePlayerStore.setState({
    engine: prefs.engine,
    voice: prefs.voice,
    speed: prefs.speed,
    volume: prefs.volume,
  })
  return prefs
}
