import type { Preset } from '@mockbench/api-contract'
import { STARTER_PRESETS } from '@mockbench/schema-core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { Download, FileUp, LayoutTemplate, Plus } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  EmptyState,
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
import { qk } from '../../../lib/query-keys'
import { Editor } from '../../../shell/columns'
import { useCurrentWorkspace } from '../../projects/queries'
import { PresetEditor, type EditorTarget } from '../PresetEditor'
import { usePresets } from '../queries'
import { exportFileName, exportText, parseImport } from '../rules'

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}

/** Client-side download: a data URL works on a LAN IP over HTTP, where blob/clipboard APIs may not. */
function download(name: string, text: string): void {
  const a = document.createElement('a')
  a.href = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function EnableSwitch({
  preset,
  canEdit,
  onFailure,
}: {
  preset: Preset
  canEdit: boolean
  onFailure: (message: string) => void
}) {
  const queryClient = useQueryClient()
  // While the request is in flight the switch shows the requested state; afterwards the server's.
  const [pending, setPending] = useState<boolean | null>(null)
  const checked = pending ?? preset.isEnabled

  async function toggle(next: boolean) {
    setPending(next)
    try {
      await api.presets.update({ params: { presetId: preset.id }, body: { isEnabled: next } })
      await queryClient.invalidateQueries({ queryKey: qk.project(preset.projectId).presets })
    } catch (error) {
      onFailure(
        isApiError(error)
          ? `Could not update "${preset.name}": ${error.message}`
          : `Could not update "${preset.name}".`,
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <label className="inline-flex cursor-pointer items-center gap-2 has-disabled:cursor-not-allowed has-disabled:opacity-50">
      <input
        type="checkbox"
        role="switch"
        className="size-4 accent-signal"
        aria-label={`Enable ${preset.name}`}
        checked={checked}
        disabled={!canEdit || pending !== null}
        onChange={(e) => void toggle(e.target.checked)}
      />
      <span className="text-small text-ink-2">{checked ? 'On' : 'Off'}</span>
    </label>
  )
}

function TemplateDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function add(index: number) {
    const starter = STARTER_PRESETS[index]
    if (!starter || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await api.presets.create({
        params: { projectId },
        body: {
          name: starter.name,
          priority: starter.priority,
          rules: starter.rules,
          isEnabled: false,
        },
      })
      await queryClient.invalidateQueries({ queryKey: qk.project(projectId).presets })
      onOpenChange(false)
    } catch (error) {
      setFailure(isApiError(error) ? error.message : 'Could not add the template.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add from template"
        description="The copy is added switched off, so you can read it before it takes effect."
      >
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {STARTER_PRESETS.map((starter, i) => (
            <li
              key={starter.name}
              className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="m-0 text-control font-semibold">{starter.name}</p>
                <p className="m-0 text-small text-ink-3">
                  {starter.rules.length} {starter.rules.length === 1 ? 'rule' : 'rules'} · priority{' '}
                  <span className="mono">{starter.priority}</span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={`Use ${starter.name}`}
                onClick={() => void add(i)}
              >
                Use
              </Button>
            </li>
          ))}
        </ul>
        {failure ? (
          <p role="alert" className="m-0 pt-2 text-small text-bad">
            {failure}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({ preset, onClose }: { preset: Preset | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function remove() {
    if (!preset) return
    setBusy(true)
    setFailure(null)
    try {
      await api.presets.delete({ params: { presetId: preset.id } })
      await queryClient.invalidateQueries({ queryKey: qk.project(preset.projectId).presets })
      onClose()
    } catch (error) {
      setFailure(isApiError(error) ? error.message : 'Could not delete the preset.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={preset !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        title="Delete preset"
        description={
          preset
            ? `Delete "${preset.name}"? Versions already published keep their own copy.`
            : undefined
        }
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
            variant="ghost"
            className="border-bad text-bad"
            disabled={busy}
            onClick={() => void remove()}
          >
            Delete preset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** `/p/$projectSlug/presets`. */
export function PresetsScreen() {
  const { projectSlug = '' } = useParams({ strict: false })
  const { workspace } = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const project = useQuery({
    queryKey: qk.projectBySlug(projectSlug),
    queryFn: ({ signal }) => api.projects.getBySlug({ params: { slug: projectSlug } }, { signal }),
  })
  const projectId = project.data?.id
  const presets = usePresets(projectId)
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'editor'

  const fileInput = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<EditorTarget | null>(null)
  const [templates, setTemplates] = useState(false)
  const [deleting, setDeleting] = useState<Preset | null>(null)
  const [importIssues, setImportIssues] = useState<string[] | null>(null)
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !projectId) return
    setNotice(null)
    setImportIssues(null)
    let text: string
    try {
      text = await readText(file)
    } catch {
      setImportIssues(['The file could not be read.'])
      return
    }
    const parsed = parseImport(text)
    if (!parsed.ok) {
      setImportIssues(parsed.issues)
      return
    }
    try {
      await api.presets.create({
        params: { projectId },
        body: {
          name: parsed.file.name,
          priority: parsed.file.priority,
          rules: parsed.file.rules,
          isEnabled: false,
        },
      })
      await queryClient.invalidateQueries({ queryKey: qk.project(projectId).presets })
      setNotice({
        kind: 'ok',
        text: `Imported "${parsed.file.name}" (disabled; switch it on to use it).`,
      })
    } catch (error) {
      setImportIssues([isApiError(error) ? error.message : 'The server rejected the preset.'])
    }
  }

  const loading = project.isPending || !workspace || (projectId !== undefined && presets.isPending)
  const items = presets.data?.items ?? []

  return (
    <Editor>
      <Card data-screen="presets/PresetsScreen">
        <PanelHead>
          <h3 className="m-0 text-body font-semibold">Presets</h3>
          <span className="flex-1" />
          {canEdit && projectId ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setTemplates(true)}>
                <LayoutTemplate aria-hidden className="size-3.5" />
                Add from template
              </Button>
              <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
                <FileUp aria-hidden className="size-3.5" />
                Import
              </Button>
              <Button size="sm" onClick={() => setEditing({ preset: null })}>
                <Plus aria-hidden className="size-3.5" />
                New preset
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                aria-label="Import preset file"
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => void onFile(e)}
              />
            </>
          ) : null}
        </PanelHead>
        <PanelBody>
          <p className="m-0 mb-3 text-small text-ink-2">
            Presets pick the value of fields by name instead of by chance. When several rules match
            one field, the most specific wins: path, then key, then key glob, then type. Ties go to
            the higher priority, then the later rule.
          </p>
          {!canEdit && workspace ? (
            <p className="m-0 mb-3 text-small text-ink-2">
              You have view access to this workspace, so presets are read-only.
            </p>
          ) : null}
          {importIssues ? (
            <div role="alert" className="mb-3 rounded-lg border border-bad p-3">
              <p className="m-0 text-small font-semibold text-bad">
                Nothing was imported. Fix these and try again.
              </p>
              <ul className="mono m-0 mt-1 list-disc pl-5 text-small text-ink-2">
                {importIssues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {notice ? (
            <p
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={`m-0 mb-3 text-small ${notice.kind === 'error' ? 'text-bad' : 'text-good'}`}
            >
              {notice.text}
            </p>
          ) : null}

          {loading ? (
            <div className="grid place-items-center py-10">
              <Spinner label="Loading presets" />
            </div>
          ) : project.isError || presets.isError ? (
            <EmptyState
              title="Could not load presets"
              description="Reload the page to try again."
            />
          ) : items.length === 0 ? (
            <EmptyState
              title="No presets yet"
              description="Start from a template or add your own rules."
            />
          ) : (
            <Table aria-label="Presets">
              <THead>
                <tr>
                  <Th>Name</Th>
                  <Th>Rules</Th>
                  <Th>Priority</Th>
                  <Th>Enabled</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {items.map((preset) => (
                  <Tr key={preset.id}>
                    <Td className="font-semibold">{preset.name}</Td>
                    <Td className="mono">{preset.rules.length}</Td>
                    <Td className="mono">{preset.priority}</Td>
                    <Td>
                      <EnableSwitch
                        preset={preset}
                        canEdit={canEdit}
                        onFailure={(text) => setNotice({ kind: 'error', text })}
                      />
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${canEdit ? 'Edit' : 'View'} ${preset.name}`}
                          onClick={() => setEditing({ preset })}
                        >
                          {canEdit ? 'Edit' : 'View'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Export ${preset.name}`}
                          onClick={() =>
                            download(
                              exportFileName(preset.name),
                              exportText({
                                name: preset.name,
                                priority: preset.priority,
                                rules: preset.rules,
                              }),
                            )
                          }
                        >
                          <Download aria-hidden className="size-3.5" />
                          Export
                        </Button>
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="border-bad text-bad"
                            aria-label={`Delete ${preset.name}`}
                            onClick={() => setDeleting(preset)}
                          >
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </PanelBody>
      </Card>

      {projectId ? (
        <>
          <PresetEditor
            projectId={projectId}
            target={editing}
            readOnly={!canEdit}
            onClose={() => setEditing(null)}
          />
          <TemplateDialog projectId={projectId} open={templates} onOpenChange={setTemplates} />
          <DeleteDialog preset={deleting} onClose={() => setDeleting(null)} />
        </>
      ) : null}
    </Editor>
  )
}
