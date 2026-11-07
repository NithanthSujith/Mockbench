import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Required: icon-only controls need an accessible name. */
  'aria-label': string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-grid size-8 place-items-center rounded-md border border-line-strong bg-panel text-ink-2 transition-ui hover:bg-panel-2 hover:text-ink disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
})
