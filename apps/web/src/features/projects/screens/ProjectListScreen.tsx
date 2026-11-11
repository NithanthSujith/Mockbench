import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Button,
  buttonVariants,
  Card,
  EmptyState,
  LivePill,
  PanelHead,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  cn,
} from '../../../components/ui'
import { getMockBaseUrl } from '../../../lib/mock-url'
import { NewProjectDialog } from '../NewProjectDialog'
import { useCurrentWorkspace, useWorkspaceProjects } from '../queries'

function Body({ children }: { children: React.ReactNode }) {
  // data-screen is what the route tests assert on.
  return (
    <div data-screen="projects/ProjectListScreen" className="min-w-0">
      {children}
    </div>
  )
}

/** /w/$wsSlug: the workspace's projects with their live mock URLs. */
export function ProjectListScreen() {
  const { workspace, loading, canCreate } = useCurrentWorkspace()
  const projects = useWorkspaceProjects(workspace?.id)
  const [creating, setCreating] = useState(false)

  if (loading || (workspace && !projects.data && !projects.isError)) {
    return (
      <Body>
        <Card className="grid place-items-center p-8">
          <Spinner aria-label="Loading projects" />
        </Card>
      </Body>
    )
  }
  if (!workspace) {
    return (
      <Body>
        <Card>
          <EmptyState
            title="Workspace not found"
            description="It may not exist, or you may not be a member of it."
          />
        </Card>
      </Body>
    )
  }
  if (projects.isError || !projects.data) {
    return (
      <Body>
        <Card>
          <EmptyState
            title="Could not load projects"
            description={projects.error?.message}
            action={
              <Button variant="ghost" onClick={() => void projects.refetch()}>
                Try again
              </Button>
            }
          />
        </Card>
      </Body>
    )
  }

  const items = projects.data.pages.flatMap((p) => p.items)
  const more = projects.hasNextPage
  const newButton = canCreate ? (
    <Button onClick={() => setCreating(true)}>New project</Button>
  ) : null

  return (
    <Body>
      <Card>
        <PanelHead>
          <h3>{workspace.name}</h3>
          {items.length > 0 ? (
            <span className="text-small text-ink-2">
              {items.length}
              {more ? '+' : ''} project{items.length === 1 && !more ? '' : 's'}
            </span>
          ) : null}
          <span className="flex-1" />
          {items.length > 0 && newButton ? (
            <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
              + New project
            </Button>
          ) : null}
        </PanelHead>
        {items.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description={
              canCreate
                ? 'Create a project to start defining mock routes.'
                : 'Ask an editor of this workspace to create one.'
            }
            action={newButton}
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Project</Th>
                  <Th>Base URL</Th>
                  <Th className="text-right">Routes</Th>
                  <Th className="text-right">Cases</Th>
                  <Th>Live</Th>
                  <Th>
                    <span className="sr-only">Open</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {items.map((project) => (
                  <Tr key={project.id}>
                    <Td>
                      <Link
                        to="/p/$projectSlug"
                        params={{ projectSlug: project.slug }}
                        className="font-semibold text-ink hover:underline"
                      >
                        {project.name}
                      </Link>
                      {project.description ? (
                        <div className="max-w-90 whitespace-normal text-small text-ink-2">
                          {project.description}
                        </div>
                      ) : null}
                    </Td>
                    <Td className="mono text-small text-ink-2">{getMockBaseUrl(project.slug)}</Td>
                    <Td className="mono text-right">{project.routeCount}</Td>
                    <Td className="mono text-right">{project.caseCount}</Td>
                    <Td>
                      {project.activeVersion ? (
                        <LivePill>{project.activeVersion.label}</LivePill>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <Link
                        to="/p/$projectSlug"
                        params={{ projectSlug: project.slug }}
                        aria-label={`Open ${project.name}`}
                        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
                      >
                        Open
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {more ? (
              <div className="flex justify-center border-t border-line p-3">
                <Button
                  variant="ghost"
                  disabled={projects.isFetchingNextPage}
                  onClick={() => void projects.fetchNextPage()}
                >
                  {projects.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            ) : null}
          </>
        )}
        <p className="m-0 border-t border-line px-3.5 py-3 text-small text-ink-3">
          A project slug is its URL prefix, so slugs are unique across the whole server, not just
          this workspace.
        </p>
      </Card>
      {canCreate ? (
        <NewProjectDialog workspaceId={workspace.id} open={creating} onOpenChange={setCreating} />
      ) : null}
    </Body>
  )
}
