// RUN-10: pure comparison of two stored snapshots (API-CONTRACT 2, `VersionDiff`). No I/O.
// Identity: route = method + normalised path; case = name (case-insensitive); preset/component = name.
// Every list is sorted by code-unit order so the same inputs give byte-identical JSON.
import { normalizePath } from '@mockbench/api-contract'
import type { Change, SchemaChange, Snapshot, VersionDiff } from '@mockbench/api-contract'

type Ref = { id: string; label: string }
type SnapRoute = Snapshot['routes'][number]
type SnapCase = SnapRoute['cases'][number]
type Node = { [key: string]: unknown }

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Structural equality of JSON values; object key order is irrelevant, array order is not. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => same(v, b[i]))
  }
  const ao = a as Node
  const bo = b as Node
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  return keys.every((k) => Object.hasOwn(bo, k) && same(ao[k], bo[k]))
}

function fieldChanges(from: Node, to: Node, fields: string[]): Change[] {
  const out: Change[] = []
  for (const field of fields) {
    if (!same(from[field], to[field])) out.push({ field, before: from[field], after: to[field] })
  }
  return out
}

/** A node without its children: the part that changes "in place". */
function shallow(node: Node): Node {
  const rest = { ...node }
  delete rest.fields
  delete rest.items
  return rest
}

type FieldEntry = { key: string; node: Node }
const fieldList = (node: Node): FieldEntry[] =>
  Array.isArray(node.fields) ? (node.fields as FieldEntry[]) : []

function diffNode(path: string, from: Node, to: Node, out: SchemaChange[]): void {
  const a = shallow(from)
  const b = shallow(to)
  if (!same(a, b)) out.push({ path, kind: 'changed', before: a, after: b })

  const fromFields = fieldList(from)
  const toFields = fieldList(to)
  const fromByKey = new Map(fromFields.map((f) => [f.key, f.node]))
  const toKeys = new Set(toFields.map((f) => f.key))
  // Document order of `to`, then fields only the old schema had.
  for (const f of toFields) {
    const old = fromByKey.get(f.key)
    if (old === undefined) out.push({ path: `${path}.${f.key}`, kind: 'added', after: f.node })
    else diffNode(`${path}.${f.key}`, old, f.node, out)
  }
  for (const f of fromFields) {
    if (!toKeys.has(f.key)) out.push({ path: `${path}.${f.key}`, kind: 'removed', before: f.node })
  }

  const fromItems = from.items as Node | undefined
  const toItems = to.items as Node | undefined
  const itemPath = `${path}[*]`
  if (fromItems && toItems) diffNode(itemPath, fromItems, toItems, out)
  else if (toItems) out.push({ path: itemPath, kind: 'added', after: toItems })
  else if (fromItems) out.push({ path: itemPath, kind: 'removed', before: fromItems })
}

type Envelope = { version?: unknown; components?: Record<string, Node>; root: Node }

/** Schema changes between two case envelopes. Envelope components appear under `#<name>`. */
export function diffSchemas(from: Envelope, to: Envelope): SchemaChange[] {
  const out: SchemaChange[] = []
  diffNode('$', from.root, to.root, out)
  const fc = from.components ?? {}
  const tc = to.components ?? {}
  for (const name of [...new Set([...Object.keys(fc), ...Object.keys(tc)])].sort(cmp)) {
    const a = fc[name]
    const b = tc[name]
    if (a && b) diffNode(`#${name}`, a, b, out)
    else if (b) out.push({ path: `#${name}`, kind: 'added', after: b })
    else if (a) out.push({ path: `#${name}`, kind: 'removed', before: a })
  }
  return out
}

function diffNamed<T>(
  from: Map<string, T>,
  to: Map<string, T>,
  equal: (a: T, b: T) => boolean,
): { added: string[]; removed: string[]; changed: string[] } {
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const [name, v] of to) {
    const old = from.get(name)
    if (old === undefined) added.push(name)
    else if (!equal(old, v)) changed.push(name)
  }
  for (const name of from.keys()) if (!to.has(name)) removed.push(name)
  return { added: added.sort(cmp), removed: removed.sort(cmp), changed: changed.sort(cmp) }
}

