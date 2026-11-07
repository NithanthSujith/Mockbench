import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // One pre-migrated template database per run (see src/db/vitest-global-setup.ts).
    globalSetup: ['./src/db/vitest-global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
