import path from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** ORT wasm is served from /ort/ — drop bundled copies (some exceed CF Pages 25 MiB limit). */
function dropBundledWasmAssets(): Plugin {
  return {
    name: 'drop-bundled-wasm-assets',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (fileName.endsWith('.wasm')) {
          delete bundle[fileName]
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dropBundledWasmAssets()],
  resolve: {
    conditions: ['onnxruntime-web-use-extern-wasm', 'import', 'module', 'browser', 'default'],
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: 'onnxruntime-node', replacement: path.resolve(__dirname, './src/lib/shims/empty.ts') },
      {
        find: /kitten-tts-js[/\\]src[/\\]npz-loader\.js$/,
        replacement: path.resolve(__dirname, './src/lib/tts/npzLoader.ts'),
      },
      {
        find: /kitten-tts-js[/\\]src[/\\]model-loader\.js$/,
        replacement: path.resolve(__dirname, './src/lib/tts/kittenModelLoaderStub.ts'),
      },
      {
        find: 'kitten-tts-js/src/text-cleaner.js',
        replacement: path.resolve(__dirname, 'node_modules/kitten-tts-js/src/text-cleaner.js'),
      },
      {
        find: 'kitten-tts-js/src/preprocess.js',
        replacement: path.resolve(__dirname, 'node_modules/kitten-tts-js/src/preprocess.js'),
      },
      {
        find: 'kitten-tts-js/src/phonemizer.js',
        replacement: path.resolve(__dirname, 'node_modules/kitten-tts-js/src/phonemizer.js'),
      },
    ],
  },
  optimizeDeps: {
    include: ['fflate', 'onnxruntime-web/wasm'],
    exclude: ['kitten-tts-js'],
  },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
