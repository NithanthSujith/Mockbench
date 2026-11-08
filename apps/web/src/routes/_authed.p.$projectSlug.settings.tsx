// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { settingsLoader } from '../features/projects/route-loaders'
import { SettingsScreen } from '../features/projects/screens/SettingsScreen'

export const Route = createFileRoute('/_authed/p/$projectSlug/settings')({
  staticData: { shell: 'wide' },
  loader: ({ context, params }) => settingsLoader({ queryClient: context.queryClient, params }),
  component: SettingsScreen,
})
