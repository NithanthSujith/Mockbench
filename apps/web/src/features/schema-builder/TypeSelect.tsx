import { NODE_TYPES } from '@mockbench/schema-core'
import { Select, SelectItem } from '../../components/ui'

export function TypeSelect({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string
  label: string
  disabled: boolean
  onChange: (type: string) => void
}) {
  return (
    <Select
      mono
      value={value}
      disabled={disabled}
      aria-label={label}
      onValueChange={onChange}
      className="py-1.25 pl-2 text-small text-ink-2"
    >
      {NODE_TYPES.map((t) => (
        <SelectItem key={t} value={t}>
          {t}
        </SelectItem>
      ))}
    </Select>
  )
}
