import { Check, ChevronDown } from 'lucide-react'
import { DropdownMenu as Menu } from 'radix-ui'
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from './cn'

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger

/** The topbar switcher button: label plus a caret. Use as `<DropdownMenuTrigger asChild>`. */
export const DropdownButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'> & { children: ReactNode }
>(function DropdownButton({ className, children, type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center gap-1.75 rounded-md border border-line-strong bg-panel-2 px-2.5 py-1.5 text-control transition-ui hover:border-ink-3 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown aria-hidden className="size-3 text-ink-3" />
    </button>
  )
})

export function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-40 min-w-60 rounded-lg border border-line-strong bg-panel p-1.25 shadow-menu max-narrow:min-w-50',
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  )
}

export function DropdownMenuItem({
  className,
  selected,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Item> & { selected?: boolean }) {
  return (
    <Menu.Item
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.25 py-1.75 text-left text-control outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-panel-2',
        className,
      )}
      {...props}
    >
      {children}
      {selected ? <Check aria-label="Selected" className="ml-auto size-3 text-ink-3" /> : null}
    </Menu.Item>
  )
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Label>) {
  return <Menu.Label className={cn('eyebrow px-2.25 pb-1 pt-1.75', className)} {...props} />
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('my-1.25 h-px bg-line', className)} {...props} />
}
