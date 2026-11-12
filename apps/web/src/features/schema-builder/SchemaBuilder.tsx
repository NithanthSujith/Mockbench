import type { MockSchema } from '@mockbench/schema-core'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Eyebrow,
} from '../../components/ui'
import { BuilderRow } from './BuilderRow'
import { ExtraControl } from './ExtraControl'
import { recallCollapsed, rememberCollapsed } from './session'
import {
  createBuilderStore,
  previewTypeChange,
  visibleRows,
  type BuilderStore,
  type NodeId,
} from './store'
import { TypeSelect } from './TypeSelect'

/** Wait this long after the last edit before telling the editor, so a burst of typing is one change. */
export const EMIT_DEBOUNCE_MS = 250

export interface SchemaBuilderProps {
  value: MockSchema
  onChange: (schema: MockSchema) => void
  readOnly?: boolean
  /**
   * Identifies this editor for remembering collapsed nodes across a switch to another case and back.
   * Without it nothing is remembered.
   */
  sessionKey?: string
  debounceMs?: number
}

interface PendingTypeChange {
  id: NodeId
  type: string
  discarded: number
}

function useBuilderStore(value: MockSchema, sessionKey: string | undefined): BuilderStore {
  const [store] = useState(() => {
    const created = createBuilderStore(value)
    if (sessionKey) {
      for (const id of recallCollapsed(sessionKey)) {
        const node = created.getState().state.nodes[id]
        if (node && created.getState().state.expanded.has(id)) created.getState().toggleExpanded(id)
      }
    }
    return created
  })
  return store
}

/**
 * The Builder tab (BLD-07): the schema as an indented tree, one row per node, wired to the BLD-06 store.
 * The store is the source of truth once mounted; `value` seeds it (the editor remounts per case).
 */
export function SchemaBuilder({
  value,
  onChange,
  readOnly = false,
  sessionKey,
  debounceMs = EMIT_DEBOUNCE_MS,
}: SchemaBuilderProps) {
  const store = useBuilderStore(value, sessionKey)
  const state = useStore(store, (s) => s.state)
  const rows = useMemo(() => visibleRows(state), [state])
  const root = state.nodes[state.rootId]
  const [pending, setPending] = useState<PendingTypeChange | null>(null)
  const [focusId, setFocusId] = useState<NodeId | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Emit the schema, debounced, whenever the document (not just the expanded set) changes.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    if (readOnly) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let dirty = false
    const emit = () => {
      timer = undefined
      if (!dirty) return
      dirty = false
      onChangeRef.current(store.getState().toSchema())
    }
    const unsubscribe = store.subscribe((next, prev) => {
      if (next.state.nodes === prev.state.nodes && next.state.envelope === prev.state.envelope) {
        return
      }
      dirty = true
      clearTimeout(timer)
      timer = setTimeout(emit, debounceMs)
    })
    return () => {
      unsubscribe()
      clearTimeout(timer)
      emit()
    }
  }, [store, readOnly, debounceMs])

  useEffect(() => {
    if (focusId === null) return
    containerRef.current?.querySelector<HTMLInputElement>(`[data-node-input="${focusId}"]`)?.focus()
    setFocusId(null)
  }, [focusId, rows])

  const act = store.getState()

  const toggle = (id: NodeId) => {
    act.toggleExpanded(id)
    if (sessionKey) rememberCollapsed(sessionKey, store.getState().state)
  }

  const requestType = (id: NodeId, type: string) => {
    const preview = previewTypeChange(store.getState().state, id, type)
    if (!preview.changed) return
    if (preview.discardedNodes > 0) {
      setPending({ id, type, discarded: preview.discardedNodes })
      return
    }
    act.setType(id, type)
  }

  const add = (parentId: NodeId) => {
    const id = act.addField(parentId)
    if (id !== null) setFocusId(id)
  }

  if (!root) return null
  const emptyObject = root.type === 'object' && root.childIds.length === 0

  return (
    <div ref={containerRef} data-screen="schema-builder/SchemaBuilder" className="py-1.5">
      <div className="flex flex-wrap items-center gap-2 px-3.75 py-1.5">
        <Eyebrow>Root</Eyebrow>
        <div className="w-30">
          <TypeSelect
            value={root.type}
            label="Root type"
            disabled={readOnly}
            onChange={(t) => requestType(root.id, t)}
          />
        </div>
        <ExtraControl
          node={root}
          disabled={readOnly}
          onValues={(v) => act.setAttr(root.id, 'values', v)}
          onCount={(c) => act.setAttr(root.id, 'count', c)}
        />
        {root.type === 'object' && !emptyObject ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            aria-label="Add field to root"
            disabled={readOnly}
            onClick={() => add(root.id)}
          >
            <Plus aria-hidden className="size-3.5" />
            Add field
          </Button>
        ) : null}
      </div>

      {emptyObject ? (
        <div className="flex flex-col items-start gap-2 px-3.75 py-3">
          <p className="m-0 text-control text-ink-2">This case returns an empty body.</p>
          <Button size="sm" disabled={readOnly} onClick={() => add(root.id)}>
            <Plus aria-hidden className="size-3.5" />
            Add field
          </Button>
        </div>
      ) : (
        rows.map((row) => {
          const node = state.nodes[row.id]
          if (!node) return null
          return (
            <BuilderRow
              key={row.id}
              row={row}
              node={node}
              readOnly={readOnly}
              onToggle={toggle}
              onKey={act.setKey}
              onType={requestType}
              onValues={(id, v) => act.setAttr(id, 'values', v)}
              onCount={(id, c) => act.setAttr(id, 'count', c)}
              onAdd={add}
              onRemove={act.removeNode}
            />
          )
        })
      )}

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        {pending ? (
          <DialogContent
            title={`Switching to ${pending.type} discards ${pending.discarded} child ${
              pending.discarded === 1 ? 'field' : 'fields'
            }`}
            description="The nested fields are removed from this case's schema."
          >
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                className="bg-bad"
                onClick={() => {
                  act.setType(pending.id, pending.type)
                  setPending(null)
                }}
              >
                Discard
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  )
}
