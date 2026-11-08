import { useParams } from '@tanstack/react-router'
import { DropdownButton } from '../../components/ui'

// STUB (FND-13) for the topbar project slot: replaced by PRJ-04. Keep the export name.
export function ProjectSwitcher() {
  const { projectSlug } = useParams({ strict: false })
  return (
    <DropdownButton disabled data-slot="project-switcher">
      <span className="mono">{projectSlug ?? 'No project'}</span>
    </DropdownButton>
  )
}
