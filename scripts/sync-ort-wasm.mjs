import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'node_modules/onnxruntime-web/dist')
const destDir = path.join(root, 'public/ort')
const CHUNK_SIZE = 8 * 1024 * 1024

mkdirSync(destDir, { recursive: true })
for (const name of readdirSync(destDir)) {
  rmSync(path.join(destDir, name), { force: true })
}

const mjsFile = 'ort-wasm-simd-threaded.jsep.mjs'
const wasmFile = 'ort-wasm-simd-threaded.jsep.wasm'
const wasmSrcPath = path.join(srcDir, wasmFile)
const mjsSrcPath = path.join(srcDir, mjsFile)

if (!existsSync(wasmSrcPath) || !existsSync(mjsSrcPath)) {
  throw new Error('Missing onnxruntime-web JSEP WebGPU/WASM runtime artifacts in node_modules')
}

cpSync(mjsSrcPath, path.join(destDir, mjsFile))

const wasmBuf = readFileSync(wasmSrcPath)
const parts = Math.ceil(wasmBuf.length / CHUNK_SIZE)
for (let i = 0; i < parts; i++) {
  const chunk = wasmBuf.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
  writeFileSync(path.join(destDir, `${wasmFile}.part${i}`), chunk)
}

const manifest = {
  mjs: mjsFile,
  wasm: wasmFile,
  size: wasmBuf.length,
  parts,
  chunkSize: CHUNK_SIZE,
}
writeFileSync(path.join(destDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(
  `Synced ORT WebGPU/WASM runtime to public/ort/ (${(wasmBuf.length / 1024 / 1024).toFixed(2)} MiB -> ${parts} parts <= 8 MiB)`,
)
