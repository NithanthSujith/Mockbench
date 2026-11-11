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
  Textarea,
} from '../../components/ui'
import { api } from '../../lib/api/client'
import { isApiError } from '../../lib/api/errors'
import { getMockBaseUrl } from '../../lib/mock-url'
import { qk } from '../../lib/query-keys'
import { deriveSlug, SLUG_TAKEN_MESSAGE, slugProblem } from './slug'

type Availability = { slug: string; state: 'taken' | 'free' }

function NewProjectForm({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [description, setDescription] = useState('')
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [rejected, setRejected] = useState<{ slug: string; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const format = slugProblem(slug)
  const takenKnown = availability?.slug === slug && availability.state === 'taken'
  const slugError =
    format ?? (rejected?.slug === slug ? rejected.message : takenKnown ? SLUG_TAKEN_MESSAGE : null)
  const trimmedName = name.trim()
  const canSubmit =
    trimmedName.length > 0 && trimmedName.length <= 80 && slug !== '' && !slugError && !submitting

  function changeName(value: string) {
    setName(value)
    if (!slugEdited) setSlug(deriveSlug(value))
  }

  // Availability on blur: a slug the caller can already read means it is in use. A 404 is also what a
  // project in a workspace the caller cannot see answers, so the 409 on submit stays the authority.
  async function checkAvailability() {
    if (slug === '' || slugProblem(slug)) return
    const checked = slug
    try {
      await api.projects.getBySlug({ params: { slug: checked } })
      setAvailability({ slug: checked, state: 'taken' })
    } catch (error) {
      if (isApiError(error) && error.status === 404)
        setAvailability({ slug: checked, state: 'free' })
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setFailure(null)
    try {
      const body = {
        workspaceId,
        name: trimmedName,
        slug,
        ...(description.trim() ? { description: description.trim() } : {}),
      }
      const project = await api.projects.create({ body })
      await queryClient.invalidateQueries({ queryKey: qk.projects(workspaceId) })
      onDone()
      await navigate({ to: '/p/$projectSlug', params: { projectSlug: project.slug } })
    } catch (error) {
      if (isApiError(error) && error.code === 'slug_taken') {
        setRejected({ slug, message: SLUG_TAKEN_MESSAGE })
      } else if (isApiError(error) && error.code === 'slug_reserved') {
        setRejected({ slug, message: `${slug} is reserved` })
      } else {
        setFailure(isApiError(error) ? error.message : 'Could not create the project.')
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
          onChange={(e) => changeName(e.target.value)}
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
          onBlur={checkAvailability}
        />
      </Field>
      <p className="m-0 text-small text-ink-3">
        The slug is the URL prefix and cannot be changed later.
      </p>
      <p className="m-0 text-small text-ink-2">
        Mock URL <span className="mono break-all text-ink">{getMockBaseUrl(slug || 'slug')}</span>
      </p>
      <Field label="Description (optional)">
        <Textarea
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
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
          Create project
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The new-project dialog. The form unmounts on close, so every open starts empty. */
export function NewProjectDialog({
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
        title="New project"
        description="A project holds your routes and response shapes, and serves them as a mock API."
      >
        <NewProjectForm workspaceId={workspaceId} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
