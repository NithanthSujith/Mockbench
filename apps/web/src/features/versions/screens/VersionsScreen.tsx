import { useParams } from '@tanstack/react-router'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import type { Deployment, VersionSummary } from '@mockbench/api-contract'
import { createContext, useContext, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  EmptyState,
  LivePill,
  PanelBody,
  PanelHead,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '../../../components/ui'
import { api } from '../../../lib/api/client'
import { isApiError } from '../../../lib/api/errors'
import { Editor } from '../../../shell/columns'
import { useCurrentWorkspace } from '../../projects/queries'
import { useDeployments, useProjectForVersions, useRefreshVersions, useVersions } from '../queries'

const EMPTY_TEXT =
  'Nothing published yet. Publishing freezes every route and case into a snapshot; deploying points the URL at it.'

const features = tableFeatures({})
const helper = createColumnHelper<typeof features, VersionSummary>()

interface Actions {
  canEdit: boolean
  onDeploy: (v: VersionSummary) => void
  onDelete: (v: VersionSummary) => void
}
const ActionsContext = createContext<Actions>({
  canEdit: false,
  onDeploy: () => {},
  onDelete: () => {},
})

function RowActions({ version }: { version: VersionSummary }) {
  const { canEdit, onDeploy, onDelete } = useContext(ActionsContext)
  if (!canEdit) return null
  return (
    <div className="flex gap-1.5">
      {version.isActive ? null : (
        <Button variant="ghost" size="sm" onClick={() => onDeploy(version)}>
          Deploy
        </Button>
      )}
      {version.isActive ? null : (
        <Button variant="ghost" size="sm" onClick={() => onDelete(version)}>
          Delete
        </Button>
      )}
    </div>
  )
}

const columns = helper.columns([
  helper.accessor('label', {
    header: 'Version',
    cell: (c) => <span className="mono">{c.getValue()}</span>,
  }),
  helper.accessor('notes', {
    header: 'Notes',
    cell: (c) => <span className="text-ink-2">{c.getValue() ?? ''}</span>,
  }),
  helper.accessor('createdAt', {
    header: 'Published',
    cell: (c) => <time dateTime={c.getValue()}>{new Date(c.getValue()).toLocaleString()}</time>,
  }),
  helper.accessor('routeCount', { header: 'Routes' }),
  helper.accessor('caseCount', { header: 'Cases' }),
  helper.display({
    id: 'state',
    header: 'State',
    cell: (c) => (c.row.original.isActive ? <LivePill>LIVE</LivePill> : null),
  }),
  helper.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    cell: (c) => <RowActions version={c.row.original} />,
  }),
])

function VersionsTable({ data }: { data: VersionSummary[] }) {
  const table = useTable({ features, columns, data })
  return (
    <Table>
      <THead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <Th key={header.id}>
                {header.isPlaceholder ? null : <table.FlexRender header={header} />}
              </Th>
            ))}
          </tr>
        ))}
      </THead>
      <TBody>
        {table.getRowModel().rows.map((row) => (
          <Tr key={row.id}>
            {row.getAllCells().map((cell) => (
              <Td key={cell.id}>
                <table.FlexRender cell={cell} />
              </Td>
            ))}
          </Tr>
        ))}
      </TBody>
    </Table>
  )
}

