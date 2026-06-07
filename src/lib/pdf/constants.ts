/** Shared scale for PDF render, text extraction, and highlight coordinates. */
export const PDF_RENDER_SCALE = 1.5

/** Vertical band for highlight rects — top-anchored, not full font box. */
export const HIGHLIGHT_HEIGHT_RATIO = 0.85

/** Display height multiplier in WordHighlight (top-anchored). */
export const HIGHLIGHT_DISPLAY_RATIO = 0.75

/** Trailing extend after last word on each sentence line. */
export const HIGHLIGHT_SENTENCE_RIGHT_EXTEND_PX = 20

/** Extend highlight further right — active word. */
export const HIGHLIGHT_ACTIVE_RIGHT_EXTEND_PX = 10

/** Inset padding around sentence highlight bars (px). */
export const HIGHLIGHT_SENTENCE_PAD_X = 6
export const HIGHLIGHT_SENTENCE_PAD_Y = 5

/** Inset padding around active word highlight (px). */
export const HIGHLIGHT_ACTIVE_PAD_X = 5
export const HIGHLIGHT_ACTIVE_PAD_Y = 4
