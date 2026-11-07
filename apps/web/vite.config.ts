import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// FND-12: minimal wiring for the gallery. FND-13 adds the router plugin and the /api + /mock dev proxy.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true },
  preview: { host: true },
})
