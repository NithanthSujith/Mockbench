// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { presetsLoader } from '../features/presets/route-loaders'
import { PresetsScreen } from '../features/presets/screens/PresetsScreen'

export const Route = createFileRoute('/_authed/p/$projectSlug/presets')({
  staticData: { shell: 'wide' },
  loader: ({ context, params }) => presetsLoader({ queryClient: context.queryClient, params }),
  component: PresetsScreen,
})
