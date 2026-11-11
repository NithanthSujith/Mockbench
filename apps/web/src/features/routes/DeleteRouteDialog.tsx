import { Button, Dialog, DialogClose, DialogContent, DialogFooter } from '../../components/ui'
import { useState } from 'react'
import { api } from '../../lib/api/client'
import { isApiError } from '../../lib/api/errors'

/** Confirmation naming `METHOD /path`. `onDeleted` runs after the server confirmed the deletion. */
export function DeleteRouteDialog({
  route,
  onClose,
  onDeleted,
}: {
  route: { id: string; method: string; path: string } | null
  onClose: () => void
  onDeleted: (routeId: string) => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function confirm() {
    if (!route) return
    setBusy(true)
    setFailure(null)
    try {
      await api.routes.delete({ params: { routeId: route.id } })
      await onDeleted(route.id)
      onClose()
    } catch (error) {
      setFailure(isApiError(error) ? error.message : 'Could not delete the route.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={route !== null}
      onOpenChange={(open) => {
        if (!open) {
          setFailure(null)
          onClose()
        }
      }}
    >
      {route ? (
        <DialogContent
          title="Delete route"
          description={
            <>
              Delete{' '}
              <span className="mono text-ink">
                {route.method} {route.path}
              </span>{' '}
              and all of its response cases? This cannot be undone. Published versions are not
              affected.
            </>
          }
        >
          {failure ? (
            <p role="alert" className="m-0 text-small text-bad">
              {failure}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={confirm} disabled={busy}>
              Delete route
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
