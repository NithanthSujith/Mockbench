// Standalone Playwright config for the LAN check (FND-14). Run it against a running compose stack:
//   LAN_PORT=8080 pnpm --filter @mockbench/web exec playwright test --config ../../e2e/playwright.lan.config.ts
// (scripts/lan-smoke.sh playwright does exactly that). XC-01 later adds the full product-loop suite here.
//
// @playwright/test is installed under apps/web, so it is imported by relative path: that resolves to
// the same installed copy the runner uses (a second copy would make Playwright refuse to run).
import { defineConfig } from '../apps/web/node_modules/@playwright/test/index.mjs'

const port = process.env.LAN_PORT ?? '8080'
export const LAN_HOST = 'mockbench.lan.test'

export default defineConfig({
  testDir: '.',
  testMatch: 'lan.spec.ts',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://${LAN_HOST}:${port}`,
    // Maps a name that exists nowhere in DNS to this machine, so the page is genuinely loaded from a
    // non-localhost origin, the way a teammate's browser reaches the LAN host.
    launchOptions: { args: [`--host-resolver-rules=MAP ${LAN_HOST} 127.0.0.1`] },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
