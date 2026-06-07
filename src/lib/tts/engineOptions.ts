import type { TtsEngineType } from '@/lib/types'
import { isPiperAvailable } from '@/lib/tts/deployment'
import { isRecommendedEngine } from '@/lib/tts/recommended'

const ALL_ENGINE_OPTIONS: Array<{
  id: TtsEngineType
  label: string
  description: string
  recommended: boolean
}> = [
  {
    id: 'kitten',
    label: 'Balanced',
    description: 'Kitten Micro — natural voices, ~43 MB',
    recommended: isRecommendedEngine('kitten'),
  },
  {
    id: 'piper',
    label: 'Fast CPU',
    description: 'Piper — efficient WASM, ~75 MB',
    recommended: isRecommendedEngine('piper'),
  },
]

export const ENGINE_OPTIONS = ALL_ENGINE_OPTIONS.filter(
  (opt) => opt.id !== 'piper' || isPiperAvailable(),
)
