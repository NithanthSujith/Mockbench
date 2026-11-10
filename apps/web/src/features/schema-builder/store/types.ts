import type { Json, NodeType } from '@mockbench/schema-core'

export type NodeId = string

/** Attributes the builder edits through `setAttr`. Everything else on a node is an unknown key (`extras`). */
export const ATTR_NAMES = [
  'nullable',
  'description',
  'fixed',
  'examples',
  'min',
  'max',
  'values',
  'count',
  'name',
] as const
export type AttrName = (typeof ATTR_NAMES)[number]

/** Which node types an attribute means something for. `undefined` = every type. */
export const ATTR_APPLIES_TO: Record<AttrName, readonly NodeType[] | undefined> = {
  nullable: undefined,
  description: undefined,
  fixed: undefined,
  examples: undefined,
  min: ['number', 'integer'],
  max: ['number', 'integer'],
  values: ['enum'],
  count: ['array'],
  name: ['ref'],
}

/** One node of the normalised tree. Plain, JSON-like data (structurally shared by Immer). */
export interface BuilderNode {
  id: NodeId
  type: NodeType
  /** An object field's key. `null` for the root and for an array's single item node. */
  key: string | null
  parentId: NodeId | null
  /** object: the field node ids, in order. array: exactly one id (the item). Every other type: empty. */
  childIds: NodeId[]
  /** Known attributes, present by KEY PRESENCE (so `fixed: 0`, `""`, `false` and `null` are real pins). */
  attrs: Partial<Record<AttrName, unknown>>
  /** Unknown keys of the node (`source`, `x-vendor`, ...). Preserved verbatim, never editable. */
  extras: Record<string, unknown>
  /** The node object's original property order, so toSchema re-emits it byte-for-byte. */
  order: string[]
  /** Unknown keys of the `{ key, node }` field entry that wraps this node, and that entry's key order. */
  entryExtras?: Record<string, unknown>
  entryOrder?: string[]
}

/** The schema envelope around the root: version, components and any unknown top-level keys. */
export interface Envelope {
  version: unknown
  /** Opaque in this store: the project's components are managed elsewhere (BLD-10). */
  components: Record<string, unknown>
  extras: Record<string, unknown>
  order: string[]
}

export interface BuilderState {
  rootId: NodeId
  nodes: Record<NodeId, BuilderNode>
  /** Container nodes (object/array) whose children are shown. */
  expanded: Set<NodeId>
  /** The next node id to mint: ids are `n<counter>`, so every operation is pure and deterministic. */
  nextId: number
  envelope: Envelope
}

export type RowKind = 'field' | 'item'

/** One visible row of the tree (the root itself is not a row: see `visibleRows`). */
export interface VisibleRow {
  id: NodeId
  /** 0 for the root's children. */
  depth: number
  kind: RowKind
  key: string | null
  type: NodeType
  parentId: NodeId
  /** object or array. */
  isContainer: boolean
  /** Only meaningful when `isContainer`. */
  expanded: boolean
  /** A sibling field of the same object has the same key. */
  duplicateKey: boolean
}

export interface TypeChangePreview {
  /** False when the node does not exist or the type is the one it already has. */
  changed: boolean
  /** Descendant nodes that would be removed (the node itself is not counted). */
  discardedNodes: number
  /** Known attributes that mean nothing for the new type and would be dropped. */
  discardedAttrs: AttrName[]
  /** Nodes the change creates (the array item, or the default object field). */
  createdNodes: number
}

export type { Json, NodeType }
