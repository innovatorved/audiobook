# Audiobook

Turn PDFs into spoken audio in your browser. Words highlight as they are read. No server, no API keys.

**Live:** https://audiobook.vedgupta.in/

## What it does

- Upload PDFs and keep them in your library
- Listen with AI voices (Kitten or Piper)
- See the current word and sentence highlighted on the page
- Tap or click any paragraph to start reading from there
- Pick up where you left off — progress is saved automatically
- Read scanned PDFs with built-in OCR

## Run locally

```bash
bun install
bun run dev
```

Open http://localhost:5173, upload a PDF, and press play.

## Build

```bash
bun run build
bun run preview
```

## Shortcuts

| Key | Action |
|-----|--------|
| Space | Play / pause |
| ← / → | Previous / next sentence |
| ↑ / ↓ | Speed up / down |
