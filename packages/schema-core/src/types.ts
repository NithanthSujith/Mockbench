/** A JSON value. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export const NODE_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'null',
  'email',
  'uuid',
  'url',
  'phone',
  'date',
  'datetime',
  'enum',
  'object',
  'array',
  'ref',
] as const

export type NodeType = (typeof NODE_TYPES)[number]

export interface FieldEntry {
  key: string
  node: MockNode
}

/**
 * One node of a MockSchema tree. Unknown keys are preserved and ignored (forward compatibility;
 * `source` is reserved for request-derived values and is never interpreted in v1).
 */
export interface MockNode {
  type: NodeType
  nullable?: boolean
  description?: string
  /** A literal that overrides generation. Present by key presence: `""`, `0`, `false`, `null` are valid pins. */
  fixed?: Json
  examples?: Json[]
  /** Reserved. Accepted as any JSON value, never interpreted. */
  source?: unknown
  /** number, integer */
  min?: number
  max?: number
  /** enum */
  values?: (string | number | boolean)[]
  /** object (ordered) */
  fields?: FieldEntry[]
  /** array */
  items?: MockNode
  count?: number
  /** ref */
  name?: string
  [unknown: string]: unknown
}

export interface MockSchema {
  version: 1
  components: Record<string, MockNode>
  root: MockNode
}

export type IssueCode =
  | 'invalid_type'
  | 'unsupported_schema_version'
  | 'unknown_node_type'
  | 'duplicate_key'
  | 'empty_key'
  | 'forbidden_key'
  | 'depth_exceeded'
  | 'node_limit_exceeded'
  | 'array_count_exceeded'
  | 'leaf_limit_exceeded'
  | 'unknown_ref'
  | 'ref_cycle'
  | 'min_greater_than_max'
  | 'enum_empty'
  | 'missing_items'
  | 'missing_fields'

export interface Issue {
  path: (string | number)[]
  code: IssueCode
  message: string
}

export interface SchemaStats {
  /** Nodes on the longest root-to-leaf path of the *expanded* tree (through `ref`s). The root alone is 1. */
  depth: number
  /** Authored nodes in the envelope: root plus every node of every envelope component. */
  nodes: number
  /** Product of array counts along every path, computed without expanding. Every container counts at least 1. */
  estimatedLeaves: number
}

export type ValidateResult =
  { ok: true; schema: MockSchema; stats: SchemaStats } | { ok: false; issues: Issue[] }
