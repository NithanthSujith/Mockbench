import type { HTMLAttributes } from 'react'
import { cn } from './cn'

// Class names are written out in full so Tailwind can see them.
const METHOD_STYLES: Record<string, string> = {
  GET: 'text-m-get bg-m-get/13',
  POST: 'text-m-post bg-m-post/13',
  PUT: 'text-m-put bg-m-put/13',
  PATCH: 'text-m-patch bg-m-patch/13',
  DELETE: 'text-m-delete bg-m-delete/13',
}

export function MethodBadge({
  method,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { method: string }) {
  const m = method.toUpperCase()
  return (
    <span
      className={cn(
        'mono inline-block min-w-12 shrink-0 rounded-xs px-1.25 py-0.75 text-center text-micro font-semibold tracking-[0.04em]',
        METHOD_STYLES[m] ?? 'text-ink-2 bg-ink-2/13',
        className,
      )}
      {...props}
    >
      {m}
    </span>
  )
}

export type StatusClass = '2xx' | '4xx' | '5xx'
export function statusClass(code: number): StatusClass {
  return code < 300 ? '2xx' : code < 500 ? '4xx' : '5xx'
}
const STATUS_STYLES: Record<StatusClass, string> = {
  '2xx': 'text-good bg-good/13',
  '4xx': 'text-warn bg-warn/14',
  '5xx': 'text-bad bg-bad/13',
}

export function StatusCode({
  code,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { code: number }) {
  const cls = statusClass(code)
  return (
    <span
      data-status-class={cls}
      className={cn(
        'mono rounded-xs px-1.25 py-px text-tiny font-semibold',
        STATUS_STYLES[cls],
        className,
      )}
      {...props}
    >
      {code}
    </span>
  )
}

export function LivePill({ className, children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-good/30 bg-good/12 px-2.25 py-1 text-tiny font-semibold text-good',
        className,
      )}
      {...props}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}
