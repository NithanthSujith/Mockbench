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
import { deriveWorkspaceSlug, WS_SLUG_TAKEN, workspaceSlugProblem } from './slug'

function NewWorkspaceForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [rejected, setRejected] = useState<{ slug: string; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const trimmed = name.trim()
  const slugError =
    workspaceSlugProblem(slug) ?? (rejected?.slug === slug ? rejected.message : null)
  const canSubmit = trimmed.length > 0 && slug !== '' && !slugError && !submitting

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setFailure(null)
    try {
      const workspace = await api.workspaces.create({ body: { name: trimmed, slug } })
      await queryClient.invalidateQueries({ queryKey: qk.session() })
      await queryClient.invalidateQueries({ queryKey: qk.workspaces() })
      onDone()
      await navigate({ to: '/w/$wsSlug', params: { wsSlug: workspace.slug } })
    } catch (error) {
      if (isApiError(error) && error.code === 'slug_taken') {
        setRejected({ slug, message: WS_SLUG_TAKEN })
      } else {
        setFailure(isApiError(error) ? error.message : 'Could not create the workspace.')
      }
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Name">
        <Input
          value={name}
          maxLength={80}
          autoFocus
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value)
            if (!slugEdited) setSlug(deriveWorkspaceSlug(e.target.value))
          }}
        />
      </Field>
      <Field label="Slug" error={slugError}>
        <Input
          mono
          value={slug}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setSlug(e.target.value)
            setSlugEdited(true)
          }}
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
          Create workspace
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Name + live-derived, editable slug. On success: closes, refreshes the lists, opens the workspace. */
export function NewWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create workspace">
        {open ? <NewWorkspaceForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}
