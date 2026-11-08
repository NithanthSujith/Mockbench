// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { workspaceLoader } from '../features/workspaces/route-loaders'
import { WorkspaceLayout } from '../shell/workspace-layout'

export const Route = createFileRoute('/_authed/w/$wsSlug')({
  loader: ({ context, params }) => workspaceLoader({ queryClient: context.queryClient, params }),
  component: WorkspaceLayout,
})
