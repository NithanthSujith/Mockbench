// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { versionsLoader } from '../features/versions/route-loaders'
import { VersionsScreen } from '../features/versions/screens/VersionsScreen'

export const Route = createFileRoute('/_authed/p/$projectSlug/versions')({
  staticData: { shell: 'wide' },
  loader: ({ context, params }) => versionsLoader({ queryClient: context.queryClient, params }),
  component: VersionsScreen,
})
