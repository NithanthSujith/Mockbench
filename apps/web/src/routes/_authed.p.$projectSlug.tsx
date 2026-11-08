// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { projectLoader } from '../features/routes/route-loaders'
import { ProjectShell } from '../shell/project-shell'

export const Route = createFileRoute('/_authed/p/$projectSlug')({
  loader: ({ context, params }) => projectLoader({ queryClient: context.queryClient, params }),
  component: ProjectShell,
})
