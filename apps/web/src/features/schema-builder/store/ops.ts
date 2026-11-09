import { NODE_TYPES, type MockSchema, type NodeType } from '@mockbench/schema-core'
import { enableMapSet, produce } from 'immer'
import { fromSchema, isContainerType } from './convert'
import { cloneJson, jsonEqual } from './json'
import {
  ATTR_APPLIES_TO,
  ATTR_NAMES,
  type AttrName,
  type BuilderNode,
  type BuilderState,
  type NodeId,
  type TypeChangePreview,
} from './types'

enableMapSet()

/**
 * Every operation here is pure: it takes a state and returns a new one, sharing structure with the old
 * one through Immer. An operation that is rejected or changes nothing returns the SAME state object, so
 * callers (and the history in store.ts) can tell "nothing happened" by reference.
 */

const ATTR_SET: ReadonlySet<string> = new Set(ATTR_NAMES)
const TYPE_SET: ReadonlySet<string> = new Set(NODE_TYPES)
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** Default enum values given to a node that becomes an `enum` without any. */
export const DEFAULT_ENUM_VALUES = ['one', 'two', 'three'] as const
export const DEFAULT_FIELD_KEY = 'new_field'
/** The key of the field created when a node becomes an `object`. */
export const DEFAULT_OBJECT_FIELD_KEY = 'field_a'

/** All descendants of `id` (not `id` itself), parents before children. */
export function descendantsOf(state: BuilderState, id: NodeId): NodeId[] {
  const out: NodeId[] = []
  const stack = [...(state.nodes[id]?.childIds ?? [])].reverse()
  while (stack.length > 0) {
    const cur = stack.pop() as NodeId
    out.push(cur)
    const kids = state.nodes[cur]?.childIds ?? []
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as NodeId)
  }
  return out
}

/** True when `candidate` is `ancestor` itself or lies anywhere beneath it. */
export function isWithin(state: BuilderState, ancestor: NodeId, candidate: NodeId): boolean {
  let cur: NodeId | null = candidate
  while (cur !== null) {
    if (cur === ancestor) return true
    cur = state.nodes[cur]?.parentId ?? null
  }
  return false
}

const newLeaf = (
  id: NodeId,
  type: NodeType,
  key: string | null,
  parentId: NodeId,
): BuilderNode => ({
  id,
  type,
  key,
  parentId,
  childIds: [],
  attrs: {},
  extras: {},
  order: ['type'],
  ...(key === null ? {} : { entryOrder: ['key', 'node'] }),
})

export function replaceAll(schema: MockSchema): BuilderState {
  return fromSchema(schema)
}

/** Rename an object field. A duplicate key is applied (the rows flag it, the validator reports it). */
export function setKey(state: BuilderState, id: NodeId, key: string): BuilderState {
  const node = state.nodes[id]
  if (!node || node.key === null) return state // the root and an array's item have no key
  const parent = node.parentId === null ? undefined : state.nodes[node.parentId]
  if (!parent || parent.type !== 'object') return state
  if (node.key === key) return state
  return produce(state, (d) => {
    ;(d.nodes[id] as BuilderNode).key = key
  })
}

interface TypePlan {
  preview: TypeChangePreview
  removeIds: NodeId[]
  create: 'item' | 'field' | null
  giveEnumDefault: boolean
}

function planTypeChange(state: BuilderState, id: NodeId, newType: string): TypePlan | null {
  const node = state.nodes[id]
  if (!node || !TYPE_SET.has(newType) || node.type === newType) return null
  const type = newType as NodeType
  const removeIds = descendantsOf(state, id)
  const discardedAttrs = (Object.keys(node.attrs) as AttrName[]).filter((a) => {
    const applies = ATTR_APPLIES_TO[a]
    return applies !== undefined && !applies.includes(type)
  })
  const create = type === 'array' ? 'item' : type === 'object' ? 'field' : null
  return {
    preview: {
      changed: true,
      discardedNodes: removeIds.length,
      discardedAttrs,
      createdNodes: create === null ? 0 : 1,
    },
    removeIds,
    create,
    giveEnumDefault: type === 'enum' && !has(node.attrs, 'values'),
  }
}

