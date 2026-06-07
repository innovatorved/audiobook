/** Survives PdfPage remounts so virtualizer scroll does not re-render canvases. */
const rendered = new Map<number, { width: number; height: number }>()

export function getCachedPageSize(pageNum: number): { width: number; height: number } | undefined {
  return rendered.get(pageNum)
}

export function setCachedPageSize(pageNum: number, width: number, height: number): void {
  rendered.set(pageNum, { width, height })
}

export function clearPageCanvasCache(): void {
  rendered.clear()
}
