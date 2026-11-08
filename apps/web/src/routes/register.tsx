// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { RegisterScreen } from '../features/auth/screens/RegisterScreen'
import { safeRedirectTarget } from '../lib/auth-guard'

/** `?redirect=` is where to go after signing in; `?reason=expired` shows "Your session ended". */
export interface LoginSearch {
  redirect?: string
  reason?: 'expired'
}

export const Route = createFileRoute('/register')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: safeRedirectTarget(search.redirect),
    reason: search.reason === 'expired' ? 'expired' : undefined,
  }),
  component: RegisterScreen,
})
