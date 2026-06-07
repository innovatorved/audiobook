import type { VoiceInfo } from '@/lib/types'

export const PIPER_DEFAULT_VOICE = 'en_US-lessac-medium'

/** Curated en_US voices — avoids fetching the full Hugging Face catalog on every load. */
export const PIPER_VOICES: VoiceInfo[] = [
  { id: 'en_US-lessac-medium', label: 'lessac medium' },
  { id: 'en_US-lessac-low', label: 'lessac low' },
  { id: 'en_US-amy-medium', label: 'amy medium' },
  { id: 'en_US-amy-low', label: 'amy low' },
  { id: 'en_US-arctic-medium', label: 'arctic medium' },
  { id: 'en_US-bryce-medium', label: 'bryce medium' },
  { id: 'en_US-danny-low', label: 'danny low' },
  { id: 'en_US-hfc_female-medium', label: 'hfc female medium' },
  { id: 'en_US-hfc_male-medium', label: 'hfc male medium' },
  { id: 'en_US-joe-medium', label: 'joe medium' },
  { id: 'en_US-john-medium', label: 'john medium' },
  { id: 'en_US-kathleen-low', label: 'kathleen low' },
  { id: 'en_US-kristin-medium', label: 'kristin medium' },
  { id: 'en_US-ljspeech-medium', label: 'ljspeech medium' },
  { id: 'en_US-norman-medium', label: 'norman medium' },
  { id: 'en_US-ryan-medium', label: 'ryan medium' },
]
