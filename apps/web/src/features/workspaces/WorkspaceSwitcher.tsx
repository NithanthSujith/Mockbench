import { useParams } from '@tanstack/react-router'
import { DropdownButton } from '../../components/ui'

// STUB (FND-13) for the topbar workspace slot: replaced by WS-03. Keep the export name.
export function WorkspaceSwitcher() {
  const { wsSlug } = useParams({ strict: false })
  return (
    <DropdownButton disabled data-slot="workspace-switcher">
      {wsSlug ?? 'Workspace'}
    </DropdownButton>
  )
}
