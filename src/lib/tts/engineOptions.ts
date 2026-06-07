import type { TtsEngineType } from '@/lib/types'
import { isRecommendedEngine } from '@/lib/tts/recommended'

export const ENGINE_OPTIONS: Array<{
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
