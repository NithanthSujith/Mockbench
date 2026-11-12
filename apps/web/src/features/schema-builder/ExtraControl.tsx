import { TriangleAlert } from 'lucide-react'
import { DraftInput } from './DraftInput'
import type { BuilderNode } from './store'

export const MAX_COUNT = 1000
export const LARGE_COUNT = 50

function parseValues(text: string): string[] {
  return text
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '')
}

/** Clamp typed text to a whole number in 0..1000, or null when it is not a number yet. */
export function clampCount(text: string): number | null {
  if (text.trim() === '') return null
  const n = Math.trunc(Number(text))
  if (!Number.isFinite(n)) return null
  return Math.min(MAX_COUNT, Math.max(0, n))
}

/** The type-specific cell: enum values, array count, object field count. Other types have none here. */
export function ExtraControl({
  node,
  disabled,
  onValues,
  onCount,
}: {
  node: BuilderNode
  disabled: boolean
  onValues: (values: string[]) => void
  onCount: (count: number) => void
}) {
  const name = node.key ?? 'root'
  if (node.type === 'enum') {
    const values = Array.isArray(node.attrs.values)
      ? (node.attrs.values as unknown[]).map(String)
      : []
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <DraftInput
          aria-label={`Enum values for ${name}`}
          placeholder="value, value, value"
          value={values.join(', ')}
          disabled={disabled}
          className="bg-transparent py-1.25 text-small text-ink-2"
          onDraft={(text) => {
            onValues(parseValues(text))
            return text
          }}
        />
      </div>
    )
  }
  if (node.type === 'array') {
    const count = typeof node.attrs.count === 'number' ? node.attrs.count : 1
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="mono inline-flex shrink-0 items-center gap-1 text-small text-ink-3">
          count
          <DraftInput
            aria-label={`Array length for ${name}`}
            type="number"
            min={0}
            max={MAX_COUNT}
            value={String(count)}
            disabled={disabled}
            className="w-16 bg-transparent py-1.25 text-small text-ink-2"
            onDraft={(text) => {
              const n = clampCount(text)
              if (n === null) return text
              onCount(n)
              return String(n)
            }}
          />
        </span>
        {count > LARGE_COUNT ? (
          <span className="inline-flex items-center gap-1 text-small text-warn" role="status">
            <TriangleAlert aria-hidden className="size-3" />
            large arrays slow the preview
          </span>
        ) : (
          <span className="text-small text-ink-3">items</span>
        )}
      </div>
    )
  }
  if (node.type === 'object') {
    const n = node.childIds.length
    return (
      <span className="text-small text-ink-3">
        {n} field{n === 1 ? '' : 's'}
      </span>
    )
  }
  return null
}
