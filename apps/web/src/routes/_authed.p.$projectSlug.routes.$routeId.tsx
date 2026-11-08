// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { routeEditorLoader } from '../features/routes/route-loaders'
import { RouteEditorScreen } from '../features/routes/screens/RouteEditorScreen'

export const Route = createFileRoute('/_authed/p/$projectSlug/routes/$routeId')({
  staticData: { shell: 'editor' },
  loader: ({ context, params }) => routeEditorLoader({ queryClient: context.queryClient, params }),
  // One layout for both /routes/$routeId and .../cases/$caseId, so switching case never remounts the editor.
  component: RouteEditorScreen,
})
