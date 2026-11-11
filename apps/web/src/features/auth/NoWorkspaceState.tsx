import { useState } from 'react'
import { Button, EmptyState } from '../../components/ui'
import { NewWorkspaceDialog } from '../workspaces/NewWorkspaceDialog'

/** Empty state for a signed-in user with no workspace. The dialog is owned by features/workspaces (WS-03). */
export function NoWorkspaceState() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <EmptyState
        title="You aren't in any workspace yet"
        description="or ask an owner to add your email"
        action={<Button onClick={() => setOpen(true)}>Create workspace</Button>}
      />
      <NewWorkspaceDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
