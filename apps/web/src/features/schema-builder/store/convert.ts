import type { FieldEntry, MockNode, MockSchema, NodeType } from '@mockbench/schema-core'
import { cloneJson, setOwn } from './json'
import {
  ATTR_NAMES,
  type AttrName,
  type BuilderNode,
  type BuilderState,
  type Envelope,
  type NodeId,
} from './types'

const ATTR_SET: ReadonlySet<string> = new Set(ATTR_NAMES)
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

export const isContainerType = (t: NodeType): boolean => t === 'object' || t === 'array'

/**
 * MockSchema -> normalised builder state. Lossless for valid schemas: every unknown key (on the node,
 * on its `{ key, node }` field entry, and on the envelope) is kept, and so is the original key order,
 * so `toSchema(fromSchema(x))` equals `x` and serialises identically. The input is deep-cloned, so the
 * caller's object is never frozen or shared. An array with no `items` is normalised to a string item
 * (an array always has exactly one item node); that is the only structural repair.
 */
export function fromSchema(schema: MockSchema): BuilderState {
  const nodes: Record<NodeId, BuilderNode> = {}
  const expanded = new Set<NodeId>()
  let counter = 1
  const mint = (): NodeId => `n${counter++}`

  const build = (
    raw: MockNode,
    key: string | null,
    parentId: NodeId | null,
    entry?: { extras: Record<string, unknown>; order: string[] },
  ): NodeId => {
    const id = mint()
    const node: BuilderNode = {
      id,
      type: raw.type,
      key,
      parentId,
      childIds: [],
      attrs: {},
      extras: {},
      order: Object.keys(raw),
    }
    nodes[id] = node
    for (const k of node.order) {
      if (k === 'type' || k === 'fields' || k === 'items') continue
      const value = cloneJson((raw as Record<string, unknown>)[k])
      if (ATTR_SET.has(k)) setOwn(node.attrs as Record<string, unknown>, k, value)
      else setOwn(node.extras, k, value)
    }
    if (entry) {
      node.entryOrder = entry.order
      if (Object.keys(entry.extras).length > 0) node.entryExtras = entry.extras
    }
    if (raw.type === 'object') {
      for (const field of raw.fields ?? []) {
        const order = Object.keys(field)
        const extras: Record<string, unknown> = {}
        for (const k of order) {
          if (k !== 'key' && k !== 'node') {
            setOwn(extras, k, cloneJson((field as unknown as Record<string, unknown>)[k]))
          }
        }
        node.childIds.push(build(field.node, field.key, id, { extras, order }))
      }
    } else if (raw.type === 'array') {
      if (raw.items) node.childIds.push(build(raw.items, null, id))
      else {
        const itemId = mint()
        nodes[itemId] = {
          id: itemId,
          type: 'string',
          key: null,
          parentId: id,
          childIds: [],
          attrs: {},
          extras: {},
          order: ['type'],
        }
        node.childIds.push(itemId)
        if (!node.order.includes('items')) node.order.push('items')
      }
    }
    if (isContainerType(node.type)) expanded.add(id)
    return id
  }

  const rootId = build(schema.root, null, null)
  const envelope: Envelope = {
    version: schema.version,
    components: cloneJson(schema.components ?? {}) as Record<string, unknown>,
    extras: {},
    order: Object.keys(schema),
  }
  for (const k of envelope.order) {
    if (k !== 'version' && k !== 'components' && k !== 'root') {
      setOwn(envelope.extras, k, cloneJson((schema as unknown as Record<string, unknown>)[k]))
    }
  }
  return { rootId, nodes, expanded, nextId: counter, envelope }
}

/**
 * Builder state -> MockSchema, as fresh mutable objects (never references into the frozen state).
 * Keys come out in their original order; keys the node did not originally have follow in a fixed order
 * (`type`, `fields`/`items`, then attributes). A node with duplicate sibling keys is still emitted:
 * the validator reports `duplicate_key`, the store does not hide the structure.
 */
export function toSchema(state: BuilderState): MockSchema {
  const emitNode = (id: NodeId): MockNode => {
    const n = state.nodes[id] as BuilderNode
    const out: Record<string, unknown> = {}
    const done = new Set<string>()
    const emit = (k: string) => {
      if (done.has(k)) return
      if (k === 'type') setOwn(out, k, n.type)
      else if (k === 'fields') {
        if (n.type !== 'object') return
        setOwn(
          out,
          k,
          n.childIds.map((cid) => emitEntry(cid)),
        )
      } else if (k === 'items') {
        if (n.type !== 'array' || n.childIds[0] === undefined) return
        setOwn(out, k, emitNode(n.childIds[0]))
      } else if (has(n.attrs, k)) setOwn(out, k, cloneJson((n.attrs as Record<string, unknown>)[k]))
      else if (has(n.extras, k)) setOwn(out, k, cloneJson(n.extras[k]))
      else return
      done.add(k)
    }
    for (const k of n.order) emit(k)
    for (const k of ['type', 'fields', 'items', ...ATTR_NAMES] as const) emit(k)
    return out as unknown as MockNode
  }

  const emitEntry = (id: NodeId): FieldEntry => {
    const n = state.nodes[id] as BuilderNode
    const out: Record<string, unknown> = {}
    for (const k of n.entryOrder ?? ['key', 'node']) {
      if (k === 'key') setOwn(out, k, n.key ?? '')
      else if (k === 'node') setOwn(out, k, emitNode(id))
      else if (n.entryExtras && has(n.entryExtras, k)) setOwn(out, k, cloneJson(n.entryExtras[k]))
    }
    if (!has(out, 'key')) setOwn(out, 'key', n.key ?? '')
    if (!has(out, 'node')) setOwn(out, 'node', emitNode(id))
    return out as unknown as FieldEntry
  }

  const env = state.envelope
  const out: Record<string, unknown> = {}
  const done = new Set<string>()
  const emit = (k: string) => {
    if (done.has(k)) return
    if (k === 'version') setOwn(out, k, env.version)
    else if (k === 'components') setOwn(out, k, cloneJson(env.components))
    else if (k === 'root') setOwn(out, k, emitNode(state.rootId))
    else if (has(env.extras, k)) setOwn(out, k, cloneJson(env.extras[k]))
    else return
    done.add(k)
  }
  for (const k of env.order) emit(k)
  for (const k of ['version', 'components', 'root']) emit(k)
  return out as unknown as MockSchema
}

export type { AttrName }
