import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { parseRoutePath } from '@mockbench/api-contract'
import { useState, type FormEvent } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
  SelectItem,
} from '../../components/ui'
import { api } from '../../lib/api/client'
import { isApiError } from '../../lib/api/errors'
import { qk } from '../../lib/query-keys'

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
type Method = (typeof METHODS)[number]

type Conflict = { method: Method; path: string; routeId: string | null }

function NewRouteForm({
  projectId,
  projectSlug,
  onDone,
}: {
  projectId: string
  projectSlug: string
  onDone: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [method, setMethod] = useState<Method>('GET')
  const [path, setPath] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const parsed = path === '' ? null : parseRoutePath(path)
  const issue = parsed && !parsed.ok ? (parsed.issues[0]?.message ?? 'Invalid path.') : null
  const shownConflict = conflict?.method === method && conflict.path === path ? conflict : null
  const canSubmit = parsed?.ok === true && !shownConflict && !submitting

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setFailure(null)
    try {
      const route = await api.routes.create({ params: { projectId }, body: { method, path } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.project(projectId).routes }),
        queryClient.invalidateQueries({ queryKey: qk.projectBySlug(projectSlug) }),
      ])
      onDone()
      await navigate({
        to: '/p/$projectSlug/routes/$routeId',
        params: { projectSlug, routeId: route.id },
      })
    } catch (error) {
      if (isApiError(error) && error.code === 'route_conflict') {
        const first = error.details[0] as { routeId?: unknown } | undefined
        setConflict({
          method,
          path,
          routeId: typeof first?.routeId === 'string' ? first.routeId : null,
        })
      } else {
        setFailure(isApiError(error) ? error.message : 'Could not create the route.')
      }
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Method">
        <Select mono value={method} onValueChange={(v) => setMethod(v as Method)}>
          {METHODS.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </Select>
      </Field>
      <Field
        label="Path"
        hint="Use :name for a parameter, e.g. /invoices/:id"
        error={
          issue ??
          (shownConflict ? (
            <>
              A {shownConflict.method} route with this path already exists
              {shownConflict.routeId ? (
                <>
                  {' '}
                  <Link
                    to="/p/$projectSlug/routes/$routeId"
                    params={{ projectSlug, routeId: shownConflict.routeId }}
                    className="text-info underline"
                    onClick={onDone}
                  >
                    Open it
                  </Link>
                </>
              ) : null}
            </>
          ) : null)
        }
      >
        <Input
          mono
          value={path}
          placeholder="/invoices/:id"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setPath(e.target.value)}
        />
      </Field>
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
          Create route
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The new-route dialog. The form unmounts on close, so every open starts empty. */
export function NewRouteDialog({
  projectId,
  projectSlug,
  open,
  onOpenChange,
}: {
  projectId: string
  projectSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New route"
        description="Creates the route with a default 200 response case."
      >
        <NewRouteForm
          projectId={projectId}
          projectSlug={projectSlug}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
