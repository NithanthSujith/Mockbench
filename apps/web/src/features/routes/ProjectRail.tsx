import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, IconButton, Input, MethodBadge, Spinner } from '../../components/ui'
import { qk } from '../../lib/query-keys'
import { Rail } from '../../shell/columns'
import { useCurrentWorkspace } from '../projects/queries'
import { DeleteRouteDialog } from './DeleteRouteDialog'
import { NewRouteDialog } from './NewRouteDialog'
import { useProjectBySlug, useProjectRoutes } from './queries'

const NAV_LINK =
  'flex items-center justify-between gap-2 rounded-sm px-2.5 py-1.75 text-body text-ink-2 hover:bg-panel-2 hover:text-ink aria-[current=page]:bg-panel-2 aria-[current=page]:text-ink'

/** Case-insensitive substring match on "METHOD /path". Client-side only. */
export function filterRoutes<T extends { method: string; path: string }>(
  routes: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...routes]
  return routes.filter((r) => `${r.method} ${r.path}`.toLowerCase().includes(needle))
}

/**
 * The left column of every project screen: navigation, the filterable route list with "+ New route",
 * and per-route delete. Viewers can select routes but get no New/Delete controls.
 */
export function ProjectRail() {
  const { projectSlug, routeId: currentRouteId } = useParams({ strict: false })
  if (!projectSlug) return null
  return <RailBody projectSlug={projectSlug} currentRouteId={currentRouteId} />
}

function RailBody({
  projectSlug,
  currentRouteId,
}: {
  projectSlug: string
  currentRouteId: string | undefined
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const project = useProjectBySlug(projectSlug).data
  const routesQuery = useProjectRoutes(project?.id)
  const { canCreate } = useCurrentWorkspace()
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<{ id: string; method: string; path: string } | null>(
    null,
  )

  const routes = routesQuery.data?.items ?? []
  const visible = filterRoutes(routes, filter)
  const projectId = project?.id

  async function afterDelete(deletedId: string) {
    if (!projectId) return
    const index = routes.findIndex((r) => r.id === deletedId)
    const next = routes[index + 1] ?? routes[index - 1]
    queryClient.setQueryData(qk.project(projectId).routes, (old: typeof routesQuery.data) =>
      old ? { ...old, items: old.items.filter((r) => r.id !== deletedId) } : old,
    )
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.project(projectId).routes }),
      queryClient.invalidateQueries({ queryKey: qk.projectBySlug(projectSlug) }),
    ])
    queryClient.removeQueries({ queryKey: qk.route(projectId, deletedId).all })
    // Only the open route needs somewhere else to go.
    if (deletedId !== currentRouteId) return
    if (next) {
      await navigate({
        to: '/p/$projectSlug/routes/$routeId',
        params: { projectSlug, routeId: next.id },
      })
    } else {
      await navigate({ to: '/p/$projectSlug', params: { projectSlug } })
    }
  }

  return (
    <Rail data-slot="project-rail">
      <Card>
        <nav aria-label="Project" className="flex flex-col gap-px p-2">
          <Link
            to="/p/$projectSlug"
            params={{ projectSlug }}
            activeOptions={{ exact: true }}
            className={NAV_LINK}
          >
            Routes
            <span className="mono text-small text-ink-3">
              {project?.routeCount ?? routes.length}
            </span>
          </Link>
          <Link to="/p/$projectSlug/versions" params={{ projectSlug }} className={NAV_LINK}>
            Versions
          </Link>
          <Link to="/p/$projectSlug/logs" params={{ projectSlug }} className={NAV_LINK}>
            Request log
          </Link>
          <Link to="/p/$projectSlug/presets" params={{ projectSlug }} className={NAV_LINK}>
            Presets
          </Link>
          <Link to="/p/$projectSlug/settings" params={{ projectSlug }} className={NAV_LINK}>
            Settings
          </Link>
        </nav>

        <div className="flex flex-col gap-2 border-t border-line p-2">
          <Input
            type="search"
            aria-label="Filter routes"
            placeholder="Filter routes"
            autoComplete="off"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {canCreate && project ? (
            <Button variant="dashed" size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-3.5" />
              New route
            </Button>
          ) : null}
          <ul
            aria-label="Routes"
            className="m-0 flex max-h-[calc(100vh-380px)] min-h-0 list-none flex-col gap-px overflow-y-auto p-0 max-narrow:max-h-[220px]"
          >
            {routesQuery.isPending ? (
              <li className="grid place-items-center py-3">
                <Spinner label="Loading routes" />
              </li>
            ) : routesQuery.isError ? (
              <li role="alert" className="px-2 py-2 text-small text-bad">
                Could not load routes.
              </li>
            ) : routes.length > 0 && visible.length === 0 ? (
              <li className="px-2 py-2 text-small text-ink-3">No route matches.</li>
            ) : (
              visible.map((route) => (
                <li key={route.id} className="group flex items-center gap-1">
                  <Link
                    to="/p/$projectSlug/routes/$routeId"
                    params={{ projectSlug, routeId: route.id }}
                    title={`${route.method} ${route.path}`}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-ink-2 hover:bg-panel-2 hover:text-ink aria-[current=page]:bg-panel-2 aria-[current=page]:text-ink"
                  >
                    <MethodBadge method={route.method} />
                    <span className="mono min-w-0 flex-1 truncate text-compact">{route.path}</span>
                  </Link>
                  {canCreate ? (
                    <IconButton
                      aria-label={`Delete ${route.method} ${route.path}`}
                      className="size-6 shrink-0 border-0 bg-transparent opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-narrow:opacity-100"
                      onClick={() =>
                        setDeleting({ id: route.id, method: route.method, path: route.path })
                      }
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                    </IconButton>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </div>
      </Card>
      {project ? (
        <NewRouteDialog
          projectId={project.id}
          projectSlug={projectSlug}
          open={creating}
          onOpenChange={setCreating}
        />
      ) : null}
      <DeleteRouteDialog
        route={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={afterDelete}
      />
    </Rail>
  )
}
