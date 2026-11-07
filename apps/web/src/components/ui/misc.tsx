import { LoaderCircle } from 'lucide-react'
import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('eyebrow', className)} {...props} />
}

/** Code block: mono on the slab surface. */
export function Slab({ className, ...props }: HTMLAttributes<HTMLPreElement>) {
  return (
    <pre
      className={cn(
        'mono m-0 overflow-auto rounded-lg border border-slab-line bg-slab px-3.75 py-3.25 text-compact leading-[1.65] text-ink-2',
        className,
      )}
      {...props}
    />
  )
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <LoaderCircle aria-hidden className={cn('size-4 animate-spin text-ink-3', className)} />
    </span>
  )
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-8 text-center', className)}>
      <p className="m-0 text-body font-semibold text-ink">{title}</p>
      {description ? (
        <p className="m-0 max-w-prose text-control text-ink-2">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

/** Radio or checkbox presented as a selectable card (project settings options). */
export function OptionCard({
  title,
  description,
  className,
  type = 'radio',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'title'> & {
  title: ReactNode
  description?: ReactNode
  type?: 'radio' | 'checkbox'
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-2.75 py-2.25 hover:bg-panel-2 has-checked:border-signal-line has-checked:bg-signal-soft has-disabled:cursor-not-allowed has-disabled:opacity-50',
        className,
      )}
    >
      <input type={type} className="mt-0.75 accent-signal" {...props} />
      <span>
        <span className="block text-control font-semibold">{title}</span>
        {description ? (
          <span className="block text-small leading-snug text-ink-2">{description}</span>
        ) : null}
      </span>
    </label>
  )
}