const routeKey = (r: { method: string; path: string }) => `${r.method} ${normalizePath(r.path)}`
const caseKey = (c: { name: string }) => c.name.toLowerCase()

function diffCases(
  from: SnapCase[],
  to: SnapCase[],
): VersionDiff['routes']['changed'][number]['cases'] {
  const fromBy = new Map(from.map((c) => [caseKey(c), c]))
  const toBy = new Map(to.map((c) => [caseKey(c), c]))
  const added: { name: string; statusCode: number }[] = []
  const removed: { name: string; statusCode: number }[] = []
  const changed: { name: string; fields: Change[]; schema: SchemaChange[] }[] = []
  for (const [k, c] of toBy) {
    const old = fromBy.get(k)
    if (!old) {
      added.push({ name: c.name, statusCode: c.statusCode })
      continue
    }
    const fields = fieldChanges(old, c, ['statusCode', 'headers', 'delayMs', 'isDefault'])
    const schema = diffSchemas(old.schema as Envelope, c.schema as Envelope)
    if (fields.length > 0 || schema.length > 0) changed.push({ name: c.name, fields, schema })
  }
  for (const [k, c] of fromBy) {
    if (!toBy.has(k)) removed.push({ name: c.name, statusCode: c.statusCode })
  }
  const byName = (a: { name: string }, b: { name: string }) =>
    cmp(caseKey(a), caseKey(b)) || cmp(a.name, b.name)
  return { added: added.sort(byName), removed: removed.sort(byName), changed: changed.sort(byName) }
}

/** What changed from snapshot `from` to snapshot `to`. */
export function diffSnapshots(
  from: Snapshot,
  to: Snapshot,
  fromRef: Ref = { id: '', label: '' },
  toRef: Ref = { id: '', label: '' },
): VersionDiff {
  const settingKeys = [
    ...new Set([...Object.keys(from.project.settings), ...Object.keys(to.project.settings)]),
  ].sort(cmp)
  const settings = fieldChanges(from.project.settings, to.project.settings, settingKeys)

  const components = diffNamed(
    new Map(Object.entries(from.project.components)),
    new Map(Object.entries(to.project.components)),
    same,
  )
  const strip = (p: Snapshot['presets'][number]) => ({ priority: p.priority, rules: p.rules })
  const presets = diffNamed(
    new Map(from.presets.map((p) => [p.name, p])),
    new Map(to.presets.map((p) => [p.name, p])),
    (a, b) => same(strip(a), strip(b)),
  )

  const fromRoutes = new Map(from.routes.map((r) => [routeKey(r), r]))
  const toRoutes = new Map(to.routes.map((r) => [routeKey(r), r]))
  const added: { method: SnapRoute['method']; path: string }[] = []
  const removed: { method: SnapRoute['method']; path: string }[] = []
  const changed: VersionDiff['routes']['changed'] = []
  for (const [k, r] of toRoutes) {
    const old = fromRoutes.get(k)
    if (!old) {
      added.push({ method: r.method, path: r.path })
      continue
    }
    const fields = fieldChanges(old, r, ['description'])
    const cases = diffCases(old.cases, r.cases)
    if (fields.length || cases.added.length || cases.removed.length || cases.changed.length) {
      changed.push({ method: r.method, path: r.path, fields, cases })
    }
  }
  for (const [k, r] of fromRoutes) {
    if (!toRoutes.has(k)) removed.push({ method: r.method, path: r.path })
  }
  const byRoute = (a: { method: string; path: string }, b: { method: string; path: string }) =>
    cmp(routeKey(a), routeKey(b)) || cmp(a.path, b.path)

  return {
    from: fromRef,
    to: toRef,
    settings,
    components,
    presets,
    routes: {
      added: added.sort(byRoute),
      removed: removed.sort(byRoute),
      changed: changed.sort(byRoute),
    },
  }
}
