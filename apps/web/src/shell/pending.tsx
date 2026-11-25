import { Spinner } from '../components/ui'

/**
 * Shown by the router while a route's loader is still fetching (after `defaultPendingMs`), in place of
 * the screen that is loading. Without it a slow load left a blank page or a blank editor column.
 */
export function PendingPage() {
  return (
    <div data-screen="shell/Pending" className="grid place-items-center px-4 py-16">
      <Spinner label="Loading" className="size-5" />
    </div>
  )
}
