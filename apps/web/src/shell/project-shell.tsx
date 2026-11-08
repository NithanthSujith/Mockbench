import { Outlet, useMatches } from '@tanstack/react-router'
import { ProjectRail } from '../features/routes/ProjectRail'
import { cn } from '../components/ui'

/** Which grid a project screen wants. Set per route as `staticData: { shell: ... }`. */
export type ShellLayout = 'editor' | 'wide'

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    shell?: ShellLayout
  }
}

// Prototype: `.shell` = 248px | 1fr | 400px; at <=1240px the response column drops below and the rail
// narrows to 234px; at <=860px everything stacks. `wide` has no response column.
const GRID: Record<ShellLayout, string> = {
  editor:
    'grid-cols-[248px_minmax(0,1fr)_400px] max-wide:grid-cols-[234px_minmax(0,1fr)] max-narrow:grid-cols-1',
  wide: 'grid-cols-[248px_minmax(0,1fr)] max-wide:grid-cols-[234px_minmax(0,1fr)] max-narrow:grid-cols-1',
}

/**
 * Frame of every /p/$projectSlug screen: the project rail plus whatever the matched screen renders
 * (an <Editor>, optionally followed by a <Response>). The deepest matched route that sets
 * `staticData.shell` chooses the grid; the default is `wide`.
 */
export function ProjectShell() {
  const layout =
    useMatches()
      .map((m) => m.staticData?.shell)
      .reverse()
      .find((s) => s !== undefined) ?? 'wide'
  return (
    <div
      data-shell={layout}
      className={cn('mx-auto grid max-w-[1680px] items-start gap-4 px-4 py-4', GRID[layout])}
    >
      <ProjectRail />
      <Outlet />
    </div>
  )
}
