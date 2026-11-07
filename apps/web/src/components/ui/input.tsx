import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from './cn'
import { useFieldControlProps } from './field'

const controlBase =
  'w-full rounded-sm border border-line-strong bg-panel-2 text-ink transition-ui disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-bad'

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Mono font, for keys, paths and values. */
  mono?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, mono, ...props },
  ref,
) {
  const field = useFieldControlProps()
  return (
    <input
      ref={ref}
      className={cn(controlBase, 'px-2.75 py-2.25 text-control', mono && 'mono', className)}
      {...field}
      {...props}
    />
  )
})

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }
>(function Textarea({ className, mono, ...props }, ref) {
  const field = useFieldControlProps()
  return (
    <textarea
      ref={ref}
      className={cn(
        controlBase,
        'min-h-20 px-2.75 py-2.25 text-control',
        mono && 'mono',
        className,
      )}
      {...field}
      {...props}
    />
  )
})

/** Native <select> restyled: accessible, form-friendly and cheap to render hundreds of times in the builder. */
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { mono?: boolean; wrapperClassName?: string }
>(function Select({ className, wrapperClassName, mono, children, ...props }, ref) {
  const field = useFieldControlProps()
  return (
    <span className={cn('relative inline-flex w-full', wrapperClassName)}>
      <select
        ref={ref}
        className={cn(
          controlBase,
          'appearance-none py-1.75 pl-2.25 pr-7 text-compact',
          mono && 'mono',
          className,
        )}
        {...field}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3"
      />
    </span>
  )
})
