import { MAX_CASE_HEADERS, validateCaseHeaders } from '@mockbench/api-contract'
import { Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button, IconButton, Input } from '../../components/ui'

type Row = { key: number; name: string; value: string }

/** Rows to the headers object, plus an error message per row key (null when the set is valid). */
export function checkHeaderRows(rows: Row[]): {
  headers: Record<string, string>
  errors: Map<number, string>
} {
  const errors = new Map<number, string>()
  const headers: Record<string, string> = {}
  const seen = new Map<string, number>()
  for (const row of rows) {
    const name = row.name.trim()
    if (name === '' && row.value === '') continue
    if (name === '') {
      errors.set(row.key, 'Header name is required.')
      continue
    }
    const lower = name.toLowerCase()
    if (seen.has(lower)) {
      errors.set(row.key, `"${name}" is already set.`)
      continue
    }
    seen.set(lower, row.key)
    headers[name] = row.value
  }
  const byName = new Map(rows.map((r) => [r.name.trim(), r.key]))
  for (const issue of validateCaseHeaders(headers)) {
    const key = issue.path[0] === undefined ? undefined : byName.get(String(issue.path[0]))
    if (key !== undefined && !errors.has(key)) errors.set(key, issue.message)
    else if (key === undefined && issue.path.length === 0) errors.set(-1, issue.message)
  }
  return { headers, errors }
}

/**
 * Header rows for a case. Validates locally (reserved names, characters) and calls `onValid` only
 * with a header set that passes, so an invalid set is never sent. `onInvalid` fires otherwise.
 */
export function HeadersEditor({
  initial,
  disabled,
  onValid,
  onInvalid,
}: {
  initial: Record<string, string>
  disabled: boolean
  onValid: (headers: Record<string, string>) => void
  onInvalid: () => void
}) {
  const nextKey = useRef(0)
  const [rows, setRows] = useState<Row[]>(() =>
    Object.entries(initial).map(([name, value]) => ({ key: nextKey.current++, name, value })),
  )
  const { errors } = checkHeaderRows(rows)
  const general = errors.get(-1)

  function update(next: Row[]) {
    setRows(next)
    const result = checkHeaderRows(next)
    if (result.errors.size === 0) onValid(result.headers)
    else onInvalid()
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Response headers">
      {rows.map((row) => {
        const error = errors.get(row.key)
        return (
          <div key={row.key} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Input
                mono
                aria-label="Header name"
                aria-invalid={error ? true : undefined}
                placeholder="X-Header"
                value={row.name}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) =>
                  update(rows.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)))
                }
              />
              <Input
                mono
                aria-label="Header value"
                placeholder="value"
                value={row.value}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) =>
                  update(rows.map((r) => (r.key === row.key ? { ...r, value: e.target.value } : r)))
                }
              />
              <IconButton
                aria-label="Remove header"
                disabled={disabled}
                onClick={() => update(rows.filter((r) => r.key !== row.key))}
              >
                <X aria-hidden className="size-3.5" />
              </IconButton>
            </div>
            {error ? (
              <p role="alert" className="m-0 text-small text-bad">
                {error}
              </p>
            ) : null}
          </div>
        )
      })}
      {general ? (
        <p role="alert" className="m-0 text-small text-bad">
          {general}
        </p>
      ) : null}
      <div>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || rows.length >= MAX_CASE_HEADERS}
          onClick={() => setRows([...rows, { key: nextKey.current++, name: '', value: '' }])}
        >
          <Plus aria-hidden className="size-3.5" />
          Add header
        </Button>
      </div>
    </div>
  )
}
