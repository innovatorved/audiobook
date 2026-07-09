/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

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
