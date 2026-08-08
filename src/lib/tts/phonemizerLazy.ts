type PhonemizeFunction = (text: string, language?: string) => Promise<string[] | null>
type ListVoicesFunction = (language?: string) => Promise<Array<{ name: string; identifier: string; languages: Array<{ priority: number; name: string }> }>>

let phonemizeFn: PhonemizeFunction | null = null
let listVoicesFn: ListVoicesFunction | null = null
let resolvedLang: string | null = null

const PUNCTUATION = ';:,.!?\u00A1\u00BF\u2014\u2026\u0022\u00AB\u00BB\u0022\u0022(){}[]'

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitPreserve(text: string, regex: RegExp): Array<{ isPunct: boolean; text: string }> {
  const result: Array<{ isPunct: boolean; text: string }> = []
  let prev = 0
  for (const match of text.matchAll(regex)) {
    const fullMatch = match[0]
    if (prev < match.index!) {
      result.push({ isPunct: false, text: text.slice(prev, match.index) })
    }
    if (fullMatch.length > 0) {
      result.push({ isPunct: true, text: fullMatch })
    }
    prev = match.index! + fullMatch.length
  }
  if (prev < text.length) {
    result.push({ isPunct: false, text: text.slice(prev) })
  }
  return result
}

async function loadPhonemizer() {
  if (!phonemizeFn) {
    const mod = await import('phonemizer')
    phonemizeFn = mod.phonemize
    listVoicesFn = mod.list_voices
  }
  return { phonemize: phonemizeFn, listVoices: listVoicesFn }
}

async function getBestLanguageIdentifier(): Promise<string> {
  if (resolvedLang) return resolvedLang
  try {
    const { listVoices } = await loadPhonemizer()
    if (listVoices) {
      const voices = await listVoices()
      const ids = new Set<string>()
      for (const voice of voices) {
        if (voice.identifier) ids.add(voice.identifier)
        for (const lang of voice.languages ?? []) {
          if (lang.name) ids.add(lang.name)
        }
      }
      if (ids.has('en-us')) {
        resolvedLang = 'en-us'
        return resolvedLang
      }
      if (ids.has('en')) {
        resolvedLang = 'en'
        return resolvedLang
      }
      if (ids.has('gmw/en-US')) {
        resolvedLang = 'gmw/en-US'
        return resolvedLang
      }
      const first = Array.from(ids)[0]
      if (first) {
        resolvedLang = first
        return resolvedLang
      }
    }
  } catch (err) {
    console.warn('[phonemizer] Could not resolve language voice list:', err)
  }
  resolvedLang = 'en-us'
  return resolvedLang
}

/** Lazy-load eSpeak phonemizer (~1.3 MiB) only when synthesis runs. */
export async function phonemize(text: string): Promise<string> {
  try {
    const { phonemize: espeakng } = await loadPhonemizer()
    const targetLang = await getBestLanguageIdentifier()
    const punctuationPattern = new RegExp(`(\\s*[${escapeRegExp(PUNCTUATION)}]+\\s*)+`, 'g')
    const chunks = splitPreserve(text, punctuationPattern)

    let processed = ''
    for (const chunk of chunks) {
      if (chunk.isPunct) {
        processed += chunk.text
      } else {
        let result: string[] | null = null
        try {
          result = await espeakng(chunk.text, targetLang)
        } catch (err) {
          console.warn(`[phonemizer] eSpeak failed for lang "${targetLang}", attempting fallback:`, err)
          try {
            result = await espeakng(chunk.text, 'en')
          } catch {
            result = null
          }
        }
        const ipa = result ? result.join(' ') : chunk.text
        processed += ipa.replace(/_/g, '').replace(/\n/g, ' ')
      }
    }

    return processed.trim()
  } catch (err) {
    console.warn('[phonemizer] Global phonemizer error, returning original text:', err)
    return text.trim()
  }
}
