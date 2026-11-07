import { X } from 'lucide-react'
import { Dialog as Dlg } from 'radix-ui'
import type { ComponentPropsWithoutRef, HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'
import { IconButton } from './icon-button'

export const Dialog = Dlg.Root
export const DialogTrigger = Dlg.Trigger
export const DialogClose = Dlg.Close

/** Modal with a required accessible title. Focus is trapped and restored to the trigger on close. */
export function DialogContent({
  title,
  description,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Dlg.Content>, 'title'> & {
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <Dlg.Portal>
      <Dlg.Overlay className="fixed inset-0 z-40 bg-bg/70" />
      <Dlg.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line-strong bg-panel p-4 shadow-menu',
          className,
        )}
        {...props}
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Dlg.Title className="m-0 text-body font-semibold">{title}</Dlg.Title>
            {description ? (
              <Dlg.Description className="mt-1 text-control text-ink-2">
                {description}
              </Dlg.Description>
            ) : (
              <Dlg.Description className="sr-only">{title}</Dlg.Description>
            )}
          </div>
          <Dlg.Close asChild>
            <IconButton aria-label="Close" className="size-7 shrink-0">
              <X aria-hidden className="size-3.5" />
            </IconButton>
          </Dlg.Close>
        </div>
        {children}
      </Dlg.Content>
    </Dlg.Portal>
  )
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-4 flex flex-wrap justify-end gap-2', className)} {...props} />
}
