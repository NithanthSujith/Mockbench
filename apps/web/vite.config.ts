import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Where `vite` and `vite preview` forward /api and /mock. The web container's nginx does this in
// production (FND-14); this is only for development on a machine that runs the api on the host.
// This is the ONLY file allowed to contain a loopback address (lint rule 2, FND-01).
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000'
const proxy = {
  // Anchored regexes: a plain '/mock' key would also swallow /mockServiceWorker.js.
  '^/api(/|$)': { target: API_PROXY_TARGET, changeOrigin: false },
  '^/mock(/|$)': { target: API_PROXY_TARGET, changeOrigin: false },
}

export default defineConfig(({ mode }) => ({
  plugins: [
    // Generates src/routeTree.gen.ts (committed) from src/routes. Must come before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  // The MSW service-worker file is generated into node_modules/.mockbench/mock-public by `msw init` (see dev:mock) and served ONLY in mock mode, so it can
  // never end up in a production build (there is no public dir at all in normal modes).
  publicDir: mode === 'mock' ? 'node_modules/.mockbench/mock-public' : false,
  server: { host: true, proxy },
  preview: { host: true, proxy },
}))
