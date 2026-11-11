import { Navigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { Button, Card, EmptyState, Spinner } from '../../../components/ui'
import { Editor } from '../../../shell/columns'
import { useCurrentWorkspace } from '../../projects/queries'
import { NewRouteDialog } from '../NewRouteDialog'
import { useProjectBySlug, useProjectRoutes } from '../queries'

/**
 * `/p/$projectSlug` itself: redirects to the first route, or shows the empty state when the project
 * has none.
 */
export function ProjectHomeScreen() {
  const { projectSlug = '' } = useParams({ strict: false })
  const project = useProjectBySlug(projectSlug).data
  const routes = useProjectRoutes(project?.id)
  const { canCreate } = useCurrentWorkspace()
  const [creating, setCreating] = useState(false)

  const first = routes.data?.items[0]
  if (first) {
    return (
      <Navigate
        to="/p/$projectSlug/routes/$routeId"
        params={{ projectSlug, routeId: first.id }}
        replace
      />
    )
  }

  return (
    <Editor>
      <Card data-screen="routes/ProjectHomeScreen">
        {routes.isPending || !project ? (
          <div className="grid place-items-center py-10">
            <Spinner label="Loading routes" />
          </div>
        ) : routes.isError ? (
          <EmptyState title="Could not load routes" description="Reload the page to try again." />
        ) : (
          <EmptyState
            title="No routes yet"
            description="A route is a method and path, such as GET /invoices/:id, with one or more response cases."
            action={canCreate ? <Button onClick={() => setCreating(true)}>New route</Button> : null}
          />
        )}
      </Card>
      {project ? (
        <NewRouteDialog
          projectId={project.id}
          projectSlug={projectSlug}
          open={creating}
          onOpenChange={setCreating}
        />
      ) : null}
    </Editor>
  )
}
