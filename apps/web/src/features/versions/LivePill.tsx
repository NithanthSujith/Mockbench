import { useParams } from '@tanstack/react-router'
import { LivePill as LivePillBadge } from '../../components/ui'
import { useProjectForVersions } from './queries'

/** Topbar slot: "LIVE <label>" for the active version, or "not published". */
export function LivePill() {
  const { projectSlug } = useParams({ strict: false })
  const project = useProjectForVersions(projectSlug).data
  if (!projectSlug || !project) return null
  if (!project.activeVersion) {
    return (
      <span data-slot="live-pill" className="text-small text-ink-2">
        not published
      </span>
    )
  }
  return (
    <LivePillBadge data-slot="live-pill">
      LIVE <span className="mono">{project.activeVersion.label}</span>
    </LivePillBadge>
  )
}
