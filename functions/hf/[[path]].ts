/**
 * Same-origin proxy for Hugging Face model files.
 *
 * Why this exists: huggingface.co redirects model downloads to
 * cas-bridge.xethub.hf.co (CloudFront), which doesn't echo the caller's Origin
 * in CORS headers. Combined with the site's COEP, the browser kills the fetch
 * mid-stream (visible as "stuck at 60%"). Proxying through a Pages Function
 * makes the download same-origin, so CORS/CORP/COEP never apply.
 *
 * Routes: /hf/<repoId>/resolve/main/<file>
 *   e.g. /hf/KittenML/kitten-tts-micro-0.8/resolve/main/voices.npz
 */

interface Env {}

export const onRequestGet: PagesFunction<Env> = async ({ request, params }) => {
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean)
  if (segments.length === 0) {
    return new Response('Missing path', { status: 400 })
  }

  const upstream = `https://huggingface.co/${segments.join('/')}`

  const incoming = new Headers()
  const range = request.headers.get('range')
  if (range) incoming.set('range', range)
  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch) incoming.set('if-none-match', ifNoneMatch)
  incoming.set('user-agent', 'audiobook-pages-proxy/1.0')

  let upstreamResp: Response
  try {
    upstreamResp = await fetch(upstream, {
      method: 'GET',
      headers: incoming,
      redirect: 'follow',
      cf: { cacheTtl: 60 * 60 * 24 * 7, cacheEverything: true },
    })
  } catch (err) {
    return new Response(
      `Upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 },
    )
  }

  const out = new Headers()
  const passthrough = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
  ]
  for (const key of passthrough) {
    const v = upstreamResp.headers.get(key)
    if (v) out.set(key, v)
  }
  out.set('cache-control', 'public, max-age=31536000, immutable')
  out.set('cross-origin-resource-policy', 'same-origin')
  out.set('access-control-allow-origin', '*')

  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers: out,
  })
}
