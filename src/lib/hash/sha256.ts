function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Stable fingerprint for non-secure contexts (LAN HTTP dev, e.g. http://192.168.x.x).
 * Browsers only expose crypto.subtle on HTTPS and localhost.
 */
function fingerprintBuffer(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer)
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  const len = view.length
  const step = Math.max(1, Math.floor(len / 8192))

  for (let i = 0; i < len; i += step) {
    h1 = Math.imul(h1 ^ view[i], 0x01000193)
    h2 = Math.imul(h2 ^ view[i], 0x85ebca6b)
  }

  if (len > 0) {
    h1 ^= view[0] << 24
    h2 ^= view[len - 1] << 16
    if (len > 2) {
      h2 ^= view[Math.floor(len / 2)] << 8
    }
  }

  h1 ^= len
  h2 ^= len << 1

  const part = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return `${part(h1)}${part(h2)}${len.toString(16).padStart(8, '0')}`
}

export async function digestSha256(buffer: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    return toHex(hashBuffer)
  }
  return fingerprintBuffer(buffer)
}
