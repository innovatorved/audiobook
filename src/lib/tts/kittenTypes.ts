export type CompileStage = 'ort-init' | 'compiling' | 'voices' | 'ready'

export const COMPILE_STAGE_LABELS: Record<CompileStage, string> = {
  'ort-init': 'Loading ONNX runtime…',
  compiling: 'Compiling voice model…',
  voices: 'Loading voices…',
  ready: 'Voice engine ready',
}
