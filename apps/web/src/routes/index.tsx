// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { redirectFromRoot } from '../lib/auth-guard'

// "/" has no screen: it sends you to the landing path (features/auth/session.ts) or to /login.
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => redirectFromRoot({ queryClient: context.queryClient }),
})
