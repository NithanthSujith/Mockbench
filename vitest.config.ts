import { defineConfig } from 'vitest/config'

// Root tests: repo tooling (lint rules, ownership check). Package tests run via `pnpm -r test`.
export default defineConfig({
  test: { include: ['tooling/**/*.test.ts', 'scripts/**/*.test.ts'], environment: 'node' },
})
