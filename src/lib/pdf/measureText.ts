const PDF_FONT_FAMILY = 'serif'

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null

function getMeasureContext(): CanvasRenderingContext2D {
  if (!ctx) {
    canvas = document.createElement('canvas')
    ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable for text measurement')
    }
  }
  return ctx
}

export function measureTextWidth(
  text: string,
  fontSize: number,
  fontFamily = PDF_FONT_FAMILY,
): number {
  if (!text || fontSize <= 0) return 0

  const context = getMeasureContext()
  context.font = `${fontSize}px ${fontFamily}`
  return context.measureText(text).width
}
