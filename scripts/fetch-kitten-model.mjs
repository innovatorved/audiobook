/**
 * Downloads the Kitten TTS model files from Hugging Face once at build time
 * and writes them into public/kitten-model/. Files larger than the Cloudflare
 * Pages 25 MiB per-file limit are split into chunks. A manifest.json describes
 * the layout so the browser can reassemble them.
 *
 * This eliminates runtime CORS/CORP/CDN-redirect issues by serving everything
 * same-origin from the deployed site.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'KittenML/kitten-tts-micro-0.8'
const FILES = ['config.json', 'kitten_tts_micro_v0_8.onnx', 'voices.npz']
const CHUNK_SIZE = 22 * 1024 * 1024

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'kitten-model')
const manifestPath = path.join(outDir, 'manifest.json')

if (existsSync(manifestPath)) {
  console.log('[kitten-model] manifest.json present, skipping download')
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
    console.log(`[kitten-model]   ${file} = ${mib} MiB → ${parts} parts`)
  } else {
    writeFileSync(path.join(outDir, file), buf)
    manifest.files[file] = { size: buf.length, parts: 1 }
    console.log(`[kitten-model]   ${file} = ${mib} MiB`)
  }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log('[kitten-model] done')
