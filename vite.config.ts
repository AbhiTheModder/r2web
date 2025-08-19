import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: ['@wasmer/sdk']
  },
  build: {
    rollupOptions: {
      output: {
  entryFileNames: 'index.mjs',
  chunkFileNames: '[name].js',
  assetFileNames: '[name].[ext]',
},
    },
  },
})
