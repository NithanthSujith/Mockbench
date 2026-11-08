// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { ProjectListScreen } from '../features/projects/screens/ProjectListScreen'
import { workspaceProjectsLoader } from '../features/projects/route-loaders'

export const Route = createFileRoute('/_authed/w/$wsSlug/')({
  loader: ({ context, params }) =>
    workspaceProjectsLoader({ queryClient: context.queryClient, params }),
  component: ProjectListScreen,
})
