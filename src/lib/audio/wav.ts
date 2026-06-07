export function decodeWavToFloat32(wavBuffer: ArrayBuffer): {
  pcm: Float32Array
  sampleRate: number
} {
  const view = new DataView(wavBuffer)
  const sampleRate = view.getUint32(24, true)
  const bitsPerSample = view.getUint16(34, true)
  const numChannels = view.getUint16(22, true)

  let offset = 12
  while (offset < view.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    )
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 'data') {
      offset += 8
      const dataLength = chunkSize
      if (bitsPerSample === 16) {
        const samples = dataLength / 2 / numChannels
        const pcm = new Float32Array(samples)
        for (let i = 0; i < samples; i++) {
          let sum = 0
          for (let ch = 0; ch < numChannels; ch++) {
            const sample = view.getInt16(offset + (i * numChannels + ch) * 2, true)
            sum += sample / 32768
          }
          pcm[i] = sum / numChannels
        }
        return { pcm, sampleRate }
      }
      break
    }
    offset += 8 + chunkSize
  }

  return { pcm: new Float32Array(0), sampleRate: 22050 }
}
