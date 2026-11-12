import type { Project } from '@mockbench/api-contract'
import { useForm, useStore } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useBlocker, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  Eyebrow,
  Field,
  Input,
  OptionCard,
  PanelBody,
  PanelHead,
  Select,
  SelectItem,
  Spinner,
  Textarea,
} from '../../../components/ui'
import { api } from '../../../lib/api/client'
import { isApiError } from '../../../lib/api/errors'
import { getMockBaseUrl } from '../../../lib/mock-url'
import { qk } from '../../../lib/query-keys'
import { Editor } from '../../../shell/columns'
import { DeleteProjectDialog } from '../DeleteProjectDialog'
import { indexingExample } from '../indexing-example'
import { useCurrentWorkspace } from '../queries'
import {
  delayProblem,
  descriptionProblem,
  diffToPatch,
  nameProblem,
  valuesFromProject,
  type SettingsValues,
} from '../settings-form'

const UNSAVED_PROMPT = 'You have unsaved changes. Leave this page and discard them?'

function SettingsForm({
  project,
  canEdit,
  canDelete,
  wsSlug,
}: {
  project: Project
  canEdit: boolean
  canDelete: boolean
  wsSlug: string | undefined
}) {
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const live = project.activeVersion !== null

  const form = useForm({
    defaultValues: valuesFromProject(project),
    onSubmit: async ({ value, formApi }) => {
      const patch = diffToPatch(project, value)
      if (Object.keys(patch).length === 0) return
      setFailure(null)
      setSaved(false)
      try {
        const updated = await api.projects.update({
          params: { projectId: project.id },
          body: patch,
        })
        queryClient.setQueryData(qk.projectBySlug(project.slug), updated)
        queryClient.setQueryData(qk.project(project.id).detail, updated)
        void queryClient.invalidateQueries({ queryKey: qk.projects(project.workspaceId) })
        formApi.reset(valuesFromProject(updated))
        setSaved(true)
      } catch (error) {
        setFailure(isApiError(error) ? error.message : 'Could not save the settings.')
      }
    },
  })

  const values = useStore(form.store, (s) => s.values)
  const submitting = useStore(form.store, (s) => s.isSubmitting)
  const dirty = useMemo(
    () => Object.keys(diffToPatch(project, values)).length > 0,
    [project, values],
  )
  const invalid =
    nameProblem(values.name) !== undefined ||
    descriptionProblem(values.description) !== undefined ||
    delayProblem(values.defaultDelay) !== undefined

  useBlocker({
    shouldBlockFn: () => (dirty ? !window.confirm(UNSAVED_PROMPT) : false),
    disabled: !dirty,
    enableBeforeUnload: dirty,
  })

  const example = indexingExample(values.indexing)
  const edit = (fn: () => void) => () => {
    setSaved(false)
    fn()
  }

  return (
    <Card data-screen="projects/SettingsScreen">
      <PanelHead>
        <h3 className="m-0 text-body font-semibold">Project settings</h3>
        <span className="flex-1" />
        <span className="mono text-small text-ink-3">{project.slug}</span>
      </PanelHead>
      <PanelBody>
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!canEdit || invalid) return
            void form.handleSubmit()
          }}
        >
          {!canEdit ? (
            <p className="m-0 text-small text-ink-2">
              You have view access to this workspace, so settings are read-only.
            </p>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <form.Field name="name" validators={{ onChange: ({ value }) => nameProblem(value) }}>
              {(field) => (
                <Field
                  label="Name"
                  error={field.state.meta.errors[0]}
                  hint="Changing the name does not change the slug or the mock URL."
                >
                  <Input
                    value={field.state.value}
                    disabled={!canEdit}
                    autoComplete="off"
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      setSaved(false)
                      field.handleChange(e.target.value)
                    }}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field
              name="description"
              validators={{ onChange: ({ value }) => descriptionProblem(value) }}
            >
              {(field) => (
                <Field label="Description" error={field.state.meta.errors[0]}>
                  <Textarea
                    value={field.state.value}
                    disabled={!canEdit}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      setSaved(false)
                      field.handleChange(e.target.value)
                    }}
                  />
                </Field>
              )}
            </form.Field>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Generation mode">
              <Eyebrow>Generation mode</Eyebrow>
              {(
                [
                  [
                    'deterministic',
                    'Deterministic',
                    'Values come from the key and position. Baked at publish, so responses never shift under a test suite.',
                  ],
                  [
                    'seeded',
                    'Seeded faker',
                    'Realistic-looking output, stable because the seed comes from the field path. Still baked.',
                  ],
                  [
                    'random',
                    'Random',
                    'Fresh output per request. Disables baking and makes consumer assertions flaky.',
                  ],
                ] as const
              ).map(([value, title, description]) => (
                <OptionCard
                  key={value}
                  name="mode"
                  value={value}
                  title={title}
                  description={description}
                  checked={values.mode === value}
                  disabled={!canEdit}
                  onChange={edit(() => form.setFieldValue('mode', value))}
                />
              ))}
              {values.mode === 'random' ? (
                <p role="note" className="m-0 text-small text-warn">
                  Random disables baking and makes consumer assertions flaky.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Array indexing">
              <Eyebrow>Array indexing</Eyebrow>
              <OptionCard
                name="indexing"
                value="local"
                title="Local"
                description="A nested array restarts at 1. Shorter values."
                checked={values.indexing === 'local'}
                disabled={!canEdit}
                onChange={edit(() => form.setFieldValue('indexing', 'local'))}
              />
              <OptionCard
                name="indexing"
                value="path"
                title="Path-qualified"
                description="Ancestor positions prefix the value, so every value in the payload is unique."
                checked={values.indexing === 'path'}
                disabled={!canEdit}
                onChange={edit(() => form.setFieldValue('indexing', 'path'))}
              />
              <p data-testid="indexing-example" className="m-0 pt-1 text-small text-ink-2">
                users[2].tags {'→'} <span className="mono">{JSON.stringify(example)}</span>
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <form.Field name="cors">
              {(field) => (
                <Field label="CORS">
                  <Select
                    value={field.state.value}
                    disabled={!canEdit}
                    onValueChange={(v) => {
                      setSaved(false)
                      field.handleChange(v as SettingsValues['cors'])
                    }}
                  >
                    <SelectItem value="*">Allow all origins (*)</SelectItem>
                    <SelectItem value="off">
                      Off — browsers will block calls (useful to test CORS failures)
                    </SelectItem>
                  </Select>
                </Field>
              )}
            </form.Field>
            <form.Field
              name="defaultDelay"
              validators={{ onChange: ({ value }) => delayProblem(value) }}
            >
              {(field) => (
                <Field
                  label="Default delay (ms)"
                  error={field.state.meta.errors[0]}
                  hint="Applied to cases that do not set their own delay."
                >
                  <Input
                    mono
                    inputMode="numeric"
                    value={field.state.value}
                    disabled={!canEdit}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      setSaved(false)
                      field.handleChange(e.target.value)
                    }}
                  />
                </Field>
              )}
            </form.Field>
          </div>

          <div className="flex flex-col gap-1">
            <Eyebrow>Access</Eyebrow>
            <p className="m-0 text-small text-ink-2">
              Mock URLs take no authentication. Anyone who can reach this server can call every
              published project on it. That is the intended threat model: a trusted private network.
            </p>
            <p className="m-0 text-small text-ink-2">
              Base URL{' '}
              <span className="mono break-all text-ink">{getMockBaseUrl(project.slug)}</span>
            </p>
          </div>

          {canEdit ? (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-small text-ink-3">Settings take effect at the next publish.</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={!dirty || invalid || submitting}>
                  Save settings
                </Button>
                {saved ? (
                  <span role="status" className="text-small text-ink-2">
                    <span className="text-good">Saved — applies from your next publish.</span>
                    {live ? (
                      <>
                        {' '}
                        The live version keeps its current settings until you publish and deploy.
                      </>
                    ) : null}
                  </span>
                ) : null}
                {failure ? (
                  <span role="alert" className="text-small text-bad">
                    {failure}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </form>

        {canDelete && wsSlug ? (
          <section
            aria-label="Danger zone"
            className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-bad p-3"
          >
            <div className="min-w-0 flex-1">
              <Eyebrow>Danger zone</Eyebrow>
              <p className="m-0 text-small text-ink-2">
                Deleting a project removes its routes, versions and request log for good.
              </p>
            </div>
            <Button
              variant="ghost"
              className="border-bad text-bad"
              onClick={() => setDeleting(true)}
            >
              Delete project
            </Button>
            <DeleteProjectDialog
              projectId={project.id}
              slug={project.slug}
              workspaceId={project.workspaceId}
              wsSlug={wsSlug}
              open={deleting}
              onOpenChange={setDeleting}
            />
          </section>
        ) : null}
      </PanelBody>
    </Card>
  )
}

/** `/p/$projectSlug/settings`. */
export function SettingsScreen() {
  const { projectSlug = '' } = useParams({ strict: false })
  const { workspace } = useCurrentWorkspace()
  const project = useQuery({
    queryKey: qk.projectBySlug(projectSlug),
    queryFn: ({ signal }) => api.projects.getBySlug({ params: { slug: projectSlug } }, { signal }),
  })
  const role = workspace?.role

  return (
    <Editor>
      {project.isPending || !workspace ? (
        <Card>
          <div className="grid place-items-center py-10">
            <Spinner label="Loading settings" />
          </div>
        </Card>
      ) : project.isError ? (
        <Card>
          <EmptyState title="Could not load settings" description="Reload the page to try again." />
        </Card>
      ) : (
        <SettingsForm
          // A saved project replaces the form's baseline.
          key={project.data.id}
          project={project.data}
          canEdit={role === 'owner' || role === 'editor'}
          canDelete={role === 'owner'}
          wsSlug={workspace.slug}
        />
      )}
    </Editor>
  )
}
