import type { HTMLAttributes } from 'react'
import { cn } from '../components/ui'

// Layout primitives for the three-column project shell (prototype .shell / .rail / .editor / .resp).
// Screens compose these; the grid itself lives in ProjectShell and is chosen by the route's
// staticData (`shell: 'editor' | 'wide'`).

/** Left column: navigation + route list. Sticky on wide screens, in flow when narrow. */
export function Rail({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <aside
      data-column="rail"
      className={cn('sticky top-[66px] min-w-0 max-narrow:static', className)}
      {...props}
    />
  )
}

/** Middle column: the main content of the screen. */
export function Editor({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <main
      data-column="editor"
      className={cn('flex min-w-0 flex-col gap-4', className)}
      {...props}
    />
  )
}

/** Right column (route editor only): response preview and try-it. Drops below the editor under 1240px. */
export function Response({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <aside
      data-column="response"
      className={cn(
        'sticky top-[66px] flex min-w-0 flex-col gap-4 max-wide:static max-wide:col-span-full',
        className,
      )}
      {...props}
    />
  )
}

/** Single centred column for workspace-level pages (project list, members). */
export function SoloShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-column="solo"
      className={cn(
        'mx-auto flex w-full max-w-[1180px] min-w-0 flex-col gap-4 px-4 py-4',
        className,
      )}
      {...props}
    />
  )
}
