// Route file (FND-13): wiring only. Frozen after Phase 1; screens and loaders live in features/<area>/.
import { createFileRoute } from '@tanstack/react-router'
import { parseLogsSearch } from '../features/logs/search'
import { logsLoader } from '../features/logs/route-loaders'
import { LogsScreen } from '../features/logs/screens/LogsScreen'

export const Route = createFileRoute('/_authed/p/$projectSlug/logs')({
  validateSearch: parseLogsSearch,
  staticData: { shell: 'wide' },
  loader: ({ context, params }) => logsLoader({ queryClient: context.queryClient, params }),
  component: LogsScreen,
})
