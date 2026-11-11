import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  EmptyState,
  Field,
  Input,
} from '../../components/ui'
import { api } from '../../lib/api/client'
import { isApiError } from '../../lib/api/errors'
import { qk } from '../../lib/query-keys'

/**
 * Empty state for a signed-in user with no workspace. The Create-workspace dialog is kept inside
 * features/auth so it can move to WS-03 later.
 */
export function NoWorkspaceState() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  const create = useMutation({
    mutationFn: () => api.workspaces.create({ body: { name: name.trim() } }),
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: qk.session() })
      await queryClient.invalidateQueries({ queryKey: qk.workspaces() })
      setOpen(false)
      void navigate({ href: `/w/${encodeURIComponent(workspace.slug)}`, replace: true })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() && !create.isPending) create.mutate()
  }
  const error = create.error
    ? isApiError(create.error)
      ? create.error.message
      : 'Something went wrong. Try again.'
    : undefined

  return (
    <EmptyState
      title="You aren't in any workspace yet"
      description="or ask an owner to add your email"
      action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Create workspace</Button>
          </DialogTrigger>
          <DialogContent title="Create workspace">
            <form onSubmit={submit} noValidate>
              <Field label="Name" error={error}>
                <Input
                  name="name"
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <DialogFooter>
                <Button type="submit" disabled={create.isPending || !name.trim()}>
                  {create.isPending ? 'Creating' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    />
  )
}
