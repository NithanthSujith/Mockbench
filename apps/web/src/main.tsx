import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { App } from './app/App'
import { createAppRouter } from './app/router'
import { createQueryClient } from './lib/query-client'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

async function start(target: HTMLElement) {
  // `pnpm dev:mock` (vite --mode mock) answers every /api/v1 call from the contract examples with no
  // backend. MODE is a compile-time constant, so a production build drops this branch, the dynamic
  // import and all of MSW. (Service workers need localhost or HTTPS: mock mode is a localhost tool.)
  if (import.meta.env.MODE === 'mock') {
    const { startMocks } = await import('./mocks/browser')
    await startMocks()
  }
  const queryClient = createQueryClient()
  const router = createAppRouter({ queryClient })
  createRoot(target).render(
    <StrictMode>
      <App queryClient={queryClient} router={router} />
    </StrictMode>,
  )
}

void start(root)