function DeploymentsPanel({ projectId }: { projectId: string }) {
  const query = useDeployments(projectId)
  const items: Deployment[] = query.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card>
      <PanelHead>
        <h3 className="m-0">Deployment history</h3>
      </PanelHead>
      <PanelBody>
        {query.isPending ? (
          <Spinner />
        ) : items.length === 0 ? (
          <p className="m-0 text-small text-ink-3">No deployments yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-control">
            {items.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-2">
                <span className="mono">{d.versionLabel}</span>
                <time className="text-small text-ink-3" dateTime={d.deployedAt}>
                  {new Date(d.deployedAt).toLocaleString()}
                </time>
                {d.deployedBy ? (
                  <span className="text-small text-ink-2">{d.deployedBy.name}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {query.hasNextPage ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load more deployments
          </Button>
        ) : null}
      </PanelBody>
    </Card>
  )
}

/** Versions: publish history, deploy / rollback with confirmation, delete, deployment history. */
export function VersionsScreen() {
  const { projectSlug } = useParams({ strict: false })
  const project = useProjectForVersions(projectSlug).data
  const { canCreate } = useCurrentWorkspace()
  const versionsQuery = useVersions(project?.id)
  const refresh = useRefreshVersions()
  const [deploying, setDeploying] = useState<VersionSummary | null>(null)
  const [deleting, setDeleting] = useState<VersionSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const versions = useMemo(
    () => versionsQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [versionsQuery.data],
  )
  const actions = useMemo<Actions>(
    () => ({
      canEdit: canCreate,
      onDeploy: (v) => {
        setFailure(null)
        setDeploying(v)
      },
      onDelete: (v) => {
        setFailure(null)
        setDeleting(v)
      },
    }),
    [canCreate],
  )

  if (!project || !projectSlug) return <Editor data-screen="versions/VersionsScreen" />
  const projectId = project.id
  const slug = projectSlug
  const activeSeq = versions.find((v) => v.isActive)?.seq

  async function run(action: () => Promise<unknown>, done: () => void, fallback: string) {
    setBusy(true)
    setFailure(null)
    try {
      await action()
      await refresh(projectId, slug)
      done()
    } catch (error) {
      if (isApiError(error) && error.code === 'version_referenced') {
        setFailure('Recent requests still reference this version')
      } else {
        setFailure(isApiError(error) ? error.message : fallback)
      }
    } finally {
      setBusy(false)
    }
  }

  const rollback = deploying !== null && activeSeq !== undefined && deploying.seq < activeSeq

  return (
    <Editor data-screen="versions/VersionsScreen">
      <Card>
        <PanelHead>
          <h3 className="m-0">Versions</h3>
        </PanelHead>
        {versionsQuery.isPending ? (
          <PanelBody>
            <Spinner />
          </PanelBody>
        ) : versions.length === 0 ? (
          <EmptyState title="No versions" description={EMPTY_TEXT} />
        ) : (
          <ActionsContext.Provider value={actions}>
            <VersionsTable data={versions} />
          </ActionsContext.Provider>
        )}
        {versionsQuery.hasNextPage ? (
          <PanelBody>
            <Button
              variant="ghost"
              disabled={versionsQuery.isFetchingNextPage}
              onClick={() => void versionsQuery.fetchNextPage()}
            >
              Load more
            </Button>
          </PanelBody>
        ) : null}
      </Card>

      <DeploymentsPanel projectId={projectId} />

      <Dialog
        open={deploying !== null}
        onOpenChange={(open) => {
          if (!open) setDeploying(null)
        }}
      >
        {deploying ? (
          <DialogContent
            title={rollback ? `Roll back to ${deploying.label}?` : `Deploy ${deploying.label}?`}
            description={`The URL will answer from ${deploying.label} immediately.`}
          >
            {failure ? (
              <p role="alert" className="m-0 text-small text-bad">
                {failure}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      api.deploy.create({
                        params: { projectId },
                        body: { versionId: deploying.id },
                      }),
                    () => setDeploying(null),
                    'Could not deploy.',
                  )
                }
              >
                {rollback ? 'Roll back' : 'Deploy'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        {deleting ? (
          <DialogContent
            title={`Delete ${deleting.label}?`}
            description="This version is removed permanently."
          >
            {failure ? (
              <p role="alert" className="m-0 text-small text-bad">
                {failure}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api.versions.delete({ params: { versionId: deleting.id } }),
                    () => setDeleting(null),
                    'Could not delete the version.',
                  )
                }
              >
                Delete version
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </Editor>
  )
}
