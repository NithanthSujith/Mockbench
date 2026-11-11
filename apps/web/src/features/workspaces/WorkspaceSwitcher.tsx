import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Button,
  DropdownButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui'
import { useCurrentWorkspace, useSessionState } from '../projects/queries'
import { NewWorkspaceDialog } from './NewWorkspaceDialog'

/**
 * Topbar slot. One workspace: a plain label. Several: a menu with the current one ticked and
 * "+ New workspace". None: a "Create workspace" button.
 */
export function WorkspaceSwitcher() {
  const navigate = useNavigate()
  const session = useSessionState()
  const { workspace } = useCurrentWorkspace()
  const [creating, setCreating] = useState(false)
  const all = session.data?.workspaces ?? []

  let body
  if (session.isPending) {
    body = (
      <DropdownButton disabled data-slot="workspace-switcher">
        Workspace
      </DropdownButton>
    )
  } else if (all.length === 0) {
    body = (
      <Button data-slot="workspace-switcher" onClick={() => setCreating(true)}>
        Create workspace
      </Button>
    )
  } else if (all.length === 1) {
    body = (
      <span
        data-slot="workspace-switcher"
        className="inline-flex items-center rounded-md border border-line-strong bg-panel-2 px-2.5 py-1.5 text-control"
      >
        {workspace?.name ?? all[0]!.name}
      </span>
    )
  } else {
    body = (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <DropdownButton data-slot="workspace-switcher">
            {workspace?.name ?? 'Workspace'}
          </DropdownButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {all.map((w) => (
            <DropdownMenuItem
              key={w.id}
              selected={w.id === workspace?.id}
              onSelect={() => void navigate({ to: '/w/$wsSlug', params: { wsSlug: w.slug } })}
            >
              <span className="min-w-0 truncate">{w.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>+ New workspace</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <>
      {body}
      <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}
