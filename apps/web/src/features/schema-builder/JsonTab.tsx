import type { MockSchema } from '@mockbench/schema-core'
import { useState } from 'react'
import { Button } from '../../components/ui'
import { InferPanel } from './InferPanel'
import { JsonEditor } from './JsonEditor'
import { checkSchemaText, prettySchema, type CheckResult } from './json-text'
import type { InferResult } from '@mockbench/schema-core'
import type { BuilderStore } from './store'

/** Text typed in the JSON tab that has not been accepted into the store, and why. */
export interface JsonDraft {
  text: string
  problem: Exclude<CheckResult, { ok: true }>
}

export interface JsonTabProps {
  store: BuilderStore
  readOnly?: boolean
  /** Unaccepted text, kept by the caller so it survives a switch of tabs. */
  draft: JsonDraft | null
  onDraft: (draft: JsonDraft | null) => void
  /** The JSON was valid and replaced the store: tell the editor (autosave). */
  onCommit: (schema: MockSchema) => void
  /** An inferred schema was accepted. */
  onInfer: (result: InferResult) => void
}

/**
 * The JSON tab (BLD-09): the full envelope as text. The text is parsed and validated when the editor
 * loses focus; only a valid schema replaces the store. A problem is shown and nothing else changes, so
 * nothing is emitted and nothing is saved.
 */
export function JsonTab({
  store,
  readOnly = false,
  draft,
  onDraft,
  onCommit,
  onInfer,
}: JsonTabProps) {
  const [inferring, setInferring] = useState(false)
  // Fixed for this mount: the editor owns its text after opening.
  const [initialText] = useState(() => draft?.text ?? prettySchema(store.getState().toSchema()))
  const problem = draft?.problem ?? null

  const handleBlur = (text: string) => {
    if (readOnly) return
    const checked = checkSchemaText(text)
    if (!checked.ok) {
      onDraft({ text, problem: checked })
      return
    }
    onDraft(null)
    const current = store.getState().toSchema()
    if (JSON.stringify(checked.schema) === JSON.stringify(current)) return
    store.getState().replaceAll(checked.schema)
    onCommit(store.getState().toSchema())
  }

  if (inferring) {
    return (
      <InferPanel
        onCancel={() => setInferring(false)}
        onAccept={(result) => {
          setInferring(false)
          onInfer(result)
        }}
      />
    )
  }

  return (
    <div data-screen="schema-builder/JsonTab">
      {!readOnly ? (
        <div className="flex items-center gap-2 px-3.75 py-1.5">
          <Button size="sm" variant="ghost" onClick={() => setInferring(true)}>
            Infer from example
          </Button>
          <span className="text-small text-ink-3">Changes apply when you click away.</span>
        </div>
      ) : null}
      <JsonEditor
        label="Schema JSON"
        initialText={initialText}
        readOnly={readOnly}
        errorAt={
          problem?.kind === 'syntax'
            ? { offset: problem.error.offset, message: problem.error.message }
            : null
        }
        onBlur={handleBlur}
      />
      {problem?.kind === 'syntax' ? (
        <p role="alert" className="mono m-0 px-3.75 py-2 text-control text-bad">
          {problem.error.message}
        </p>
      ) : null}
      {problem?.kind === 'schema' ? (
        <ul
          role="alert"
          aria-label="Schema problems"
          className="m-0 flex list-none flex-col gap-1 px-3.75 py-2 text-control text-bad"
        >
          {problem.issues.map((issue, i) => (
            <li key={i} className="mono">
              {issue.path} — {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? (
        <p className="m-0 px-3.75 pb-2 text-small text-ink-3">
          The Builder keeps the last valid schema until this is fixed.
        </p>
      ) : null}
    </div>
  )
}
