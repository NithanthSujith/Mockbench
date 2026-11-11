import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Textarea,
} from '../../components/ui'
import { api } from '../../lib/api/client'
import { isApiError } from '../../lib/api/errors'
import { useRefreshVersions } from './queries'

interface Offender {
  routeId: string
  method: string
  path: string
  caseId: string
  caseName: string
  message: string
}

/** Reads `publish_invalid` details defensively: one entry per offending case. */
function toOffenders(details: unknown[]): Offender[] {
  const out: Offender[] = []
  for (const d of details) {
    if (!d || typeof d !== 'object') continue
    const o = d as Record<string, unknown>
    if (typeof o.routeId !== 'string' || typeof o.caseId !== 'string') continue
    const issues = Array.isArray(o.issues) ? (o.issues as { message?: unknown }[]) : []
    const first = issues.find((i) => typeof i?.message === 'string')
    out.push({
      routeId: o.routeId,
      caseId: o.caseId,
      method: String(o.method ?? ''),
      path: String(o.path ?? ''),
      caseName: String(o.caseName ?? ''),
      message: first ? String(first.message) : 'Invalid response case.',
    })
  }
  return out
}

/**
 * Publish the draft, optionally deploying it straight away (two calls). If the publish worked but the
 * deploy did not, the dialog stays open on the published version and "Retry deploy" only deploys.
 */
export function PublishDialog({
  open,
  onOpenChange,
  projectId,
  projectSlug,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectSlug: string
}) {
  const refresh = useRefreshVersions()
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [deploy, setDeploy] = useState(true)
  const [busy, setBusy] = useState(false)
  const [labelError, setLabelError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [offenders, setOffenders] = useState<Offender[]>([])
  const [published, setPublished] = useState<{ id: string; label: string } | null>(null)

  function reset() {
    setLabel('')
    setNotes('')
    setDeploy(true)
    setBusy(false)
    setLabelError(null)
    setFailure(null)
    setOffenders([])
    setPublished(null)
  }

  function close() {
    onOpenChange(false)
    reset()
  }

  async function deployVersion(version: { id: string; label: string }) {
    try {
      await api.deploy.create({ params: { projectId }, body: { versionId: version.id } })
      await refresh(projectId, projectSlug)
      close()
    } catch {
      await refresh(projectId, projectSlug)
      setPublished(version)
    }
  }

  async function submit() {
    setBusy(true)
    setLabelError(null)
    setFailure(null)
    setOffenders([])
    try {
      if (published) {
        await deployVersion(published)
        return
      }
      const body: { label?: string; notes?: string } = {}
      if (label.trim()) body.label = label.trim()
      if (notes.trim()) body.notes = notes
      const version = await api.versions.publish({ params: { projectId }, body })
      if (deploy) {
        await deployVersion({ id: version.id, label: version.label })
      } else {
        await refresh(projectId, projectSlug)
        close()
      }
    } catch (error) {
      if (!isApiError(error)) setFailure('Could not publish.')
      else if (error.code === 'label_taken') setLabelError(error.message)
      else if (error.code === 'empty_project')
        setFailure('Add at least one route before publishing')
      else if (error.code === 'publish_invalid') {
        setOffenders(toOffenders(error.details))
        setFailure('Fix these response cases, then publish again.')
      } else setFailure(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title="Publish"
        description="Freeze every route and case into an immutable version."
      >
        {published ? (
          <p role="alert" className="m-0 text-control text-bad">
            Published <span className="mono">{published.label}</span>, but it could not be deployed
          </p>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <Field label="Label" error={labelError} hint="Optional. The server picks the next vN.">
              <Input
                mono
                value={label}
                maxLength={80}
                placeholder="v-next"
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
            <Field label="Notes">
              <Textarea value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-control">
              <input
                type="checkbox"
                checked={deploy}
                onChange={(e) => setDeploy(e.target.checked)}
              />
              Deploy immediately
            </label>
          </form>
        )}
        {failure ? (
          <p role="alert" className="m-0 mt-3 text-small text-bad">
            {failure}
          </p>
        ) : null}
        {offenders.length > 0 ? (
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
            {offenders.map((o) => (
              <li key={o.caseId} className="text-small">
                <Link
                  to="/p/$projectSlug/routes/$routeId/cases/$caseId"
                  params={{ projectSlug, routeId: o.routeId, caseId: o.caseId }}
                  onClick={close}
                  className="mono text-ink underline"
                >
                  {o.method} {o.path} › {o.caseName} — {o.message}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{published ? 'Close' : 'Cancel'}</Button>
          </DialogClose>
          <Button onClick={() => void submit()} disabled={busy}>
            {published ? 'Retry deploy' : deploy ? 'Publish and deploy' : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
