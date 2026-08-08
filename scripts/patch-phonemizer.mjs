import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const targetFile = path.join(root, 'node_modules/phonemizer/dist/phonemizer.js')

if (fs.existsSync(targetFile)) {
  let code = fs.readFileSync(targetFile, 'utf8')
  const target = 'e=new Blob([A]).stream().pipeThrough(new DecompressionStream("gzip")),C=[];for await(const A of e)C.push(A);const a=await new Blob(C).arrayBuffer();'
  const replacement = 'a=fflate.gunzipSync(A).buffer;'

  if (code.includes(target)) {
    code = 'import * as fflate from "fflate";\n' + code.replace(target, replacement)
    fs.writeFileSync(targetFile, code, 'utf8')
    console.log('[patch] Successfully patched phonemizer.js with fflate.gunzipSync!')
  }
}
