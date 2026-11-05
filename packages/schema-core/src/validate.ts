import { LIMITS } from './limits'
import { NODE_TYPES } from './types'
import type { Issue, IssueCode, MockNode, MockSchema, SchemaStats, ValidateResult } from './types'

type Path = (string | number)[]
type Components = Record<string, MockNode>

const NODE_TYPE_SET: ReadonlySet<string> = new Set(NODE_TYPES)
const MAX_JSON_DEPTH = 100

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function isJson(v: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return false
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) return v.every((x) => isJson(x, depth + 1))
  if (isObj(v)) return Object.values(v).every((x) => isJson(x, depth + 1))
  return false
}

/** An empty-body schema: an object root with no fields. Returns a fresh object each call. */
export function emptySchema(): MockSchema {
  return { version: 1, components: {}, root: { type: 'object', fields: [] } }
}

// ---------------------------------------------------------------------------
// Pass 1: structure (types, keys, per-node limits). Authoritative source of issue codes/paths.
// ---------------------------------------------------------------------------

interface Ctx {
  issues: Issue[]
  nodes: number
  stop: boolean
}

function add(ctx: Ctx, path: Path, code: IssueCode, message: string): void {
  ctx.issues.push({ path, code, message })
}

function checkNode(node: unknown, path: Path, depth: number, ctx: Ctx): void {
  if (ctx.stop) return
  if (!isObj(node)) {
    add(ctx, path, 'invalid_type', 'Expected a node object')
    return
  }
  ctx.nodes += 1
  if (ctx.nodes > LIMITS.maxNodes) {
    add(ctx, path, 'node_limit_exceeded', `A schema may have at most ${LIMITS.maxNodes} nodes`)
    ctx.stop = true
    return
  }
  if (depth > LIMITS.maxDepth) {
    add(ctx, path, 'depth_exceeded', `Nesting is deeper than ${LIMITS.maxDepth} levels`)
    return
  }

  const type = node.type
  if (typeof type !== 'string') {
    add(ctx, [...path, 'type'], 'invalid_type', 'Node type must be a string')
    return
  }
  if (!NODE_TYPE_SET.has(type)) {
    add(ctx, [...path, 'type'], 'unknown_node_type', `Unknown node type "${type}"`)
    return
  }

  if ('nullable' in node && typeof node.nullable !== 'boolean')
    add(ctx, [...path, 'nullable'], 'invalid_type', 'nullable must be a boolean')
  if ('description' in node && typeof node.description !== 'string')
    add(ctx, [...path, 'description'], 'invalid_type', 'description must be a string')
  if ('fixed' in node && !isJson(node.fixed))
    add(ctx, [...path, 'fixed'], 'invalid_type', 'fixed must be a JSON value')
  if ('examples' in node) {
    if (!Array.isArray(node.examples))
      add(ctx, [...path, 'examples'], 'invalid_type', 'examples must be an array')
    else
      node.examples.forEach((e, i) => {
        if (!isJson(e))
          add(ctx, [...path, 'examples', i], 'invalid_type', 'examples must hold JSON values')
      })
  }

  switch (type) {
    case 'number':
    case 'integer': {
      let ok = true
      for (const k of ['min', 'max'] as const) {
        if (k in node && !isFiniteNumber(node[k])) {
          add(ctx, [...path, k], 'invalid_type', `${k} must be a finite number`)
          ok = false
        }
      }
      if (ok && isFiniteNumber(node.min) && isFiniteNumber(node.max) && node.min > node.max)
        add(ctx, path, 'min_greater_than_max', 'min is greater than max')
      break
    }
    case 'enum': {
      const values = node.values
      if (!Array.isArray(values) || values.length === 0) {
        add(ctx, [...path, 'values'], 'enum_empty', 'An enum needs at least one value')
        break
      }
      if (values.length > LIMITS.maxEnumValues)
        add(
          ctx,
          [...path, 'values'],
          'node_limit_exceeded',
          `An enum may have at most ${LIMITS.maxEnumValues} values`,
        )
      values.forEach((v, i) => {
        const ok = typeof v === 'string' || typeof v === 'boolean' || isFiniteNumber(v)
        if (!ok)
          add(
            ctx,
            [...path, 'values', i],
            'invalid_type',
            'Enum values must be string, number or boolean',
          )
      })
      break
    }
    case 'object': {
      const fields = node.fields
      if (!Array.isArray(fields)) {
        add(ctx, [...path, 'fields'], 'missing_fields', 'An object needs a fields array')
        break
      }
      const seen = new Set<string>()
      fields.forEach((f: unknown, i) => {
        const fp = [...path, 'fields', i]
        if (!isObj(f)) {
          add(ctx, fp, 'invalid_type', 'A field must be { key, node }')
          return
        }
        const key = f.key
        if (typeof key !== 'string')
          add(ctx, [...fp, 'key'], 'invalid_type', 'A field key must be a string')
        else if (key === '') add(ctx, [...fp, 'key'], 'empty_key', 'A field key may not be empty')
        else if (key === '__proto__')
          add(ctx, [...fp, 'key'], 'forbidden_key', 'The key "__proto__" is not allowed')
        else if (key.length > LIMITS.maxKeyLength)
          add(
            ctx,
            [...fp, 'key'],
            'node_limit_exceeded',
            `A key may be at most ${LIMITS.maxKeyLength} characters`,
          )
        else if (seen.has(key)) add(ctx, [...fp, 'key'], 'duplicate_key', `Duplicate key "${key}"`)
        else seen.add(key)
        checkNode(f.node, [...fp, 'node'], depth + 1, ctx)
      })
      break
    }
    case 'array': {
      if ('count' in node) {
        const c = node.count
        if (!Number.isInteger(c) || (c as number) < 0)
          add(ctx, [...path, 'count'], 'invalid_type', 'count must be a non-negative integer')
        else if ((c as number) > LIMITS.maxArrayCount)
          add(
            ctx,
            [...path, 'count'],
            'array_count_exceeded',
            `count may be at most ${LIMITS.maxArrayCount}`,
          )
      }
      if (node.items === undefined)
        add(ctx, [...path, 'items'], 'missing_items', 'An array needs an items node')
      else checkNode(node.items, [...path, 'items'], depth + 1, ctx)
      break
    }
    case 'ref':
      if (typeof node.name !== 'string' || node.name === '')
        add(ctx, [...path, 'name'], 'invalid_type', 'A ref needs a component name')
      break
    default:
      break
  }
}

