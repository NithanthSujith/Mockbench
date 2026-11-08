import { defineConfig } from 'vitest/config'

const include = ['src/**/*.test.ts', 'test/**/*.test.ts']

// The same test files run twice: under Node and under happy-dom (a browser-like global scope), so
// every golden is proven byte-identical in both (FND-05). `test:update-goldens` runs the node project only.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      { extends: true, test: { name: 'node', environment: 'node', include } },
      { extends: true, test: { name: 'browser-env', environment: 'happy-dom', include } },
    ],
  },
})
