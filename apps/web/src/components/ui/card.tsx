import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('rounded-xl border border-line bg-panel', className)} {...props} />
}

/** Card header: title (h3) plus optional trailing controls. */
export function PanelHead({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2.25 border-b border-line px-3.5 py-3 [&_h3]:text-body [&_h3]:font-semibold',
        className,
      )}
      {...props}
    />
  )
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 px-3.5 py-3', className)} {...props} />
}
