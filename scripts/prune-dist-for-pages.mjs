import { readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')
const maxBytes = 24 * 1024 * 1024

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const filePath = path.join(dir, name)
    const stat = statSync(filePath)
    if (stat.isDirectory()) {
      walk(filePath)
      continue
    }
    if (stat.size > maxBytes) {
      console.warn(`Removing ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)} MiB) — exceeds Cloudflare Pages limit`)
      rmSync(filePath)
    }
  }
}

walk(distDir)
console.log('Dist pruned for Cloudflare Pages')
