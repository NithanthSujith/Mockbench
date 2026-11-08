// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '../lib/auth-guard'
import { AuthedLayout } from '../shell/authed-layout'
import { ErrorBody, NotFoundBody } from '../shell/not-found'

// Pathless layout for every signed-in screen: the guard runs BEFORE anything renders.
export const Route = createFileRoute('/_authed')({
  beforeLoad: ({ context, location }) =>
    requireSession({ queryClient: context.queryClient, href: location.href }),
  component: AuthedLayout,
  notFoundComponent: NotFoundBody,
  errorComponent: ({ error }) => <ErrorBody error={error} />,
})
