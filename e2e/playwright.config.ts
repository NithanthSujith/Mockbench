// Full product-loop suite (XC-01). `pnpm e2e` (e2e/run.sh) brings the compose stack up, runs this
// config, and tears the stack down. E2E_STACK selects the run: "loop" (SEED_DEMO=false, the default)
// or "seed" (SEED_DEMO=true, a separate fresh stack).
import { defineConfig } from '../apps/web/node_modules/@playwright/test/index.mjs'
import { LAN_HOST, ORIGIN } from './support/lan'

const seed = process.env.E2E_STACK === 'seed'

export default defineConfig({
  testDir: '.',
  testMatch: seed ? '**/seed.spec.ts' : '**/*.spec.ts',
  testIgnore: seed ? [] : ['**/seed.spec.ts', '**/lan.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
    launchOptions: { args: [`--host-resolver-rules=MAP *${LAN_HOST} 127.0.0.1`] },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
