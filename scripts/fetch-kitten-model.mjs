import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'KittenML/kitten-tts-micro-0.8'
const FILES = ['config.json', 'kitten_tts_micro_v0_8.onnx', 'voices.npz']
const CHUNK_SIZE = 22 * 1024 * 1024

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'kitten-model')
const manifestPath = path.join(outDir, 'manifest.json')

function modelFilesReady() {
  if (!existsSync(manifestPath)) return false
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    for (const [file, meta] of Object.entries(manifest.files ?? {})) {
      const parts = Number(meta.parts)
      const size = Number(meta.size)
      if (!Number.isFinite(parts) || !Number.isFinite(size) || parts < 1) return false
      if (parts === 1) {
        if (!existsSync(path.join(outDir, file))) return false
        if (statSync(path.join(outDir, file)).size !== size) return false
        continue
      }
      let total = 0
      for (let i = 0; i < parts; i++) {
        const chunkPath = path.join(outDir, `${file}.part${i}`)
        if (!existsSync(chunkPath)) return false
        total += statSync(chunkPath).size
      }
      if (total !== size) return false
    }
    return true
  } catch {
    return false
  }
}

if (modelFilesReady()) {
  console.log('[kitten-model] files present, skipping download')
  process.exit(0)
}

if (existsSync(outDir)) {
  for (const name of readdirSync(outDir)) rmSync(path.join(outDir, name), { force: true })
} else {
  mkdirSync(outDir, { recursive: true })
}

const manifest = { repo: REPO, files: {} }

for (const file of FILES) {
  const url = `https://huggingface.co/${REPO}/resolve/main/${file}`
  console.log(`[kitten-model] fetching ${file}`)
  const resp = await fetch(url, { redirect: 'follow' })
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${file}: HTTP ${resp.status}`)
  }
  const buf = Buffer.from(await resp.arrayBuffer())
  const mib = (buf.length / 1024 / 1024).toFixed(2)

  if (buf.length > CHUNK_SIZE) {
    const parts = Math.ceil(buf.length / CHUNK_SIZE)
    for (let i = 0; i < parts; i++) {
      const chunk = buf.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
      writeFileSync(path.join(outDir, `${file}.part${i}`), chunk)
    }
    manifest.files[file] = { size: buf.length, parts }
    console.log(`[kitten-model]   ${file} = ${mib} MiB -> ${parts} parts`)
  } else {
    writeFileSync(path.join(outDir, file), buf)
    manifest.files[file] = { size: buf.length, parts: 1 }
    console.log(`[kitten-model]   ${file} = ${mib} MiB`)
  }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log('[kitten-model] done')