/** What `setType` would discard and create, without changing anything (drives the "this discards N fields" prompt). */
export function previewTypeChange(
  state: BuilderState,
  id: NodeId,
  newType: string,
): TypeChangePreview {
  return (
    planTypeChange(state, id, newType)?.preview ?? {
      changed: false,
      discardedNodes: 0,
      discardedAttrs: [],
      createdNodes: 0,
    }
  )
}

/**
 * Change a node's type. Children the new type cannot hold are removed (no orphans); attributes that mean
 * nothing for the new type are dropped (both are reported by `previewTypeChange`); an `array` gets exactly
 * one string item, an `object` one `field_a` string field, an `enum` without values gets one/two/three.
 */
export function setType(state: BuilderState, id: NodeId, newType: string): BuilderState {
  const plan = planTypeChange(state, id, newType)
  if (!plan) return state
  const type = newType as NodeType
  return produce(state, (d) => {
    const node = d.nodes[id] as BuilderNode
    for (const rid of plan.removeIds) {
      delete d.nodes[rid]
      d.expanded.delete(rid)
    }
    node.childIds = []
    node.type = type
    for (const a of plan.preview.discardedAttrs) delete node.attrs[a]
    if (plan.create) {
      const cid = `n${d.nextId++}`
      d.nodes[cid] = newLeaf(
        cid,
        'string',
        plan.create === 'field' ? DEFAULT_OBJECT_FIELD_KEY : null,
        id,
      )
      node.childIds.push(cid)
    }
    if (plan.giveEnumDefault) node.attrs.values = [...DEFAULT_ENUM_VALUES]
    if (isContainerType(type)) d.expanded.add(id)
    else d.expanded.delete(id)
  })
}

