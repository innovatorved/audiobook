/**
 * Browser-safe NPZ loader (replaces kitten-tts-js/npz-loader.js + jszip).
 * NPZ files are ZIP archives of .npy arrays.
 */
import { unzip } from 'fflate'

const MAGIC = '\x93NUMPY'

function parseNpy(buf: ArrayBuffer): {
  data: Float32Array
  shape: number[]
  dtype: string
} {
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < 6; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) {
      throw new Error('Not a valid .npy file (bad magic)')
    }
  }

  const majorVersion = bytes[6]
  const headerLen =
    majorVersion >= 2
      ? new DataView(buf, 8, 4).getUint32(0, true)
      : new DataView(buf, 8, 2).getUint16(0, true)
  const headerOffset = majorVersion >= 2 ? 12 : 10
  const headerBytes = bytes.slice(headerOffset, headerOffset + headerLen)
  const header = new TextDecoder().decode(headerBytes).trim()

  const descrMatch = header.match(/'descr'\s*:\s*'([^']+)'/)
  const shapeMatch = header.match(/'shape'\s*:\s*\(([^)]*)\)/)
  const fortranMatch = header.match(/'fortran_order'\s*:\s*(True|False)/)

  if (!descrMatch || !shapeMatch) {
    throw new Error(`Cannot parse .npy header: ${header}`)
  }

  const descr = descrMatch[1]
  const shapeStr = shapeMatch[1].trim()
  const shape =
    shapeStr === ''
      ? [1]
      : shapeStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map(Number)
  const fortranOrder = fortranMatch ? fortranMatch[1] === 'True' : false

  const dataOffset = headerOffset + headerLen
  const dataBuffer = buf.slice(dataOffset)
  const dtype = descr.replace(/[<>|=]/, '')

  let data: Float32Array | Int32Array | Uint8Array
  switch (dtype) {
    case 'f4':
      data = new Float32Array(dataBuffer)
      break
    case 'f8': {
      const f64 = new Float64Array(dataBuffer)
      data = new Float32Array(f64.length)
      for (let i = 0; i < f64.length; i++) data[i] = f64[i]
      break
    }
    case 'i4':
      data = new Int32Array(dataBuffer)
      break
    case 'i8': {
      const i64 = new BigInt64Array(dataBuffer)
      data = new Float32Array(i64.length)
      for (let i = 0; i < i64.length; i++) data[i] = Number(i64[i])
      break
    }
    case 'u1':
      data = new Uint8Array(dataBuffer)
      break
    default:
      throw new Error(`Unsupported .npy dtype: ${descr}`)
  }

  let floatData = data instanceof Float32Array ? data : new Float32Array(data)

  if (fortranOrder && shape.length === 2) {
    const [rows, cols] = shape
    const cOrder = new Float32Array(rows * cols)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cOrder[r * cols + c] = floatData[c * rows + r]
      }
    }
    floatData = cOrder
  }

  return { data: floatData, shape, dtype }
}

async function unzipAsync(buffer: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(new Uint8Array(buffer), (err, data) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
}

export async function loadNpz(
  npzBuffer: ArrayBuffer,
): Promise<Record<string, { data: Float32Array; shape: number[] }>> {
  const zip = await unzipAsync(npzBuffer)
  const result: Record<string, { data: Float32Array; shape: number[] }> = {}

  for (const [name, bytes] of Object.entries(zip)) {
    if (!name.endsWith('.npy')) continue
    const key = name.replace(/\.npy$/, '')
    const parsed = parseNpy(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    result[key] = parsed
  }

  return result
}
