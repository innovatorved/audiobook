/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PIPER_AVAILABLE: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*?url' {
  const src: string
  export default src
}

declare module '*?worker' {
  const WorkerConstructor: {
    new (): Worker
  }
  export default WorkerConstructor
}
