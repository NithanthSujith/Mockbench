import { createContext, useContext, useId, type ReactNode } from 'react'
import { cn } from './cn'

type FieldContextValue = { id: string; errorId: string; hasError: boolean }
const FieldContext = createContext<FieldContextValue | null>(null)

/** Controls placed inside a <Field> pick up their id, aria-describedby and aria-invalid from it. */
export function useFieldControlProps(): {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: true
} {
  const ctx = useContext(FieldContext)
  if (!ctx) return {}
  return {
    id: ctx.id,
    ...(ctx.hasError ? { 'aria-describedby': ctx.errorId, 'aria-invalid': true as const } : {}),
  }
}

export function Field({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: ReactNode
  error?: ReactNode
  hint?: ReactNode
  className?: string
  children: ReactNode
}) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <FieldContext.Provider value={{ id, errorId, hasError: Boolean(error) }}>
      <div className={cn('flex flex-col gap-1.25', className)}>
        <label htmlFor={id} className="text-small text-ink-2">
          {label}
        </label>
        {children}
        {hint && !error ? <p className="m-0 text-small text-ink-3">{hint}</p> : null}
        {error ? (
          <p id={errorId} role="alert" className="m-0 text-small text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}
