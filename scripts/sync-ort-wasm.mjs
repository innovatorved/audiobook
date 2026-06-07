import { cpSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'node_modules/onnxruntime-web/dist')
const destDir = path.join(root, 'public/ort')

// Cloudflare Pages limits static files to 25 MiB. Use the 12 MiB threaded build only (no JSEP).
const files = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']

mkdirSync(destDir, { recursive: true })
for (const file of files) {
  cpSync(path.join(srcDir, file), path.join(destDir, file))
}

console.log(`Synced ${files.length} onnxruntime-web wasm files to public/ort/`)