// ---------------------------------------------------------------------------
// Pass 2: expanded analysis (refs, cycles, depth, estimated leaves) — never expands the tree.
// ---------------------------------------------------------------------------

interface Res {
  depth: number
  leaves: number
}

function analyse(root: MockNode, merged: Components, issues: Issue[]): Res {
  const memo = new Map<string, Res>()
  const inProgress = new Set<string>()

  const walk = (node: MockNode, path: Path): Res => {
    switch (node.type) {
      case 'object': {
        let depth = 0
        let leaves = 0
        ;(node.fields ?? []).forEach((f, i) => {
          const r = walk(f.node, [...path, 'fields', i, 'node'])
          depth = Math.max(depth, r.depth)
          leaves += r.leaves
        })
        return { depth: 1 + depth, leaves: Math.max(1, leaves) }
      }
      case 'array': {
        const r = walk(node.items as MockNode, [...path, 'items'])
        const count = node.count ?? 3
        // count 0 must not multiply an unbounded child into NaN (0 * Infinity)
        return { depth: 1 + r.depth, leaves: count === 0 ? 1 : Math.max(1, count * r.leaves) }
      }
      case 'ref':
        return resolve(node.name as string, path)
      default:
        return { depth: 1, leaves: 1 }
    }
  }

  const checkLimits = (r: Res, path: Path): void => {
    if (r.depth > LIMITS.maxDepth)
      issues.push({
        path,
        code: 'depth_exceeded',
        message: `Nesting is deeper than ${LIMITS.maxDepth} levels once refs are expanded`,
      })
    if (r.leaves > LIMITS.maxLeaves)
      issues.push({
        path,
        code: 'leaf_limit_exceeded',
        message: `Would generate more than ${LIMITS.maxLeaves} values`,
      })
  }

  const resolve = (name: string, path: Path): Res => {
    const comp = merged[name]
    if (comp === undefined) {
      issues.push({ path, code: 'unknown_ref', message: `No component named "${name}"` })
      return { depth: 1, leaves: 1 }
    }
    const hit = memo.get(name)
    if (hit) return hit
    if (inProgress.has(name)) {
      issues.push({ path, code: 'ref_cycle', message: `Component "${name}" refers to itself` })
      return { depth: 1, leaves: 1 }
    }
    inProgress.add(name)
    const cpath: Path = ['components', name]
    const r = walk(comp, cpath)
    inProgress.delete(name)
    memo.set(name, r)
    checkLimits(r, cpath)
    return r
  }

  const rootRes = walk(root, ['root'])
  for (const name of Object.keys(merged)) resolve(name, ['components', name])
  checkLimits(rootRes, ['root'])
  return rootRes
}

