import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/piper-tts-web/dist/onnx', dest: '.' },
        { src: 'node_modules/piper-tts-web/dist/piper', dest: '.' },
        { src: 'node_modules/piper-tts-web/dist/worker', dest: '.' },
      ],
    }),
  ],
  resolve: {
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
  assetsInclude: ['**/*.onnx'],
  optimizeDeps: {
    include: ['fflate', 'onnxruntime-web'],
    exclude: ['@huggingface/transformers', 'kokoro-js', 'kitten-tts-js'],
  },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
