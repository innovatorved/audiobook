export type InferenceDevice = 'webgpu' | 'wasm'

export async function detectBestDevice(): Promise<InferenceDevice> {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const gpu = navigator.gpu as GPU
      const adapter = await gpu.requestAdapter()
      if (adapter) return 'webgpu'
    } catch {
      // fall through to wasm
    }
  }
  return 'wasm'
}
