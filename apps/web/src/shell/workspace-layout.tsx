import { Outlet } from '@tanstack/react-router'
import { SoloShell } from './columns'

/** /w/$wsSlug pages (project list, members) share one centred column. */
export function WorkspaceLayout() {
  return (
    <SoloShell>
      <Outlet />
    </SoloShell>
  )
}
