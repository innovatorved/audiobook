/** Stub — model download is handled by kittenDownload.ts on the main thread. */
export async function downloadModel(): Promise<never> {
  throw new Error('downloadModel is not available in the browser — use kittenDownload.ts')
}

export const MODELS: Record<string, string> = {}
