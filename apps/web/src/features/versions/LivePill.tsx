import { useParams } from '@tanstack/react-router'

// STUB (FND-13) for the topbar "LIVE vN" slot: replaced by RUN-09. Keep the export name.
// The real one renders the LivePill component when the project has an active version.
export function LivePill() {
  const { projectSlug } = useParams({ strict: false })
  if (!projectSlug) return null
  return (
    <span data-slot="live-pill" className="text-small text-ink-2">
      not published
    </span>
  )
}
