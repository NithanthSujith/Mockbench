import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Node before 22.15 lacks zlib.createZstdDecompress, which jsdom's undici reads at import time.
// The preload stub (test only) lets those Node 22.x versions start the jsdom test workers.
const nodeShim = new URL('./test-node-shim.mjs', import.meta.url).href

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    execArgv: ['--import', nodeShim],
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
})
