import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core'
import type { MockNode, MockSchema } from '@mockbench/schema-core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Boxes, Plus } from 'lucide-react'
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
import {
  cyclicComponents,
  hasMinMaxConflict,
  refNodesNamed,
  rowIssues,
  subtreeNode,
} from './attr-utils'
import { BuilderRow } from './BuilderRow'
import {
  VIRTUALIZE_ABOVE,
  planDrop,
  planKeyMove,
  zoneAt,
  type DropZone,
  type KeyMove,
} from './drag'
import { ExtraControl } from './ExtraControl'
import { ManageComponentsDialog, type ComponentSource } from './ManageComponentsDialog'
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

/** First guess at a row's height before it is measured. */
const ROW_ESTIMATE_PX = 36

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
  /** A store owned by the caller (the editor shares one between the Builder and JSON tabs). */
  store?: BuilderStore
  /** Notes to show on rows by node id (the amber marker for inferred nulls). */
  flags?: Record<NodeId, string>
  /**
   * The project's components (BLD-10): what a `ref` can point at. Undefined while they load, in which
   * case no `unknown_ref` badge is shown.
   */
  components?: Record<string, MockNode>
  /** Saves the project's whole `components` map (one `projects.update`). Rejects with the server's error. */
  onSaveComponents?: (next: Record<string, MockNode>) => Promise<void>
}

interface PendingTypeChange {
  id: NodeId
  type: string
  discarded: number
}

