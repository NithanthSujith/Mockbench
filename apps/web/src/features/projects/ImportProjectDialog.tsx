import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Field,
  Input,
} from '../../components/ui'
import { api } from '../../lib/api/client'
import { isApiError } from '../../lib/api/errors'
import { qk } from '../../lib/query-keys'
import {
  formatPath,
  issuesFromDetails,
  readProjectFile,
  type ImportIssue,
  type ReadFile,
} from './project-file'
import { SLUG_TAKEN_MESSAGE, slugProblem } from './slug'

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}

function IssueList({ issues }: { issues: ImportIssue[] }) {
  return (
    <ul
      aria-label="Problems found in the file"
      className="m-0 flex max-h-60 list-none flex-col gap-2 overflow-auto p-0"
    >
      {issues.map((issue, i) => (
        <li key={i} className="text-small">
          <span className="mono break-all text-bad">{formatPath(issue.path)}</span>{' '}
          <span className="mono text-ink-3">{issue.code}</span>
          <div className="text-ink-2">{issue.message}</div>
        </li>
      ))}
    </ul>
  )
}

function ImportForm({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [fileName, setFileName] = useState<string | null>(null)
  const [file, setFile] = useState<ReadFile | null>(null)
  const [issues, setIssues] = useState<ImportIssue[]>([])
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugError, setSlugError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0]
    setFile(null)
    setIssues([])
    setFailure(null)
    setSlugError(null)
    if (!chosen) return
    setFileName(chosen.name)
    try {
      const result = readProjectFile(await readText(chosen))
      if (!result.ok) {
        setIssues(result.issues)
        return
      }
      setFile(result.file)
      setName(result.file.name)
      setSlug(result.file.slug)
    } catch {
      setIssues([{ path: [], code: 'unreadable', message: 'The file could not be read.' }])
    }
  }

  const format = slugProblem(slug)
  const trimmedName = name.trim()
  const canSubmit =
    file !== null &&
    trimmedName.length > 0 &&
    trimmedName.length <= 80 &&
    slug !== '' &&
    !format &&
    !slugError &&
    !submitting

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file || !canSubmit) return
    setSubmitting(true)
    setFailure(null)
    setIssues([])
    try {
      const project = await api.projects.import({
        body: {
          workspaceId,
          // The document is checked by the server; the typed body only names its shape.
          document: file.document as never,
          slug,
          name: trimmedName,
        },
      })
      await queryClient.invalidateQueries({ queryKey: qk.projects(workspaceId) })
      onDone()
      await navigate({ to: '/p/$projectSlug', params: { projectSlug: project.slug } })
    } catch (error) {
      if (isApiError(error) && error.code === 'slug_taken') setSlugError(SLUG_TAKEN_MESSAGE)
      else if (isApiError(error) && error.code === 'slug_reserved') {
        setSlugError(`${slug} is reserved`)
      } else if (isApiError(error) && (error.code === 'import_invalid' || error.status === 422)) {
        const found = issuesFromDetails(error.details)
        if (found.length > 0) setIssues(found)
        else setFailure(error.message)
      } else {
        setFailure(isApiError(error) ? error.message : 'Could not import the project.')
      }
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Project file">
        <input
          type="file"
          accept=".json,application/json"
          aria-label="Project file"
          onChange={(e) => void choose(e)}
          className="text-small text-ink-2"
        />
      </Field>
      {file ? (
        <>
          <p className="m-0 text-small text-ink-2">
            <span className="mono text-ink">{fileName}</span>: {file.routeCount} route
            {file.routeCount === 1 ? '' : 's'}, {file.caseCount} case
            {file.caseCount === 1 ? '' : 's'}.
          </p>
          <Field label="Name">
            <Input
              value={name}
              maxLength={80}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Slug" error={format ?? slugError}>
            <Input
              mono
              value={slug}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setSlug(e.target.value)
                setSlugError(null)
              }}
            />
          </Field>
          {file.warnings.length > 0 ? (
            <ul aria-label="Warnings" className="m-0 list-none p-0 text-small text-warn">
              {file.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {issues.length > 0 ? (
        <div role="alert" className="flex flex-col gap-1">
          <p className="m-0 text-small font-semibold text-bad">
            {issues.length} problem{issues.length === 1 ? '' : 's'} in the file. Nothing was
            imported.
          </p>
          <IssueList issues={issues} />
        </div>
      ) : null}
      {failure ? (
        <p role="alert" className="m-0 text-small text-bad">
          {failure}
        </p>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={!canSubmit}>
          Import project
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The import dialog. The form unmounts on close, so every open starts empty. */
export function ImportProjectDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Import project"
        description="Create a new project from a .mockbench.json file exported from Mockbench."
      >
        <ImportForm workspaceId={workspaceId} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
