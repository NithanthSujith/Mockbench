import { Button, EmptyState } from '../../components/ui'

/**
 * Empty state for a signed-in user with no workspace. NOT ROUTED YET: which route renders it, and
 * the Create-workspace flow (workspaces.create), are open questions raised in the AUTH-03 PR.
 */
export function NoWorkspaceState({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      title="You aren't in any workspace yet"
      description="or ask an owner to add your email"
      action={<Button onClick={onCreate}>Create workspace</Button>}
    />
  )
}
