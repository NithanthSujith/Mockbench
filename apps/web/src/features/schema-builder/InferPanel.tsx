import { inferSchema, type InferResult } from '@mockbench/schema-core'
import { TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Eyebrow, Textarea, cn } from '../../components/ui'
import { parseJson } from './json-text'
import { createBuilderStore, visibleRows, type BuilderState, type NodeId } from './store'

export const NULL_FLAG_MESSAGE = 'Real type unknown (was null)'

/** Node ids (in `state`) that an inference warning of code `null_value` points at. */
export function nullValueFlags(state: BuilderState, result: InferResult): Record<NodeId, string> {
  const flags: Record<NodeId, string> = {}
  for (const w of result.warnings) {
    if (w.code !== 'null_value') continue
    let id: NodeId | undefined = state.rootId
    const re = /\[\*\]|\.([^.[]+)/g
    const path = w.path.startsWith('$') ? w.path.slice(1) : w.path
    let consumed = 0
    for (let m = re.exec(path); m !== null && id !== undefined; m = re.exec(path)) {
      consumed = m.index + m[0].length
      const node: BuilderState['nodes'][string] | undefined = state.nodes[id]
      if (!node) {
        id = undefined
      } else if (m[0] === '[*]') {
        id = node.type === 'array' ? node.childIds[0] : undefined
      } else {
        id = node.childIds.find((c) => state.nodes[c]?.key === m[1])
      }
    }
    if (id !== undefined && consumed === path.length) flags[id] = NULL_FLAG_MESSAGE
  }
  return flags
}

const ROW_MONO = 'mono text-control'

export function InferPanel({
  onAccept,
  onCancel,
}: {
  onAccept: (result: InferResult) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [syntaxError, setSyntaxError] = useState<string | null>(null)
  const [result, setResult] = useState<InferResult | null>(null)

  const blocked = result?.warnings.some((w) => w.code === 'limits_exceeded') ?? false

  const run = () => {
    const parsed = parseJson(text)
    if (!parsed.ok) {
      setSyntaxError(parsed.error.message)
      setResult(null)
      return
    }
    setSyntaxError(null)
    setResult(inferSchema(parsed.value))
  }

  const preview = useMemo(() => {
    if (!result || blocked) return null
    const store = createBuilderStore(result.schema)
    const state = store.getState().state
    return { state, rows: visibleRows(state), flags: nullValueFlags(state, result) }
  }, [result, blocked])

  return (
    <div data-screen="schema-builder/InferPanel" className="flex flex-col gap-2.5 px-3.75 py-3">
      <p className="m-0 text-control text-ink-2">
        Paste an example response. The builder guesses a type for each value.
      </p>
      <Textarea
        aria-label="Example JSON"
        rows={8}
        spellCheck={false}
        className="mono text-control"
        placeholder='{"role": "admin", "tags": ["a", "b"]}'
        value={text}
        onChange={(e) => {
          setText(e.target.value)
        }}
      />
      {syntaxError ? (
        <p role="alert" className="m-0 text-control text-bad">
          {syntaxError}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={text.trim() === ''} onClick={run}>
          Infer schema
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {result ? (
        <div className="flex flex-col gap-2.5">
          <p
            role="note"
            className="m-0 flex items-center gap-1.5 rounded-sm border border-signal-line bg-signal-soft px-2.5 py-1.5 text-control text-ink"
          >
            <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warn" />
            Inference is a starting point — check the types.
          </p>

          {result.warnings.length > 0 ? (
            <ul aria-label="Inference warnings" className="m-0 flex list-none flex-col gap-1 p-0">
              {result.warnings.map((w, i) => (
                <li key={i} className="text-small text-ink-2">
                  <span className="mono text-ink">{w.path}</span> — {w.message}
                </li>
              ))}
            </ul>
          ) : null}

          {blocked ? (
            <p role="status" className="m-0 text-control text-ink-2">
              The current schema was not changed.
            </p>
          ) : preview ? (
            <>
              <Eyebrow>Inferred schema</Eyebrow>
              <div
                role="list"
                aria-label="Inferred fields"
                className="rounded-sm border border-line bg-slab py-1"
              >
                <div role="listitem" className={cn(ROW_MONO, 'px-3 py-0.75 text-ink-2')}>
                  root: {preview.state.nodes[preview.state.rootId]?.type}
                </div>
                {preview.rows.map((row) => {
                  const flag = preview.flags[row.id]
                  const node = preview.state.nodes[row.id]
                  const count = node?.attrs.count
                  return (
                    <div
                      key={row.id}
                      role="listitem"
                      data-flagged={flag ? 'true' : undefined}
                      className={cn(ROW_MONO, 'flex flex-wrap items-center gap-2 py-0.75 pr-3')}
                      style={{ paddingLeft: 12 + (row.depth + 1) * 16 }}
                    >
                      <span className="text-t-key">{row.key ?? '[ item ]'}</span>
                      <span className="text-ink-2">
                        {row.type}
                        {row.type === 'array' && typeof count === 'number' ? ` count ${count}` : ''}
                        {node?.attrs.nullable === true ? ' nullable' : ''}
                      </span>
                      {flag ? (
                        <span className="inline-flex items-center gap-1 text-tiny text-warn">
                          <TriangleAlert aria-hidden className="size-3" />
                          {flag}
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              <div>
                <Button size="sm" onClick={() => onAccept(result)}>
                  Use this schema
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
