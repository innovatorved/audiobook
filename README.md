# Audiobook

Turn PDFs into audiobooks in your browser. Upload a PDF, listen to it, and follow along with highlighting.

**Live:** https://audiobook.vedgupta.in/

## What it does

- Upload PDFs and keep them in your library
- Listen with the offline neural voice or your browser voice
- Follow word and sentence highlighting while listening
- Click text to start reading from that point
- Resume where you left off
- Read scanned PDFs with OCR
- Works locally in the browser without API keys

## Run locally

```bash
bun install
bun run dev
```

Open http://localhost:5173, upload a PDF, and press play.

## Build

Requires **Python 3** (used only at build time). The build script creates a local `.venv`, installs `onnxruntime`, and converts the voice model to ORT format for fast in-browser loading.

```bash
bun run build
bun run preview
```

On **Cloudflare Pages**, the same build step runs during deploy; ensure the Pages build image includes Python 3 (default Node images do). If conversion fails, run `node scripts/fetch-kitten-model.mjs` locally and redeploy.

## Shortcuts

| Key | Action |
|-----|--------|
| Space | Play / pause |
| ← / → | Previous / next sentence |
| ↑ / ↓ | Speed up / down |

## Contact

vedgupta@protonmail.com
