import type { MockSchema } from '@mockbench/schema-core'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { fromSchema, isContainerType, toSchema } from './convert'
import {
  addField as addFieldOp,
  moveNode as moveNodeOp,
  previewTypeChange,
  removeNode as removeNodeOp,
  replaceAll as replaceAllOp,
  setAttr as setAttrOp,
  setKey as setKeyOp,
  setType as setTypeOp,
  toggleExpanded as toggleExpandedOp,
  type AddFieldInit,
} from './ops'
import { visibleRows } from './rows'
import type { BuilderState, NodeId, TypeChangePreview, VisibleRow } from './types'

export const HISTORY_LIMIT = 100
/** A burst of key edits on one node closer together than this is one undo step. */
export const COALESCE_MS = 500

export interface BuilderStoreOptions {
  /** Injectable clock (ms) so coalescing is testable. Default `Date.now`. */
  clock?: () => number
  historyLimit?: number
  coalesceMs?: number
}

export interface BuilderStoreState {
  /** The present state. */
  state: BuilderState
  /** Older states, oldest first; never more than `historyLimit`. */
  past: readonly BuilderState[]
  /** States undone, next-to-redo first. Cleared by any new edit. */
  future: readonly BuilderState[]
  canUndo: boolean
  canRedo: boolean

  /** Each editing action returns whether it changed anything (rejected or no-op edits leave history alone). */
  setKey(id: NodeId, key: string): boolean
  /** Returns what the change discarded and created, or null when nothing changed. */
  setType(id: NodeId, type: string): TypeChangePreview | null
  /** Returns the new node's id, or null when rejected. */
  addField(parentId: NodeId, init?: AddFieldInit): NodeId | null
  removeNode(id: NodeId): boolean
  moveNode(id: NodeId, newParentId: NodeId, index: number): boolean
  setAttr(id: NodeId, name: string, value: unknown): boolean
  /** Replace the whole schema (an undoable step). */
  replaceAll(schema: MockSchema): void
  /** UI state, not an undo step. */
  toggleExpanded(id: NodeId): void
  undo(): boolean
  redo(): boolean

  toSchema(): MockSchema
  rows(): VisibleRow[]
}

export type BuilderStore = StoreApi<BuilderStoreState>

/**
 * Which expanded set a state takes when history moves it into the present. Only containers can be
 * expanded. A node that is a container both before and after keeps the user's current choice (so
 * collapsing a node and then undoing a rename must not re-open it); a node that was not a container in
 * the state being left (it did not exist, or was a leaf) starts expanded, which is the default.
 */
function carryExpanded(target: BuilderState, from: BuilderState): BuilderState {
  const next = new Set<NodeId>()
  for (const id of Object.keys(target.nodes)) {
    const n = target.nodes[id]
    if (!n || !isContainerType(n.type)) continue
    const before = from.nodes[id]
    if (before && isContainerType(before.type)) {
      if (from.expanded.has(id)) next.add(id)
    } else {
      next.add(id)
    }
  }
  const same =
    next.size === target.expanded.size && [...next].every((id) => target.expanded.has(id))
  return same ? target : { ...target, expanded: next }
}

export function createBuilderStore(
  initial: MockSchema,
  options: BuilderStoreOptions = {},
): BuilderStore {
  const clock = options.clock ?? Date.now
  const limit = options.historyLimit ?? HISTORY_LIMIT
  const coalesceMs = options.coalesceMs ?? COALESCE_MS
  let lastEdit: { kind: 'setKey'; nodeId: NodeId; at: number } | null = null

  return createStore<BuilderStoreState>()((set, get) => {
    /** Make `next` the present, recording the old present as an undo step unless this edit coalesces. */
    const commit = (next: BuilderState, coalesce?: { kind: 'setKey'; nodeId: NodeId }): boolean => {
      const cur = get()
      if (next === cur.state) return false
      const now = clock()
      const merge =
        coalesce !== undefined &&
        lastEdit !== null &&
        lastEdit.kind === coalesce.kind &&
        lastEdit.nodeId === coalesce.nodeId &&
        now - lastEdit.at <= coalesceMs &&
        cur.past.length > 0
      let past = cur.past
      if (!merge) {
        past = [...cur.past, cur.state]
        if (past.length > limit) past = past.slice(past.length - limit)
      }
      lastEdit = coalesce ? { ...coalesce, at: now } : null
      set({ state: next, past, future: [], canUndo: past.length > 0, canRedo: false })
      return true
    }

    return {
      state: fromSchema(initial),
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,

      setKey: (id, key) => commit(setKeyOp(get().state, id, key), { kind: 'setKey', nodeId: id }),
      setType: (id, type) => {
        const preview = previewTypeChange(get().state, id, type)
        return preview.changed && commit(setTypeOp(get().state, id, type)) ? preview : null
      },
      addField: (parentId, init) => {
        const res = addFieldOp(get().state, parentId, init)
        return res.id !== null && commit(res.state) ? res.id : null
      },
      removeNode: (id) => commit(removeNodeOp(get().state, id)),
      moveNode: (id, newParentId, index) => commit(moveNodeOp(get().state, id, newParentId, index)),
      setAttr: (id, name, value) => commit(setAttrOp(get().state, id, name, value)),
      replaceAll: (schema) => {
        commit(replaceAllOp(schema))
      },
      toggleExpanded: (id) => {
        const next = toggleExpandedOp(get().state, id)
        if (next !== get().state) set({ state: next })
      },

      undo: () => {
        const cur = get()
        const prev = cur.past[cur.past.length - 1]
        if (!prev) return false
        const past = cur.past.slice(0, -1)
        lastEdit = null
        set({
          state: carryExpanded(prev, cur.state),
          past,
          future: [cur.state, ...cur.future],
          canUndo: past.length > 0,
          canRedo: true,
        })
        return true
      },
      redo: () => {
        const cur = get()
        const nxt = cur.future[0]
        if (!nxt) return false
        const future = cur.future.slice(1)
        const past = [...cur.past, cur.state]
        lastEdit = null
        set({
          state: carryExpanded(nxt, cur.state),
          past,
          future,
          canUndo: true,
          canRedo: future.length > 0,
        })
        return true
      },

      toSchema: () => toSchema(get().state),
      rows: () => visibleRows(get().state),
    }
  })
}
