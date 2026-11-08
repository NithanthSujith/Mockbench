import { Link } from '@tanstack/react-router'
import { Card, EmptyState } from '../components/ui'
import { SoloShell } from './columns'
import { Topbar } from './topbar'

/** The message itself, for use where a topbar is already on screen. */
export function NotFoundBody() {
  return (
    <SoloShell data-screen="shell/NotFound">
      <Card>
        <EmptyState
          title="Page not found"
          description="There is nothing at this address, or you do not have access to it."
          action={
            <Link to="/" className="text-control text-info hover:underline">
              Go to the start page
            </Link>
          }
        />
      </Card>
    </SoloShell>
  )
}

/** Root not-found: a path no route matches, shown inside the shell (topbar included). */
export function NotFoundPage() {
  return (
    <>
      <Topbar />
      <NotFoundBody />
    </>
  )
}

/** Something threw while loading or rendering a route. */
export function ErrorBody({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Unknown error'
  return (
    <SoloShell data-screen="shell/Error">
      <Card>
        <EmptyState title="Something went wrong" description={message} />
      </Card>
    </SoloShell>
  )
}
