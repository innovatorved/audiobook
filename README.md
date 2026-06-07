# Audiobook — Client-Side PDF-to-Speech Reader

A fully client-side SPA that turns PDFs into spoken audio with real-time word highlighting. No backend, no API keys — everything runs in your browser.

## Features

- **PDF upload & library** — drag-drop PDFs, stored in IndexedDB (Dexie)
- **Virtualized PDF viewer** — smooth scrolling through long documents
- **Pluggable TTS engines** — Kitten Micro (default), Kokoro (premium), Piper (fast CPU)
- **Word-level highlight sync** — amber overlay follows speech in real time
- **OCR fallback** — Tesseract.js for scanned PDFs (lazy per-page)
- **Progress persistence** — resume reading where you left off
- **Keyboard shortcuts** — Space (play/pause), ←/→ (skip sentence), ↑/↓ (speed)

## Quick start

```bash
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173), upload a PDF, and press Play.

## Build

```bash
bun run build
bun run preview
```

## Tech stack

- React 19 + Vite 8 + Bun
- Tailwind CSS v4 + shadcn/ui
- react-router v7
- pdfjs-dist v6, kitten-tts-js, kokoro-js, piper-tts-web
- tesseract.js v7, dexie, zustand, @tanstack/react-virtual

## Deployment (Cloudflare Pages)

Cloudflare Pages rejects static files over **25 MiB**. Use the Pages build script:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 22.12+ |

The build script auto-detects Cloudflare Pages (`CF_PAGES_BRANCH`, etc.) and skips Piper assets over the 25 MiB limit. Headers and SPA routing are in `public/_headers` and `public/_redirects`.

```bash
npm run build          # auto-detects CF Pages in CI
npm run build:pages    # force Pages-safe build locally
npx wrangler pages deploy dist --project-name=audiobook
```

For other static hosts, run `npm run build` and serve `dist/` with these headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Known limitations

| Limitation | Notes |
|---|---|
| English only | Kitten/Kokoro/Piper English voices |
| ~43 MB default model | Kitten Micro downloads on first play; Kokoro/Piper lazy-loaded on switch |
| Estimated word sync | Char-weighted timing — good for most PDFs, not phoneme-level |
| Large scanned PDFs | Lazy OCR; warning shown if >50 pages |

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play / Pause |
| ← | Previous sentence |
| → | Next sentence |
| ↑ | Increase speed |
| ↓ | Decrease speed |
