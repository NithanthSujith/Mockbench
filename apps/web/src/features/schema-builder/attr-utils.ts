import type { Json, MockNode, NodeType } from '@mockbench/schema-core'
import { toSchema } from './store/convert'
import type { BuilderNode, BuilderState, NodeId } from './store'

/** The component-name rule of API-CONTRACT 1.7. */
export const COMPONENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
export const MAX_COMPONENTS = 100

const NUMERIC: readonly NodeType[] = ['number', 'integer']

/** Types that hold one literal value: the ones a value can be pinned on or given examples for. */
export function isPinnable(type: NodeType): boolean {
  return type !== 'object' && type !== 'array' && type !== 'ref' && type !== 'null'
}

export const isNumeric = (type: NodeType): boolean => NUMERIC.includes(type)

/** The value a fresh pin or a fresh example starts with, per node type. */
export function defaultLiteral(node: Pick<BuilderNode, 'type' | 'attrs'>): Json {
  if (isNumeric(node.type)) return 0
  if (node.type === 'boolean') return false
  if (node.type === 'enum' && Array.isArray(node.attrs.values) && node.attrs.values.length > 0) {
    return node.attrs.values[0] as Json
  }
  return ''
}

/** Typed text -> a number, or null while the text is not a finite number (empty, "-", "1e"). */
export function parseNumberText(text: string): number | null {
  if (text.trim() === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/** Typed text -> the literal for a node type, or undefined while it does not parse yet. */
export function literalFromText(type: NodeType, text: string): Json | undefined {
  if (type === 'integer') {
    const n = parseNumberText(text)
    return n === null ? undefined : Math.trunc(n)
  }
  if (type === 'number') return parseNumberText(text) ?? undefined
  if (type === 'boolean') return text === 'true' ? true : text === 'false' ? false : undefined
  return text
}

export function literalToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  return JSON.stringify(value) ?? ''
}

export function minGreaterThanMax(node: Pick<BuilderNode, 'type' | 'attrs'>): boolean {
  if (!isNumeric(node.type)) return false
  const { min, max } = node.attrs
  return typeof min === 'number' && typeof max === 'number' && min > max
}

export function hasMinMaxConflict(state: BuilderState): boolean {
  return Object.values(state.nodes).some(minGreaterThanMax)
}

/** Names of every `ref` inside a component or schema node (a plain JSON walk). */
export function refNamesIn(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof node !== 'object' || node === null) return out
  const n = node as MockNode
  if (n.type === 'ref' && typeof n.name === 'string') out.add(n.name)
  if (Array.isArray(n.fields)) for (const f of n.fields) refNamesIn(f?.node, out)
  if (n.items) refNamesIn(n.items, out)
  return out
}

/** Components that reach themselves through refs (a self-reference or a longer loop). */
export function cyclicComponents(components: Record<string, unknown>): Set<string> {
  const edges = new Map<string, Set<string>>()
  for (const [name, node] of Object.entries(components)) edges.set(name, refNamesIn(node))
  const cyclic = new Set<string>()
  for (const name of edges.keys()) {
    const seen = new Set<string>()
    const stack = [...(edges.get(name) ?? [])]
    while (stack.length > 0) {
      const cur = stack.pop() as string
      if (cur === name) {
        cyclic.add(name)
        break
      }
      if (seen.has(cur)) continue
      seen.add(cur)
      stack.push(...(edges.get(cur) ?? []))
    }
  }
  return cyclic
}

/** A copy of `node` with every `ref` to `from` pointing at `to`. */
export function renameRefs<T>(node: T, from: string, to: string): T {
  if (Array.isArray(node)) return node.map((x) => renameRefs(x, from, to)) as unknown as T
  if (typeof node !== 'object' || node === null) return node
  const out: Record<string, unknown> = {}
  const rec = node as Record<string, unknown>
  for (const k of Object.keys(rec)) {
    out[k] =
      k === 'name' && rec.type === 'ref' && rec.name === from
        ? to
        : k === 'fields' || k === 'items' || k === 'node'
          ? renameRefs(rec[k], from, to)
          : rec[k]
  }
  return out as T
}

/** The node at `id` and everything below it, as a MockSchema node (unknown keys kept). */
export function subtreeNode(state: BuilderState, id: NodeId): MockNode {
  return toSchema({ ...state, rootId: id }).root
}

/** Ids of every `ref` node that points at `name`. */
export function refNodesNamed(state: BuilderState, name: string): NodeId[] {
  return Object.values(state.nodes)
    .filter((n) => n.type === 'ref' && n.attrs.name === name)
    .map((n) => n.id)
}

export interface RowIssues {
  minGreaterThanMax: boolean
  unknownRef: boolean
  refCycle: boolean
}

export const NO_ISSUES: RowIssues = {
  minGreaterThanMax: false,
  unknownRef: false,
  refCycle: false,
}

export function rowIssues(
  node: BuilderNode,
  known: ReadonlySet<string> | undefined,
  cyclic: ReadonlySet<string>,
): RowIssues {
  const refName = node.type === 'ref' ? node.attrs.name : undefined
  const named = typeof refName === 'string'
  return {
    minGreaterThanMax: minGreaterThanMax(node),
    unknownRef: node.type === 'ref' && known !== undefined && (!named || !known.has(refName)),
    refCycle: node.type === 'ref' && named && cyclic.has(refName),
  }
}
