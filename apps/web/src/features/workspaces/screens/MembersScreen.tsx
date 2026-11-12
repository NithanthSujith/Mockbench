import type { Member } from '@mockbench/api-contract'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  EmptyState,
  Field,
  Input,
  PanelHead,
  Select,
  SelectItem,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  cn,
} from '../../../components/ui'
import { isApiError } from '../../../lib/api/errors'
import { useCurrentWorkspace, useSessionState } from '../../projects/queries'
import {
  ROLES,
  useAddMember,
  useMembers,
  useRemoveMember,
  useUpdateMemberRole,
  type Role,
} from '../members-queries'

export const USER_NOT_FOUND = 'No account with that email — they need to register first'
export const ALREADY_MEMBER = 'Already a member'
export const LAST_OWNER = 'A workspace needs at least one owner'

const ROLE_STYLES: Record<Role, string> = {
  owner: 'bg-signal-soft text-signal',
  editor: 'bg-good/13 text-good',
  viewer: 'bg-ink-2/13 text-ink-2',
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      data-role={role}
      className={cn('rounded-xs px-1.25 py-px text-tiny font-semibold', ROLE_STYLES[role])}
    >
      {role}
    </span>
  )
}

const joined = (iso: string) => iso.slice(0, 10)

function mapMutationError(error: unknown): string {
  if (isApiError(error)) return error.code === 'last_owner' ? LAST_OWNER : error.message
  return 'Something went wrong.'
}

function AddMemberForm({ workspaceId }: { workspaceId: string }) {
  const add = useAddMember(workspaceId)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [problem, setProblem] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = email.trim()
    if (!trimmed || add.isPending) return
    setProblem(null)
    try {
      await add.mutateAsync({ email: trimmed, role })
      setEmail('')
    } catch (error) {
      if (isApiError(error) && error.code === 'user_not_found') setProblem(USER_NOT_FOUND)
      else if (isApiError(error) && error.code === 'already_member') setProblem(ALREADY_MEMBER)
      else setProblem(mapMutationError(error))
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Add member"
      className="flex flex-wrap items-start gap-3 border-t border-line p-3.5"
    >
      <Field label="Email" error={problem} className="min-w-56 flex-1">
        <Input
          mono
          type="email"
          value={email}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setEmail(e.target.value)
            setProblem(null)
          }}
        />
      </Field>
      <div className="flex flex-col gap-1.25">
        <span className="text-small text-ink-2">Role</span>
        <div className="w-36">
          <Select
            value={role}
            aria-label="New member role"
            onValueChange={(v) => setRole(v as Role)}
          >
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </Select>
        </div>
      </div>
      <Button type="submit" className="mt-6" disabled={email.trim() === '' || add.isPending}>
        Add member
      </Button>
    </form>
  )
}

type Pending = { member: Member; self: boolean }

function ConfirmRemoveDialog({
  pending,
  onCancel,
  onConfirm,
  busy,
}: {
  pending: Pending | null
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
}) {
  const who = pending?.member
  const description = !who
    ? undefined
    : pending.self
      ? 'Leave this workspace? You will lose access to its projects.'
      : `Remove ${who.name} (${who.email}) from this workspace?`
  return (
    <Dialog open={pending !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        title={pending?.self ? 'Leave workspace' : 'Remove member'}
        description={description}
      >
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={onConfirm} disabled={busy}>
            {pending?.self ? 'Leave' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** /w/$wsSlug/members: owners manage roles; everyone else reads and may leave. */
export function MembersScreen() {
  const navigate = useNavigate()
  const session = useSessionState()
  const { workspace, loading } = useCurrentWorkspace()
  const members = useMembers(workspace?.id)
  const update = useUpdateMemberRole(workspace?.id ?? '')
  const remove = useRemoveMember(workspace?.id ?? '')
  const [pending, setPending] = useState<Pending | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const shell = (children: ReactNode) => (
    <div data-screen="workspaces/MembersScreen" className="min-w-0">
      {children}
    </div>
  )

  if (loading || (workspace && !members.data && !members.isError)) {
    return shell(
      <Card className="grid place-items-center p-8">
        <Spinner label="Loading members" />
      </Card>,
    )
  }
  if (!workspace) {
    return shell(
      <Card>
        <EmptyState
          title="Workspace not found"
          description="It may not exist, or you may not be a member of it."
        />
      </Card>,
    )
  }
  if (members.isError || !members.data) {
    return shell(
      <Card>
        <EmptyState
          title="Could not load members"
          description={members.error?.message}
          action={
            <Button variant="ghost" onClick={() => void members.refetch()}>
              Try again
            </Button>
          }
        />
      </Card>,
    )
  }

  const isOwner = workspace.role === 'owner'
  const meId = session.data?.user.id
  const items = members.data.items
  const me = items.find((m) => m.userId === meId)

  function changeRole(member: Member, role: Role) {
    setFailure(null)
    update.mutate(
      { memberId: member.id, role },
      { onError: (e) => setFailure(mapMutationError(e)) },
    )
  }

  function confirmRemove() {
    if (!pending || !workspace) return
    const { member, self } = pending
    setFailure(null)
    remove.mutate(
      { memberId: member.id, self },
      {
        onSuccess: () => {
          setPending(null)
          if (!self) return
          const other = session.data?.workspaces.find((w) => w.id !== workspace.id)
          if (other) void navigate({ to: '/w/$wsSlug', params: { wsSlug: other.slug } })
          else void navigate({ to: '/welcome' })
        },
        onError: (e) => {
          setPending(null)
          setFailure(mapMutationError(e))
        },
      },
    )
  }

  return shell(
    <Card>
      <PanelHead>
        <h3>Members of {workspace.name}</h3>
        <span className="text-small text-ink-2">{items.length}</span>
        {me ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setPending({ member: me, self: true })}
          >
            Leave workspace
          </Button>
        ) : null}
      </PanelHead>
      {failure ? (
        <p role="alert" className="m-0 border-b border-line px-3.5 py-2 text-small text-bad">
          {failure}
        </p>
      ) : null}
      <Table aria-label="Members">
        <THead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th>Joined</Th>
            {isOwner ? <Th className="text-right">Actions</Th> : null}
          </tr>
        </THead>
        <TBody>
          {items.map((m) => (
            <Tr key={m.id}>
              <Td>{m.name}</Td>
              <Td className="mono">{m.email}</Td>
              <Td>
                {isOwner ? (
                  <div className="w-32">
                    <Select
                      value={m.role}
                      aria-label={`Role for ${m.name}`}
                      onValueChange={(v) => changeRole(m, v as Role)}
                    >
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                ) : (
                  <RoleBadge role={m.role} />
                )}
              </Td>
              <Td className="text-ink-2">{joined(m.createdAt)}</Td>
              {isOwner ? (
                <Td className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${m.name}`}
                    onClick={() => setPending({ member: m, self: m.userId === meId })}
                  >
                    Remove
                  </Button>
                </Td>
              ) : null}
            </Tr>
          ))}
        </TBody>
      </Table>
      {isOwner ? <AddMemberForm workspaceId={workspace.id} /> : null}
      <ConfirmRemoveDialog
        pending={pending}
        busy={remove.isPending}
        onCancel={() => setPending(null)}
        onConfirm={confirmRemove}
      />
    </Card>,
  )
}