// ---------------------------------------------------------------------------

/**
 * Validates a MockSchema envelope. Never throws. On success `schema` is the input itself (unknown keys intact).
 * Callers must pass the project's components in `opts.components`: they are merged over the envelope's own.
 */
export function validateSchema(input: unknown, opts?: { components?: Components }): ValidateResult {
  try {
    return validate(input, opts)
  } catch {
    return {
      ok: false,
      issues: [
        {
          path: [],
          code: 'invalid_type',
          message: 'The schema could not be processed (malformed or too deeply nested)',
        },
      ],
    }
  }
}

function validate(input: unknown, opts?: { components?: Components }): ValidateResult {
  const ctx: Ctx = { issues: [], nodes: 0, stop: false }
  if (!isObj(input)) {
    return {
      ok: false,
      issues: [{ path: [], code: 'invalid_type', message: 'Expected a schema object' }],
    }
  }
  if (!('version' in input)) add(ctx, ['version'], 'invalid_type', 'Missing schema version')
  else if (input.version !== 1)
    add(
      ctx,
      ['version'],
      'unsupported_schema_version',
      `Unsupported schema version ${String(input.version)}`,
    )

  const envComponents = input.components
  if (!isObj(envComponents))
    add(ctx, ['components'], 'invalid_type', 'components must be an object')
  if (!isObj(input.root)) add(ctx, ['root'], 'invalid_type', 'root must be a node object')
  if (ctx.issues.length > 0) return { ok: false, issues: ctx.issues }

  checkNode(input.root, ['root'], 1, ctx)
  for (const [name, node] of Object.entries(envComponents as Record<string, unknown>))
    checkNode(node, ['components', name], 1, ctx)

  const nodeCount = ctx.nodes
  const override = opts?.components
  if (override) {
    const octx: Ctx = { issues: ctx.issues, nodes: 0, stop: false }
    for (const [name, node] of Object.entries(override))
      checkNode(node, ['options', 'components', name], 1, octx)
  }
  if (ctx.issues.length > 0) return { ok: false, issues: ctx.issues }

  const merged: Components = { ...(envComponents as Components), ...(override ?? {}) }
  const issues: Issue[] = []
  const root = analyse(input.root as MockNode, merged, issues)
  if (issues.length > 0) return { ok: false, issues }

  const stats: SchemaStats = { depth: root.depth, nodes: nodeCount, estimatedLeaves: root.leaves }
  return { ok: true, schema: input as unknown as MockSchema, stats }
}
