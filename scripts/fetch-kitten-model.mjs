import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'KittenML/kitten-tts-micro-0.8'
const ONNX_NAME = 'kitten_tts_micro_v0_8.onnx'
const ORT_NAME = 'kitten_tts_micro_v0_8.ort'
const STATIC_FILES = ['config.json', 'voices.npz']
const CHUNK_SIZE = 8 * 1024 * 1024

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'kitten-model')
const manifestPath = path.join(outDir, 'manifest.json')
const configPath = path.join(outDir, 'config.json')
const venvDir = path.join(root, '.venv')
const venvPython =
  process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python3')
const venvPip =
  process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'pip.exe')
    : path.join(venvDir, 'bin', 'pip')

function chunkFile(filename, buf) {
  const mib = (buf.length / 1024 / 1024).toFixed(2)
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
    if (!manifest.files?.[ORT_NAME]) return false
    for (const [file, meta] of Object.entries(manifest.files ?? {})) {
      if (!verifyManifestEntry(file, meta)) return false
    }
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    return config.model_file === ORT_NAME
  } catch {
    return false
  }
}

function findPython() {
  for (const cmd of ['python3', 'python']) {
    const result = spawnSync(cmd, ['--version'], { encoding: 'utf8' })
    if (result.status === 0) return cmd
  }
  return null
}

function ensurePythonWithOrt() {
  if (process.env.CF_PAGES === '1' || process.env.CF_PAGES === 'true' || process.env.CI) {
    throw new Error(
      '[kitten-model] Running in CI / Cloudflare Pages but voice model files are missing or incomplete. Ensure public/kitten-model is committed to git.',
    )
  }
  if (!existsSync(venvPython)) {
    console.log('[kitten-model] creating Python venv for ORT conversion…')
    const bootstrap = findPython()
    if (!bootstrap) {
      throw new Error('[kitten-model] Python 3 is required. Install Python 3 to build the voice model.')
    }
    execSync(`${bootstrap} -m venv ${JSON.stringify(venvDir)}`, { stdio: 'inherit', cwd: root })
    execSync(`${JSON.stringify(venvPip)} install onnxruntime onnx --quiet`, { stdio: 'inherit', cwd: root })
  } else {
    const check = spawnSync(venvPython, ['-c', 'import onnxruntime, onnx'], { encoding: 'utf8' })
    if (check.status !== 0) {
      execSync(`${JSON.stringify(venvPip)} install onnxruntime onnx --quiet`, { stdio: 'inherit', cwd: root })
    }
  }
  return venvPython
}

function convertOnnxToOrt(onnxPath, ortPath) {
  const python = ensurePythonWithOrt()

  console.log(`[kitten-model] converting ${ONNX_NAME} -> ${ORT_NAME}`)
  execSync(
    `${JSON.stringify(python)} -m onnxruntime.tools.convert_onnx_models_to_ort ${JSON.stringify(onnxPath)} --optimization_style Fixed`,
    { stdio: 'inherit', cwd: outDir },
  )

  if (!existsSync(ortPath)) {
    throw new Error(`[kitten-model] ORT conversion failed — ${ORT_NAME} not created`)
  }
}

function updateConfigBuffer(buf) {
  const config = JSON.parse(buf.toString('utf8'))
  config.model_file = ORT_NAME
  return Buffer.from(`${JSON.stringify(config, null, 2)}\n`)
}

function updateConfigModelFile() {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.model_file = ORT_NAME
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

if (modelFilesReady()) {
  console.log('[kitten-model] ORT bundle present, skipping download')
  process.exit(0)
}

if (existsSync(outDir)) {
  for (const name of readdirSync(outDir)) rmSync(path.join(outDir, name), { force: true })
} else {
  mkdirSync(outDir, { recursive: true })
}

const manifest = { repo: REPO, files: {} }

async function fetchFile(file) {
  const url = `https://huggingface.co/${REPO}/resolve/main/${file}`
  console.log(`[kitten-model] fetching ${file}`)
  const resp = await fetch(url, { redirect: 'follow' })
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${file}: HTTP ${resp.status}`)
  }
  return Buffer.from(await resp.arrayBuffer())
}

for (const file of STATIC_FILES) {
  let buf = await fetchFile(file)
  if (file === 'config.json') {
    buf = updateConfigBuffer(buf)
  }
  manifest.files[file] = chunkFile(file, buf)
  console.log(
    `[kitten-model]   ${file} = ${(buf.length / 1024 / 1024).toFixed(2)} MiB` +
      (manifest.files[file].parts > 1 ? ` -> ${manifest.files[file].parts} parts` : ''),
  )
}

const onnxBuf = await fetchFile(ONNX_NAME)
const onnxPath = path.join(outDir, ONNX_NAME)
writeFileSync(onnxPath, onnxBuf)
console.log(`[kitten-model]   ${ONNX_NAME} = ${(onnxBuf.length / 1024 / 1024).toFixed(2)} MiB (build-only)`)

const ortPath = path.join(outDir, ORT_NAME)
convertOnnxToOrt(onnxPath, ortPath)
rmSync(onnxPath, { force: true })

const ortBuf = readFileSync(ortPath)
manifest.files[ORT_NAME] = chunkFile(ORT_NAME, ortBuf)
rmSync(ortPath, { force: true })
console.log(
  `[kitten-model]   ${ORT_NAME} = ${(ortBuf.length / 1024 / 1024).toFixed(2)} MiB -> ${manifest.files[ORT_NAME].parts} parts`,
)

updateConfigModelFile()
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log('[kitten-model] done')
