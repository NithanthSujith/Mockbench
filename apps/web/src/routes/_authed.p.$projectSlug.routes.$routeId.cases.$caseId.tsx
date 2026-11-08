// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/p/$projectSlug/routes/$routeId/cases/$caseId')({
  // No component: the selected case is read from the URL by RouteEditorScreen (features/routes).
})
