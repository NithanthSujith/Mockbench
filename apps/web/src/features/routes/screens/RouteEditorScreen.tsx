import type { MockSchemaEnvelope, ResponseCase } from '@mockbench/api-contract'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate, useParams } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, CaseTabs, EmptyState, Spinner } from '../../../components/ui'
import { Editor, Response } from '../../../shell/columns'
import { NotFoundBody } from '../../../shell/not-found'
import { useCurrentWorkspace } from '../../projects/queries'
import { useDebouncedSaver, useSaveTracker } from '../autosave'
import { CaseBar } from '../CaseBar'
import { NewCaseDialog } from '../NewCaseDialog'
import { patchCase, useProjectBySlug, useRouteCases, useRouteDetail } from '../queries'
import { RouteHeader } from '../RouteHeader'
import { PreviewSlot, SchemaEditorSlot } from '../slots'

/**
 * `/p/$projectSlug/routes/$routeId` and `.../cases/$caseId`. The selected case lives in the URL; with
 * no case in the URL the default case is selected by redirect. A case id that is not one of this
 * route's cases is the not-found screen.
 */
export function RouteEditorScreen() {
  const { projectSlug = '', routeId = '', caseId } = useParams({ strict: false })
  const project = useProjectBySlug(projectSlug).data
  const route = useRouteDetail(project?.id, routeId)
  const cases = useRouteCases(project?.id, routeId)

  if (!project || route.isPending || cases.isPending) {
    return (
      <Editor>
        <div className="grid place-items-center py-10">
          <Spinner label="Loading route" />
        </div>
      </Editor>
    )
  }
  if (route.isError || cases.isError) {
    return (
      <Editor>
        <Card>
          <EmptyState
            title="Could not load the route"
            description="Reload the page to try again."
          />
        </Card>
      </Editor>
    )
  }

  const items = cases.data.items
  const selected = items.find((c) => c.id === caseId)
  if (caseId === undefined) {
    const fallback = items.find((c) => c.isDefault) ?? items[0]
    if (!fallback) return <NotFoundBody />
    return (
      <Navigate
        to="/p/$projectSlug/routes/$routeId/cases/$caseId"
        params={{ projectSlug, routeId, caseId: fallback.id }}
        replace
      />
    )
  }
  if (!selected) return <NotFoundBody />

  return (
    <EditorBody
      projectId={project.id}
      projectSlug={projectSlug}
      defaultDelayMs={project.settings.defaultDelayMs}
      route={route.data}
      items={items}
      selected={selected}
    />
  )
}

function EditorBody({
  projectId,
  projectSlug,
  defaultDelayMs,
  route,
  items,
  selected,
}: {
  projectId: string
  projectSlug: string
  defaultDelayMs: number
  route: NonNullable<ReturnType<typeof useRouteDetail>['data']>
  items: ResponseCase[]
  selected: ResponseCase
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canCreate: canEdit } = useCurrentWorkspace()
  const { state, track } = useSaveTracker()
  const [adding, setAdding] = useState(false)
  const [schemaFailure, setSchemaFailure] = useState<string | null>(null)
  // The preview shows edits as they are typed, ahead of the debounced save.
  const [draft, setDraft] = useState<{ caseId: string; schema: MockSchemaEnvelope } | null>(null)
  const previewCase =
    draft?.caseId === selected.id ? { ...selected, schema: draft.schema } : selected

  const goToCase = (caseId: string) =>
    navigate({
      to: '/p/$projectSlug/routes/$routeId/cases/$caseId',
      params: { projectSlug, routeId: route.id, caseId },
    })

  const schemaSaver = useDebouncedSaver<{ schema: MockSchemaEnvelope }>(
    async (patch) => {
      setSchemaFailure(null)
      try {
        await track(patchCase(queryClient, projectId, route.id, selected.id, patch))
      } catch (error) {
        setSchemaFailure(error instanceof Error ? error.message : 'Could not save the schema.')
        throw error
      }
    },
    { enabled: canEdit },
  )

  return (
    <>
      <Editor>
        <RouteHeader
          key={route.id}
          route={route}
          projectId={projectId}
          projectSlug={projectSlug}
          canEdit={canEdit}
          track={track}
          saveState={state}
        />
        <Card data-screen="routes/RouteEditorScreen" className="overflow-hidden">
          <CaseTabs
            items={items.map((c) => ({
              value: c.id,
              name: c.name,
              statusCode: c.statusCode,
              isDefault: c.isDefault,
            }))}
            value={selected.id}
            onValueChange={(id) => void goToCase(id)}
            trailing={
              canEdit ? (
                <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
                  <Plus aria-hidden className="size-3.5" />
                  Case
                </Button>
              ) : null
            }
          />
        </Card>
        {/* Distinct key prefixes: sibling keys must be unique, or React leaks the old sibling. */}
        <CaseBar
          key={`case-bar:${selected.id}`}
          caseItem={selected}
          projectId={projectId}
          routeId={route.id}
          projectDefaultDelayMs={defaultDelayMs}
          canEdit={canEdit}
          track={track}
          onDeleted={() => {
            const fallback = items.find((c) => c.isDefault) ?? items[0]
            if (fallback) void goToCase(fallback.id)
          }}
        />
        {selected.statusCode === 204 ? (
          <Card>
            <EmptyState
              title="No response body"
              description="A 204 response is sent without a body, so there is no schema to edit."
            />
          </Card>
        ) : (
          <SchemaEditorSlot
            key={`schema:${selected.id}`}
            caseId={selected.id}
            value={selected.schema}
            readOnly={!canEdit}
            onChange={(schema) => {
              setDraft({ caseId: selected.id, schema })
              schemaSaver.schedule({ schema })
            }}
          />
        )}
        {schemaFailure ? (
          <p role="alert" className="m-0 text-small text-bad">
            {schemaFailure}
          </p>
        ) : null}
      </Editor>
      <Response>
        <PreviewSlot case={previewCase} route={route} />
      </Response>
      <NewCaseDialog
        projectId={projectId}
        routeId={route.id}
        existingNames={items.map((c) => c.name)}
        open={adding}
        onOpenChange={setAdding}
        onCreated={(id) => void goToCase(id)}
      />
    </>
  )
}
