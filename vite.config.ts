import path from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

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
  plugins: [
    react(),
    tailwindcss(),
    dropBundledWasmAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Audiobook',
        short_name: 'Audiobook',
        description: 'Turn PDFs into audiobooks in your browser',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
        globIgnores: ['**/ort/**', '**/kitten-model/**', '**/*.wasm'],
        runtimeCaching: [
          {
            urlPattern: /\/kitten-model\/manifest\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'kitten-manifest',
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 7 },
              networkTimeoutSeconds: 3,
            },
          },
        ],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/ort\//, /^\/kitten-model\//],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
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
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
  build: {
    target: 'esnext',
    // phonemizer (eSpeak WASM) lazy chunk is ~1.3 MiB — loaded only at synthesis time.
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/onnxruntime-web') || id.includes('node_modules/onnxruntime-common')) {
            return 'onnx'
          }
          if (id.includes('node_modules/phonemizer')) {
            return 'phonemizer'
          }
          if (id.includes('kitten-tts-js')) {
            return 'kitten-tts-js'
          }
          if (id.includes('/src/lib/tts/kitten') || id.includes('/src/lib/tts/npzLoader')) {
            return 'kitten-engine'
          }
          if (id.includes('pdfjs-dist')) {
            return 'pdfjs'
          }
          if (id.includes('tesseract.js')) {
            return 'ocr'
          }
        },
      },
    },
  },
  server: {
    host: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
})
