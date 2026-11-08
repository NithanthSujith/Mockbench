// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { MembersScreen } from '../features/workspaces/screens/MembersScreen'
import { membersLoader } from '../features/workspaces/route-loaders'

export const Route = createFileRoute('/_authed/w/$wsSlug/members')({
  loader: ({ context, params }) => membersLoader({ queryClient: context.queryClient, params }),
  component: MembersScreen,
})
