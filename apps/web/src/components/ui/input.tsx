import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
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
