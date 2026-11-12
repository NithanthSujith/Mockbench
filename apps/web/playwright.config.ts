import { defineConfig } from '@playwright/test'

// Browser tests. Run with `pnpm --filter @mockbench/web test:e2e`. Three servers, three projects:
//   design   - Vite dev server: the UI-kit gallery at /_dev/ui exists only in development (FND-12).
//   mock     - Vite dev server in MSW mode: the whole app against contract examples, no backend (FND-13).
//   preview  - the production build served by `vite preview` (bound to every interface): LAN
//              reachability and assertions over the built bundle (FND-13).
const DESIGN = 'http://127.0.0.1:4174'
const MOCK = 'http://127.0.0.1:4175'
const PREVIEW = 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { browserName: 'chromium' },
  projects: [
    {
      name: 'design',
      testMatch: ['gallery.spec.ts', 'screenshots.spec.ts'],
      use: { baseURL: DESIGN },
    },
    {
      name: 'mock',
      testMatch: ['app.spec.ts', 'project-settings.spec.ts'],
      use: { baseURL: MOCK },
    },
    { name: 'preview', testMatch: 'preview.spec.ts', use: { baseURL: PREVIEW } },
  ],
  webServer: [
    {
      command: 'pnpm exec vite --port 4174 --strictPort',
      url: `${DESIGN}/_dev/ui`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command:
        'pnpm exec msw init node_modules/.mockbench/mock-public --no-save && pnpm exec vite --mode mock --port 4175 --strictPort',
      url: MOCK,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm exec vite build && pnpm exec vite preview --port 4173 --strictPort',
      url: PREVIEW,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
