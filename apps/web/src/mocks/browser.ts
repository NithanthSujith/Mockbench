import { setupWorker } from 'msw/browser'
import { createHandlers } from './handlers'

/** Starts the mock service worker (mock mode only; see main.tsx). */
export async function startMocks(): Promise<void> {
  const worker = setupWorker(...createHandlers())
  await worker.start({
    // Everything that is not /api/v1 (assets, the Vite client, fonts) passes through untouched.
    onUnhandledFrame: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
    quiet: true,
  })
}
