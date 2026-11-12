import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
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
import { invalidateRouteSummaries } from './queries'

/** "New case", then "New case 2", "New case 3" ... first name no existing case has (case-insensitive). */
export function uniqueCaseName(existing: readonly string[], base = 'New case'): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

function NewCaseForm({
  projectId,
  routeId,
  existingNames,
  onCreated,
}: {
  projectId: string
  routeId: string
  existingNames: readonly string[]
  onCreated: (caseId: string) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(() => uniqueCaseName(existingNames))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (name.trim() === '') {
      setError('Give the case a name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await api.cases.create({
        params: { routeId },
        body: { name, statusCode: 200 },
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.route(projectId, routeId).cases }),
        invalidateRouteSummaries(queryClient, projectId, routeId),
      ])
      onCreated(created.id)
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not create the case.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Name" error={error}>
        <Input
          value={name}
          autoFocus
          autoComplete="off"
          maxLength={60}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
        />
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          Create case
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The "+ Case" dialog. The form unmounts on close, so every open proposes a fresh unique name. */
export function NewCaseDialog({
  projectId,
  routeId,
  existingNames,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string
  routeId: string
  existingNames: readonly string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (caseId: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New response case"
        description="Starts as a 200 response with an empty object body."
      >
        <NewCaseForm
          projectId={projectId}
          routeId={routeId}
          existingNames={existingNames}
          onCreated={(id) => {
            onOpenChange(false)
            onCreated(id)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
