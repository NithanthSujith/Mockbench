// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { ProjectHomeScreen } from '../features/routes/screens/ProjectHomeScreen'

export const Route = createFileRoute('/_authed/p/$projectSlug/')({
  staticData: { shell: 'wide' },
  component: ProjectHomeScreen,
})
