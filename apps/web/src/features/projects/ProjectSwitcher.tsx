import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  DropdownButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui'
import { NewProjectDialog } from './NewProjectDialog'
import { useCurrentWorkspace, useWorkspaceProjects } from './queries'

/** Topbar slot: the open project's slug; a menu of the workspace's projects, All projects, New project. */
export function ProjectSwitcher() {
  const navigate = useNavigate()
  const { workspace, canCreate, currentProjectSlug } = useCurrentWorkspace()
  const projects = useWorkspaceProjects(workspace?.id)
  const [creating, setCreating] = useState(false)
  const items = projects.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <DropdownButton data-slot="project-switcher" disabled={!workspace}>
            <span className="mono">{currentProjectSlug ?? 'All projects'}</span>
          </DropdownButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          {items.map((project) => (
            <DropdownMenuItem
              key={project.id}
              selected={project.slug === currentProjectSlug}
              onSelect={() =>
                void navigate({ to: '/p/$projectSlug', params: { projectSlug: project.slug } })
              }
            >
              <span className="min-w-0 truncate">{project.name}</span>
              <span className="mono ml-auto truncate text-small text-ink-3">{project.slug}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              workspace && void navigate({ to: '/w/$wsSlug', params: { wsSlug: workspace.slug } })
            }
          >
            All projects
          </DropdownMenuItem>
          {canCreate ? (
            <DropdownMenuItem onSelect={() => setCreating(true)}>+ New project</DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {workspace && canCreate ? (
        <NewProjectDialog workspaceId={workspace.id} open={creating} onOpenChange={setCreating} />
      ) : null}
    </>
  )
}