export function useBuilderStore(
  value: MockSchema,
  sessionKey: string | undefined,
  external?: BuilderStore,
): BuilderStore {
  const [store] = useState(() => {
    if (external) return external
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
  store: externalStore,
  flags,
  components,
  onSaveComponents,
}: SchemaBuilderProps) {
  const store = useBuilderStore(value, sessionKey, externalStore)
  const state = useStore(store, (s) => s.state)
  const rows = useMemo(() => visibleRows(state), [state])
  const root = state.nodes[state.rootId]
  const [pending, setPending] = useState<PendingTypeChange | null>(null)
  const [focusId, setFocusId] = useState<NodeId | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [managing, setManaging] = useState(false)
  const [componentSource, setComponentSource] = useState<ComponentSource | null>(null)

  const envelopeComponents = state.envelope.components
  const known = useMemo(
    () =>
      components === undefined
        ? undefined
        : new Set([...Object.keys(envelopeComponents), ...Object.keys(components)]),
    [components, envelopeComponents],
  )
  const componentNames = useMemo(() => [...(known ?? [])], [known])
  const cyclic = useMemo(
    () => cyclicComponents({ ...envelopeComponents, ...components }),
    [components, envelopeComponents],
  )
  const conflict = useMemo(() => hasMinMaxConflict(state), [state])
  const conflictRef = useRef(conflict)
  conflictRef.current = conflict

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
      // min greater than max is invalid: hold the save until the row is fixed (the badge says why).
      if (conflictRef.current) return
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

  const virtualized = rows.length > VIRTUALIZE_ABOVE
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: virtualized ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
  })

  useEffect(() => {
    if (focusId === null) return
    const find = () =>
      containerRef.current?.querySelector<HTMLInputElement>(`[data-node-input="${focusId}"]`)
    const input = find()
    if (input) {
      input.focus()
      setFocusId(null)
      return
    }
    // A virtualised row that is out of the window is not in the DOM: scroll to it and look again.
    const index = rows.findIndex((r) => r.id === focusId)
    if (!virtualized || index < 0) {
      setFocusId(null)
      return
    }
    virtualizer.scrollToIndex(index)
    const frame = requestAnimationFrame(() => {
      find()?.focus()
      setFocusId(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusId, rows, virtualized, virtualizer])

  const act = store.getState()

  // Drag and drop (BLD-08). The indicator is computed on every move and applied on release.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [dragId, setDragId] = useState<NodeId | null>(null)
  const [hover, setHover] = useState<{ id: NodeId; zone: DropZone; ok: boolean } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const hoverRef = useRef(hover)
  hoverRef.current = hover

  const labelOf = (id: NodeId) => store.getState().state.nodes[id]?.key ?? 'item'

  const onDragMove = (event: DragMoveEvent) => {
    const { active, over, delta, activatorEvent } = event
    if (!over) return setHover(null)
    const y = (activatorEvent as PointerEvent).clientY + delta.y
    const overNode = store.getState().state.nodes[String(over.id)]
    const zone = zoneAt(over.rect.top, over.rect.height, y, overNode?.type === 'object')
    const plan = planDrop(store.getState().state, String(active.id), String(over.id), zone)
    const next = plan ? { id: String(over.id), zone, ok: plan.ok } : null
    const prev = hoverRef.current
    if (prev?.id === next?.id && prev?.zone === next?.zone && prev?.ok === next?.ok) return
    setHover(next)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const current = hoverRef.current
    setDragId(null)
    setHover(null)
    if (!current || !current.ok) return
    const activeId = String(event.active.id)
    const plan = planDrop(store.getState().state, activeId, current.id, current.zone)
    if (!plan?.ok || !act.moveNode(activeId, plan.parentId, plan.index)) return
    const where = current.zone === 'inside' ? 'into' : current.zone
    setAnnouncement(`moved ${labelOf(activeId)} ${where} ${labelOf(current.id)}`)
    setFocusId(activeId)
  }

  const moveByKey = (id: NodeId, move: KeyMove) => {
    const plan = planKeyMove(store.getState().state, id, move)
    if (!plan || !act.moveNode(id, plan.parentId, plan.index)) return
    setAnnouncement(plan.message)
    setFocusId(id)
  }

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
    applyType(id, type)
  }

  const applyType = (id: NodeId, type: string) => {
    act.setType(id, type)
    // A new ref starts on the first component, so it never begins as an unresolved ref.
    if (type === 'ref' && componentNames[0] !== undefined)
      act.setAttr(id, 'name', componentNames[0])
  }

  const add = (parentId: NodeId) => {
    const id = act.addField(parentId)
    if (id !== null) setFocusId(id)
  }

  const saveAsComponent = (id: NodeId) => {
    const node = store.getState().state.nodes[id]
    const suggested = (node?.key ?? 'Component').replace(/[^A-Za-z0-9_]/g, '_')
    const base = /^[A-Za-z]/.test(suggested) ? suggested : `C_${suggested}`
    const name = base.charAt(0).toUpperCase() + base.slice(1)
    setComponentSource({ node: subtreeNode(store.getState().state, id), suggestedName: name })
    setManaging(true)
  }

  const renamed = (from: string, to: string): number => {
    const ids = refNodesNamed(store.getState().state, from)
    for (const id of ids) act.setAttr(id, 'name', to)
    return ids.length
  }

  const renderRow = (row: (typeof rows)[number]) => {
    const node = state.nodes[row.id]
    if (!node) return null
    return (
      <BuilderRow
        key={row.id}
        row={row}
        node={node}
        flag={flags?.[row.id]}
        readOnly={readOnly}
        onToggle={toggle}
        onKey={act.setKey}
        onType={requestType}
        onValues={(id, v) => act.setAttr(id, 'values', v)}
        onCount={(id, c) => act.setAttr(id, 'count', c)}
        onAdd={add}
        onRemove={act.removeNode}
        onAttr={act.setAttr}
        componentNames={componentNames}
        issues={rowIssues(node, known, cyclic)}
        onSaveAsComponent={
          components !== undefined && onSaveComponents ? saveAsComponent : undefined
        }
        dragEnabled={!readOnly}
        drop={hover?.id === row.id ? hover : undefined}
        onMoveKey={moveByKey}
      />
    )
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
          componentNames={componentNames}
          onRefName={(n) => act.setAttr(root.id, 'name', n)}
        />
        {conflict ? (
          <span role="status" className="text-small text-bad">
            Saving is paused until min is not greater than max.
          </span>
        ) : null}
        {components !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            className={root.type === 'object' && !emptyObject ? undefined : 'ml-auto'}
            onClick={() => {
              setComponentSource(null)
              setManaging(true)
            }}
          >
            <Boxes aria-hidden className="size-3.5" />
            Manage components
          </Button>
        ) : null}
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
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={(e) => setDragId(String(e.active.id))}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setDragId(null)
            setHover(null)
          }}
        >
          {virtualized ? (
            <div
              ref={scrollRef}
              data-testid="builder-scroll"
              className="h-[70vh] min-h-60 overflow-auto"
            >
              <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((item) => {
                  const row = rows[item.index]
                  if (!row) return null
                  return (
                    <div
                      key={item.key}
                      ref={virtualizer.measureElement}
                      data-index={item.index}
                      className="absolute inset-x-0 top-0"
                      style={{ transform: `translateY(${item.start}px)` }}
                    >
                      {renderRow(row)}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            rows.map(renderRow)
          )}
          <DragOverlay dropAnimation={null}>
            {dragId ? (
              <div className="mono pointer-events-none inline-block rounded-sm border border-line-strong bg-panel-3 px-2 py-1 text-small text-ink">
                {labelOf(dragId)}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      <div aria-live="polite" data-testid="move-announcer" className="sr-only">
        {announcement}
      </div>

      {components !== undefined ? (
        <ManageComponentsDialog
          open={managing}
          onOpenChange={setManaging}
          components={components}
          readOnly={readOnly || !onSaveComponents}
          onSave={onSaveComponents ?? (() => Promise.resolve())}
          onRenamed={renamed}
          source={componentSource}
        />
      ) : null}

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
                  applyType(pending.id, pending.type)
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
