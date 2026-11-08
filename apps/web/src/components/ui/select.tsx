import { Check, ChevronDown } from 'lucide-react'
import { Select as S } from 'radix-ui'
import {
  createContext,
  forwardRef,
  useContext,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import { cn } from './cn'
import { useFieldControlProps } from './field'

const MonoContext = createContext(false)

export type SelectProps = {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Submitted with a surrounding <form>. */
  name?: string
  disabled?: boolean
  required?: boolean
  /** Shown while no value is selected. */
  placeholder?: string
  /** Mono font for the value and the options: use for methods, status codes, keys and paths. */
  mono?: boolean
  /** Classes for the trigger button. */
  className?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-describedby'?: string
  /** `SelectItem`s, optionally grouped with `SelectGroup`/`SelectLabel`/`SelectSeparator`. */
  children: ReactNode
}

/**
 * Themed select. Same trigger as the other form controls; the open list is a panel that matches
 * DropdownMenu (panel surface, strong border, menu shadow, highlighted row, check on the selected
 * option) instead of the operating system's native popup. Keyboard: Enter/Space/arrows open,
 * arrows move, Enter selects, Escape closes and returns focus, typing jumps to a matching option.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    value,
    defaultValue,
    onValueChange,
    open,
    defaultOpen,
    onOpenChange,
    name,
    disabled,
    required,
    placeholder,
    mono,
    className,
    children,
    ...triggerProps
  },
  ref,
) {
  const field = useFieldControlProps()
  return (
    <MonoContext.Provider value={Boolean(mono)}>
      <S.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        name={name}
        disabled={disabled}
        required={required}
      >
        <S.Trigger
          ref={ref}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-sm border border-line-strong bg-panel-2 py-1.75 pl-2.25 pr-2 text-left text-compact text-ink transition-ui hover:border-ink-3 data-placeholder:text-ink-3 data-[state=open]:border-ink-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-bad',
            mono && 'mono',
            className,
          )}
          {...field}
          {...triggerProps}
        >
          <S.Value placeholder={placeholder} />
          <S.Icon asChild>
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-ink-3" />
          </S.Icon>
        </S.Trigger>
        <S.Portal>
          <S.Content
            position="popper"
            sideOffset={4}
            collisionPadding={8}
            className="z-50 max-h-[min(18rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line-strong bg-panel shadow-menu"
          >
            <S.Viewport className="p-1.25">{children}</S.Viewport>
          </S.Content>
        </S.Portal>
      </S.Root>
    </MonoContext.Provider>
  )
})

export function SelectItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof S.Item>) {
  const mono = useContext(MonoContext)
  return (
    <S.Item
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.75 pl-2.25 pr-7 text-compact text-ink-2 outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-panel-2 data-highlighted:text-ink data-[state=checked]:text-ink',
        mono && 'mono',
        className,
      )}
      {...props}
    >
      <S.ItemText>{children}</S.ItemText>
      <S.ItemIndicator className="absolute right-2 inline-flex items-center">
        <Check aria-hidden className="size-3 text-ink-2" />
      </S.ItemIndicator>
    </S.Item>
  )
}

export const SelectGroup = S.Group

export function SelectLabel({ className, ...props }: ComponentPropsWithoutRef<typeof S.Label>) {
  return <S.Label className={cn('eyebrow px-2.25 pb-1 pt-1.75', className)} {...props} />
}

export function SelectSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof S.Separator>) {
  return <S.Separator className={cn('my-1.25 h-px bg-line', className)} {...props} />
}
