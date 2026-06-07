import { cpSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = path.join(root, 'node_modules/piper-tts-web/dist')

const copies = [
  { src: 'onnx', dest: 'public/onnx' },
  { src: 'piper', dest: 'public/piper' },
  { src: 'worker', dest: 'public/worker' },
]

for (const { src, dest } of copies) {
  const destDir = path.join(root, dest)
  mkdirSync(destDir, { recursive: true })
  cpSync(path.join(srcRoot, src), destDir, { recursive: true })
}

console.log(`Synced Piper assets to public/ (${copies.map((c) => c.dest).join(', ')})`)
