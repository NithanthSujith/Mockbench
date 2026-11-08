import { Link, useParams } from '@tanstack/react-router'
import { Card, EmptyState } from '../../components/ui'
import { Rail } from '../../shell/columns'

// STUB (FND-13) for the project rail (navigation + route list + "New route"): replaced by BLD-04.
// Keep the export name. The links below only make the skeleton navigable.
export function ProjectRail() {
  const { projectSlug } = useParams({ strict: false })
  if (!projectSlug) return null
  const linkClass = 'rounded-sm px-2.5 py-1.75 text-body text-ink-2 hover:bg-panel-2 hover:text-ink'
  return (
    <Rail data-slot="project-rail">
      <Card>
        <nav aria-label="Project" className="flex flex-col gap-px p-2">
          <Link
            to="/p/$projectSlug"
            params={{ projectSlug }}
            activeOptions={{ exact: true }}
            className={linkClass}
          >
            Routes
          </Link>
          <Link to="/p/$projectSlug/versions" params={{ projectSlug }} className={linkClass}>
            Versions
          </Link>
          <Link to="/p/$projectSlug/logs" params={{ projectSlug }} className={linkClass}>
            Request log
          </Link>
          <Link to="/p/$projectSlug/presets" params={{ projectSlug }} className={linkClass}>
            Presets
          </Link>
          <Link to="/p/$projectSlug/settings" params={{ projectSlug }} className={linkClass}>
            Settings
          </Link>
        </nav>
        <EmptyState
          title="Route list"
          description="Stub: BLD-04 renders the filterable route list here."
        />
      </Card>
    </Rail>
  )
}
