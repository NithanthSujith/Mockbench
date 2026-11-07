import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

export const buttonVariants = cva(
  'inline-flex items-center gap-1.75 whitespace-nowrap rounded-md border border-transparent font-semibold transition-ui disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-btn text-btn-ink hover:opacity-90',
        ghost: 'border-line-strong bg-panel text-ink hover:bg-panel-2',
        dashed:
          'w-full justify-center border-dashed border-line-strong bg-transparent font-medium text-ink-2 hover:border-solid hover:bg-panel-2 hover:text-ink',
      },
      size: {
        md: 'px-3.25 py-1.75 text-control',
        sm: 'px-2.5 py-1 text-compact',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
})
