import type { ReactNode } from 'react'
import { Card, PanelBody, PanelHead, cn } from '../components/ui'

/**
 * Placeholder body of a screen that a feature team has not built yet (FND-13). Replace the whole
 * screen component; do not keep this. `data-screen` is what the route tests assert on.
 */
export function ScreenStub({
  area,
  name,
  unit,
  centered,
  children,
}: {
  /** The features/<area> directory that owns the screen. */
  area: string
  /** The screen component name. */
  name: string
  /** The work unit that replaces it, e.g. `AUTH-03`. */
  unit: string
  centered?: boolean
  children?: ReactNode
}) {
  return (
    <div
      data-screen={`${area}/${name}`}
      className={cn(
        centered && 'mx-auto grid min-h-[60vh] w-full max-w-sm place-items-center px-4',
      )}
    >
      <Card className="w-full">
        <PanelHead>
          <h3>{name}</h3>
          <span className="mono text-small text-ink-3">features/{area}</span>
        </PanelHead>
        <PanelBody className="flex flex-col gap-2 text-control text-ink-2">
          <p className="m-0">
            Stub screen from FND-13. <span className="mono">{unit}</span> replaces it.
          </p>
          {children}
        </PanelBody>
      </Card>
    </div>
  )
}
