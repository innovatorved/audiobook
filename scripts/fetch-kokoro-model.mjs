import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const REMOTE_MODEL_PATH = 'onnx/model_quantized.onnx'
const MODEL_NAME = 'kokoro_v1_0_q8.onnx'
const VOICES_NAME = 'voices.npz'
const CONFIG_NAME = 'config.json'
const CHUNK_SIZE = 8 * 1024 * 1024

const CURATED_VOICES = [
  { label: 'Heart', id: 'af_heart' },
  { label: 'Bella', id: 'af_bella' },
  { label: 'Nova', id: 'af_nova' },
  { label: 'Michael', id: 'am_michael' },
  { label: 'Sky', id: 'af_sky' },
  { label: 'Adam', id: 'am_adam' },
  { label: 'Emma', id: 'bf_emma' },
  { label: 'George', id: 'bm_george' },
]

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'kokoro-model')
const manifestPath = path.join(outDir, 'manifest.json')
const configPath = path.join(outDir, CONFIG_NAME)

function chunkFile(filename, buf) {
  if (buf.length > CHUNK_SIZE) {
    const parts = Math.ceil(buf.length / CHUNK_SIZE)
    for (let i = 0; i < parts; i++) {
      const chunk = buf.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
      writeFileSync(path.join(outDir, `${filename}.part${i}`), chunk)
    }
    return { size: buf.length, parts }
  }
  writeFileSync(path.join(outDir, filename), buf)
  return { size: buf.length, parts: 1 }
}

function verifyManifestEntry(file, meta) {
  const parts = Number(meta.parts)
  const size = Number(meta.size)
  if (!Number.isFinite(parts) || !Number.isFinite(size) || parts < 1) return false
  if (parts === 1) {
    const filePath = path.join(outDir, file)
    return existsSync(filePath) && statSync(filePath).size === size
  }
  let total = 0
  for (let i = 0; i < parts; i++) {
    const chunkPath = path.join(outDir, `${file}.part${i}`)
    if (!existsSync(chunkPath)) return false
    total += statSync(chunkPath).size
  }
  return total === size
}

function modelFilesReady() {
  if (!existsSync(manifestPath) || !existsSync(configPath)) return false
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!manifest.files?.[MODEL_NAME] || !manifest.files?.[VOICES_NAME]) return false
    for (const [file, meta] of Object.entries(manifest.files ?? {})) {
      if (!verifyManifestEntry(file, meta)) return false
    }
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    return config.model_file === MODEL_NAME && config.model_type === 'kokoro'
  } catch {
    return false
  }
}

/** Wrap a raw little-endian float32 voice buffer into a standard .npy v1.0 file. */
function wrapFloat32AsNpy(rawBytes) {
  const styleDim = 256
  const totalFloats = Math.floor(rawBytes.byteLength / 4)
  const rows = Math.floor(totalFloats / styleDim)
  const trimmedBytes = rawBytes.subarray(0, rows * styleDim * 4)

  const magic = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x01, 0x00])
  let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${rows}, ${styleDim}), }`
  const preambleLen = 10 // 8 magic/version + 2 uint16 header_len
  const padLen = (16 - ((preambleLen + header.length + 1) % 16)) % 16
  header += ' '.repeat(padLen) + '\n'

  const headerBuf = Buffer.from(header, 'ascii')
  const lenBuf = Buffer.alloc(2)
  lenBuf.writeUInt16LE(headerBuf.length, 0)
  return Buffer.concat([magic, lenBuf, headerBuf, trimmedBytes])
}

async function fetchHfFile(remotePath) {
  const url = `https://huggingface.co/${REPO}/resolve/main/${remotePath}`
  console.log(`[kokoro-model] fetching ${remotePath}…`)
  const resp = await fetch(url, { redirect: 'follow' })
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${remotePath}: HTTP ${resp.status}`)
  }
  return Buffer.from(await resp.arrayBuffer())
}

if (modelFilesReady()) {
  console.log('[kokoro-model] Bundle present and verified, skipping download')
  process.exit(0)
}

if (process.env.CF_PAGES === '1' || process.env.CF_PAGES === 'true' || process.env.CI) {
  throw new Error(
    '[kokoro-model] Running in CI / Cloudflare Pages but voice model files are missing or incomplete. Ensure public/kokoro-model is committed to git.',
  )
}

if (existsSync(outDir)) {
  for (const name of readdirSync(outDir)) rmSync(path.join(outDir, name), { force: true })
} else {
  mkdirSync(outDir, { recursive: true })
}

const manifest = { repo: REPO, files: {} }

// 1. Build config.json
const voiceAliases = Object.fromEntries(CURATED_VOICES.map((v) => [v.label, v.id]))
const configObj = {
  model_type: 'kokoro',
  model_file: MODEL_NAME,
  sample_rate: 24000,
  voice_aliases: voiceAliases,
  speed_priors: {},
}
const configBuf = Buffer.from(`${JSON.stringify(configObj, null, 2)}\n`, 'utf8')
manifest.files[CONFIG_NAME] = chunkFile(CONFIG_NAME, configBuf)

// 2. Fetch curated voices and pack into uncompressed voices.npz
const npzEntries = {}
for (const voice of CURATED_VOICES) {
  const rawBin = await fetchHfFile(`voices/${voice.id}.bin`)
  npzEntries[`${voice.id}.npy`] = new Uint8Array(wrapFloat32AsNpy(rawBin))
}
const npzBuf = Buffer.from(zipSync(npzEntries, { level: 0 }))
manifest.files[VOICES_NAME] = chunkFile(VOICES_NAME, npzBuf)
console.log(`[kokoro-model]   ${VOICES_NAME} = ${(npzBuf.length / 1024 / 1024).toFixed(2)} MiB (${CURATED_VOICES.length} voices)`)

// 3. Fetch Kokoro-82M quantized ONNX and split into 8 MiB chunks for Cloudflare Pages
const modelBuf = await fetchHfFile(REMOTE_MODEL_PATH)
manifest.files[MODEL_NAME] = chunkFile(MODEL_NAME, modelBuf)
console.log(
  `[kokoro-model]   ${MODEL_NAME} = ${(modelBuf.length / 1024 / 1024).toFixed(2)} MiB -> ${manifest.files[MODEL_NAME].parts} parts (<= 8 MiB each)`,
)

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log('[kokoro-model] done')
