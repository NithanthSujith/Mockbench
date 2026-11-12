import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
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

interface Target {
  projectId: string
  slug: string
  workspaceId: string
  wsSlug: string
}

function DeleteForm({ projectId, slug, workspaceId, wsSlug }: Target) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (typed !== slug || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await api.projects.delete({ params: { projectId } })
    } catch (error) {
      setFailure(isApiError(error) ? error.message : 'Could not delete the project.')
      setBusy(false)
      return
    }
    queryClient.removeQueries({ queryKey: qk.project(projectId).all })
    queryClient.removeQueries({ queryKey: qk.projectBySlug(slug) })
    await queryClient.invalidateQueries({ queryKey: qk.projects(workspaceId) })
    await navigate({ to: '/w/$wsSlug', params: { wsSlug }, ignoreBlocker: true })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label={`Type ${slug} to confirm`}>
        <Input
          mono
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
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
        <Button
          type="submit"
          variant="ghost"
          className="border-bad text-bad"
          disabled={typed !== slug || busy}
        >
          Delete project
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Owner-only. The form unmounts on close, so every open starts with an empty confirmation. */
export function DeleteProjectDialog({
  open,
  onOpenChange,
  ...target
}: Target & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Delete project"
        description="This permanently deletes the project with its routes, cases, versions and request log. Consumers calling its mock URLs will get 404."
      >
        <DeleteForm {...target} />
      </DialogContent>
    </Dialog>
  )
}
