import { execSync } from 'node:child_process'

export function isCloudflarePages() {
  return (
    process.env.CF_PAGES === '1' ||
    process.env.CF_PAGES === 'true' ||
    Boolean(process.env.CF_PAGES_BRANCH) ||
    Boolean(process.env.CF_PAGES_COMMIT_SHA)
  )
}

const cfPages = isCloudflarePages()
const env = { ...process.env, CF_PAGES: cfPages ? '1' : process.env.CF_PAGES ?? '' }

console.log('[build] Fetching voice model (ORT conversion requires Python 3)…')
execSync('node scripts/fetch-kitten-model.mjs', { stdio: 'inherit', env })

if (cfPages) {
  console.log('[build] Cloudflare Pages detected — using size-limited build')
  execSync('npx vite build', { stdio: 'inherit', env })
  execSync('node scripts/prune-dist-for-pages.mjs', { stdio: 'inherit', env })
} else {
  console.log('[build] Local build — full engine support')
  try {
    execSync('bunx --bun vite build', { stdio: 'inherit', env })
  } catch {
    execSync('npx vite build', { stdio: 'inherit', env })
  }
}
