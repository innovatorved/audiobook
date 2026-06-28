let phonemizeFn: ((text: string, language?: string) => Promise<string[] | null>) | null = null

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
  }
  return phonemizeFn
}

/** Lazy-load eSpeak phonemizer (~1.3 MiB) only when synthesis runs. */
export async function phonemize(text: string): Promise<string> {
  const espeakng = await loadPhonemizer()
  const punctuationPattern = new RegExp(`(\\s*[${escapeRegExp(PUNCTUATION)}]+\\s*)+`, 'g')
  const chunks = splitPreserve(text, punctuationPattern)

  let processed = ''
  for (const chunk of chunks) {
    if (chunk.isPunct) {
      processed += chunk.text
    } else {
      const result = await espeakng(chunk.text, 'en-us')
      const ipa = result ? result.join(' ') : ''
      processed += ipa.replace(/_/g, '').replace(/\n/g, ' ')
    }
  }

  return processed.trim()
}
