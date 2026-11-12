import { useRef, useState, type KeyboardEvent } from 'react'
import { Input } from '../../components/ui'

type DraftInputProps = {
  value: string
  /** Called with the draft on every change and with the original on Escape. May return the text to show. */
  onDraft: (text: string) => string | void
  disabled?: boolean
  className?: string
  type?: string
  min?: number
  max?: number
  placeholder?: string
  'aria-label': string
  'aria-invalid'?: boolean
  'data-node-input'?: string
}

/**
 * A text input that edits a draft and reports every change, so the store sees the edit live while the
 * field keeps whatever the user typed (e.g. a trailing comma in an enum list). Enter commits (blurs),
 * Escape puts back the value the field had when it got focus, blur drops the draft in favour of `value`.
 */
export function DraftInput({ value, onDraft, disabled, className, ...rest }: DraftInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const original = useRef(value)

  const apply = (text: string) => {
    const display = onDraft(text)
    setDraft(typeof display === 'string' ? display : text)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      apply(original.current)
      setDraft(null)
    }
  }

  return (
    <Input
      {...rest}
      mono
      disabled={disabled}
      className={className}
      value={draft ?? value}
      spellCheck={false}
      onFocus={() => {
        original.current = value
      }}
      onChange={(e) => apply(e.target.value)}
      onBlur={() => setDraft(null)}
      onKeyDown={onKeyDown}
    />
  )
}
