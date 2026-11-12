import type { MockSchema } from '@mockbench/schema-core'
import { useState } from 'react'
import { Segmented } from '../../components/ui'
import { nullValueFlags } from './InferPanel'
import { JsonTab, type JsonDraft } from './JsonTab'
import { SchemaBuilder, useBuilderStore, type SchemaBuilderProps } from './SchemaBuilder'
import type { NodeId } from './store'

type Tab = 'builder' | 'json'

/**
 * The schema editor: a `Builder | JSON` tab strip over two views of one store. The store lives here so
 * both tabs edit the same schema; the Builder emits its own debounced changes, the JSON tab emits when
 * valid text replaces the store.
 */
export function SchemaEditor({
  value,
  onChange,
  readOnly = false,
  sessionKey,
  debounceMs,
}: SchemaBuilderProps) {
  const store = useBuilderStore(value, sessionKey)
  const [tab, setTab] = useState<Tab>('builder')
  const [draft, setDraft] = useState<JsonDraft | null>(null)
  const [flags, setFlags] = useState<Record<NodeId, string>>({})

  const commit = (schema: MockSchema) => {
    setFlags({})
    onChange(schema)
  }

  return (
    <div data-screen="schema-builder/SchemaEditor">
      <div className="flex items-center px-3.75 pt-2">
        <Segmented
          label="Schema view"
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          items={[
            { value: 'builder', label: 'Builder' },
            { value: 'json', label: 'JSON' },
          ]}
        />
      </div>
      {tab === 'builder' ? (
        <SchemaBuilder
          value={value}
          store={store}
          flags={flags}
          onChange={onChange}
          readOnly={readOnly}
          sessionKey={sessionKey}
          debounceMs={debounceMs}
        />
      ) : (
        <JsonTab
          store={store}
          readOnly={readOnly}
          draft={draft}
          onDraft={setDraft}
          onCommit={commit}
          onInfer={(result) => {
            store.getState().replaceAll(result.schema)
            setDraft(null)
            setFlags(nullValueFlags(store.getState().state, result))
            onChange(store.getState().toSchema())
            setTab('builder')
          }}
        />
      )}
    </div>
  )
}