function uniqueKey(state: BuilderState, parent: BuilderNode, base: string): string {
  const taken = new Set(parent.childIds.map((c) => state.nodes[c]?.key))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`
}

export interface AddFieldInit {
  key?: string
  type?: NodeType
  /** Position among the parent's fields; default is the end. */
  index?: number
}

/** Add a field to an object. Returns the new state and the new node's id (null when rejected). */
export function addField(
  state: BuilderState,
  parentId: NodeId,
  init: AddFieldInit = {},
): { state: BuilderState; id: NodeId | null } {
  const parent = state.nodes[parentId]
  if (!parent || parent.type !== 'object') return { state, id: null }
  if (init.type !== undefined && !TYPE_SET.has(init.type)) return { state, id: null }
  const id = `n${state.nextId}`
  const key = init.key ?? uniqueKey(state, parent, DEFAULT_FIELD_KEY)
  const at = Math.max(0, Math.min(init.index ?? parent.childIds.length, parent.childIds.length))
  const childIds = parent.childIds.slice() // plain array, not a draft: see moveNode
  childIds.splice(at, 0, id)
  let next = produce(state, (d) => {
    d.nodes[id] = newLeaf(id, 'string', key, parentId)
    d.nextId++
    ;(d.nodes[parentId] as BuilderNode).childIds = childIds
    if (!state.expanded.has(parentId)) d.expanded.add(parentId)
  })
  if (init.type !== undefined && init.type !== 'string') next = setType(next, id, init.type)
  return { state: next, id }
}

/**
 * Remove a node and its whole subtree. The root cannot be removed, and neither can an array's item
 * (an array always has exactly one: change the array's type instead).
 */
export function removeNode(state: BuilderState, id: NodeId): BuilderState {
  const node = state.nodes[id]
  if (!node || id === state.rootId || node.parentId === null) return state
  const parent = state.nodes[node.parentId]
  if (!parent || parent.type === 'array') return state
  const gone = [id, ...descendantsOf(state, id)]
  const remaining = parent.childIds.filter((c) => c !== id) // plain array, not a draft: see moveNode
  return produce(state, (d) => {
    ;(d.nodes[node.parentId as NodeId] as BuilderNode).childIds = remaining
    for (const g of gone) {
      delete d.nodes[g]
      d.expanded.delete(g)
    }
  })
}

/** Whether `moveNode(id, newParentId, ...)` would be accepted. */
export function canMoveNode(state: BuilderState, id: NodeId, newParentId: NodeId): boolean {
  const node = state.nodes[id]
  const target = state.nodes[newParentId]
  if (!node || !target || id === state.rootId) return false
  if (node.key === null) return false // an array's item stays where it is
  if (target.type !== 'object') return false // fields live in objects only
  return !isWithin(state, id, newParentId) // not into itself or its own subtree
}

/**
 * Move a field to `index` within `newParentId`, where `index` is the node's FINAL position among that
 * object's fields (it is taken out of its old place first, then inserted, clamped to the valid range).
 * A move that is not allowed, or that would leave everything where it is, returns the same state.
 */
export function moveNode(
  state: BuilderState,
  id: NodeId,
  newParentId: NodeId,
  index: number,
): BuilderState {
  if (!canMoveNode(state, id, newParentId)) return state
  const node = state.nodes[id] as BuilderNode
  const oldParentId = node.parentId as NodeId
  const target = state.nodes[newParentId] as BuilderNode
  const sameParent = oldParentId === newParentId
  const remaining = sameParent ? target.childIds.length - 1 : target.childIds.length
  const at = Math.max(0, Math.min(Math.trunc(index), remaining))
  const oldParent = state.nodes[oldParentId] as BuilderNode
  if (sameParent && target.childIds.indexOf(id) === at) return state
  // The new child lists are built as plain arrays and assigned, never spliced through the Immer draft:
  // a splice on a draft array turns every shifted element into a proxy trap (O(n) and slow for 2,000 fields).
  const without = oldParent.childIds.filter((c) => c !== id)
  const into = (sameParent ? without : target.childIds).slice()
  into.splice(at, 0, id)
  return produce(state, (d) => {
    if (sameParent) {
      ;(d.nodes[oldParentId] as BuilderNode).childIds = into
    } else {
      ;(d.nodes[oldParentId] as BuilderNode).childIds = without
      ;(d.nodes[newParentId] as BuilderNode).childIds = into
      ;(d.nodes[id] as BuilderNode).parentId = newParentId
    }
    if (!state.expanded.has(newParentId)) d.expanded.add(newParentId)
  })
}

/**
 * Set a known attribute (`nullable`, `description`, `fixed`, `examples`, `min`, `max`, `values`, `count`,
 * `name`), present by key presence: `0`, `""`, `false` and `null` are real values. `undefined` removes
 * it. Anything else (`type`, `key`, structure, unknown keys such as `source`) and attributes that do not
 * apply to the node's type are rejected.
 */
export function setAttr(
  state: BuilderState,
  id: NodeId,
  name: string,
  value: unknown,
): BuilderState {
  if (!ATTR_SET.has(name)) return state
  const node = state.nodes[id]
  if (!node) return state
  const applies = ATTR_APPLIES_TO[name as AttrName]
  if (applies !== undefined && !applies.includes(node.type)) return state
  const present = has(node.attrs, name)
  if (value === undefined) {
    if (!present) return state
    return produce(state, (d) => {
      delete (d.nodes[id] as BuilderNode).attrs[name as AttrName]
    })
  }
  if (present && jsonEqual((node.attrs as Record<string, unknown>)[name], value)) return state
  const stored = cloneJson(value)
  return produce(state, (d) => {
    ;(d.nodes[id] as BuilderNode).attrs[name as AttrName] = stored
  })
}

export function setExpanded(state: BuilderState, id: NodeId, expanded: boolean): BuilderState {
  const node = state.nodes[id]
  if (!node || !isContainerType(node.type)) return state
  if (state.expanded.has(id) === expanded) return state
  return produce(state, (d) => {
    if (expanded) d.expanded.add(id)
    else d.expanded.delete(id)
  })
}

export function toggleExpanded(state: BuilderState, id: NodeId): BuilderState {
  return setExpanded(state, id, !state.expanded.has(id))
}
