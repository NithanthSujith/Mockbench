import { applyPattern } from './pattern'
import { CITIES, NAMES, WORDS } from './pools'
import { hash32, mulberry32 } from './prng'
import { formatUuid, uuidv5 } from './sha1'
import type { Issue, IssueCode, Json, MockNode, MockSchema, NodeType } from './types'
import { validateSchema } from './validate'

/** Bump whenever any golden output changes (FND-05 enforces this). */
export const GENERATOR_VERSION = 1

/** Fixed namespace for deterministic UUID v5 values. */
export const UUID_NAMESPACE = '7d1c1a0e-7d8e-5a52-9b5e-3f2d6c0a4b11'

export type Provenance = 'fixed' | 'preset' | 'example' | 'enum' | 'generated' | 'random'

export interface PresetQuery {
  /** The field key; an array item uses its array's key; `null` when there is no field key above (root). */
  key: string | null
  /** `$` + `.key` segments, `[*]` for any array element. The position in the schema, not in the output. */
  schemaPath: string
  type: NodeType
}
export type PresetHit = { value: Json } | { values: Json[] } | { pattern: string }
/** Supplied by the presets engine (FND-04). Called for leaf nodes only. */
export type PresetResolver = (query: PresetQuery) => PresetHit | null

export interface GenContext {
  projectId: string
  settings: { indexing: 'local' | 'path'; mode: 'deterministic' | 'seeded' | 'random' }
  /** Project-level components. Merged OVER the envelope's own (same rule as validateSchema). */
  components?: Record<string, MockNode>
  presets?: PresetResolver
  /** `random` mode only. Defaults to Math.random. */
  random?: () => number
}

export interface GenerateResult {
  /** The body, serialised in field order. Pretty-printed with `opts.indent` spaces, otherwise compact. */
  json: string
  /** JSON Pointer of each leaf in `json` (e.g. `/orders/1/total`) -> where its value came from. */
  provenance: Record<string, Provenance>
}

type LimitCode = Extract<
  IssueCode,
  'leaf_limit_exceeded' | 'depth_exceeded' | 'node_limit_exceeded' | 'array_count_exceeded'
>
const LIMIT_CODES: ReadonlySet<string> = new Set<LimitCode>([
  'leaf_limit_exceeded',
  'depth_exceeded',
  'node_limit_exceeded',
  'array_count_exceeded',
])

/** The schema is over a size limit. Thrown BEFORE any output is allocated. */
export class GenerationLimitError extends Error {
  readonly code: LimitCode
  constructor(code: LimitCode, message: string) {
    super(message)
    this.name = 'GenerationLimitError'
    this.code = code
  }
}

/** The schema failed validation (unknown ref, cycle, malformed node, ...). Callers should validate first. */
export class SchemaInvalidError extends Error {
  readonly issues: Issue[]
  constructor(issues: Issue[]) {
    super(`Invalid schema: ${issues[0]?.message ?? 'unknown problem'}`)
    this.name = 'SchemaInvalidError'
    this.issues = issues
  }
}

const escapePointer = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1')
const pad = (n: number, width: number): string => String(n).padStart(width, '0')

/** Deterministic phone number for ordinal `n`: `+91 90000 ` + n mod 100000, zero-padded to 5 digits. */
export const phoneFor = (n: number): string => `+91 90000 ${pad(n % 100000, 5)}`

/** 2026-01-01 plus `n` days. */
function dateString(n: number): string {
  return new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10)
}

/**
 * integer / number value at ordinal n (FND-03 rule, ruled 2026-11-07): start at `min` (default 1)
 * and count up with the ordinal, stopping at `max`. `number` adds 0.5. An integer node stays integral
 * even when min/max are fractional (ceil of min, floor of max).
 */
function rangeValue(n: number, node: MockNode, fractional: boolean): number {
  let lo = typeof node.min === 'number' ? node.min : 1
  let hi = typeof node.max === 'number' ? node.max : undefined
  if (!fractional) {
    lo = Math.ceil(lo)
    if (hi !== undefined) hi = Math.floor(hi)
  }
  const v = lo + (n - 1) + (fractional ? 0.5 : 0)
  return hi !== undefined && v > hi ? hi : v
}

const pick = <T>(list: readonly T[], r: () => number): T => list[Math.floor(r() * list.length)] as T

function uuidFromRng(r: () => number): string {
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(r() * 256)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  return formatUuid(bytes)
}

/** Values for `seeded` and `random` modes: realistic-looking, drawn from the in-repo pools. */
function realisticValue(
  node: MockNode,
  key: string,
  r: () => number,
): string | number | boolean | null {
  switch (node.type) {
    case 'string':
      if (/name|title/i.test(key)) return pick(NAMES, r)
      if (/city|godown/i.test(key)) return pick(CITIES, r)
      return `${pick(WORDS, r)}-${100 + Math.floor(r() * 900)}`
    case 'email':
      return `${pick(WORDS, r)}.${pick(WORDS, r)}@${pick(WORDS, r)}.example.com`
    case 'url':
      return `https://${pick(WORDS, r)}.example.com/${pick(WORDS, r)}`
    case 'phone':
      return `+91 90000 ${pad(Math.floor(r() * 100000), 5)}`
    case 'integer': {
      const lo = typeof node.min === 'number' ? node.min : 1
      const hi = typeof node.max === 'number' ? node.max : lo + 3999
      return lo + Math.floor(r() * (hi - lo + 1))
    }
    case 'number': {
      const lo = typeof node.min === 'number' ? node.min : 1
      const hi = typeof node.max === 'number' ? node.max : lo + 899
      return Math.round((lo + r() * (hi - lo)) * 100) / 100
    }
    case 'boolean':
      return r() < 0.5
    case 'uuid':
      return uuidFromRng(r)
    case 'date':
      return dateString(1 + Math.floor(r() * 300))
    case 'datetime':
      return `${dateString(1 + Math.floor(r() * 300))}T${pad(Math.floor(r() * 24), 2)}:${pad(Math.floor(r() * 60), 2)}:00+05:30`
    default:
      return null
  }
}

/**
 * Generates the response body for `schema`. `value = f(key, type, ordinal)`; see FND-03 for the frozen rules.
 * Validates first (cheap, never expands the tree) so a schema over a limit throws `GenerationLimitError`
 * before any output is allocated.
 */
export function generate(
  schema: MockSchema,
  ctx: GenContext,
  opts?: { indent?: number },
): GenerateResult {
  const validated = validateSchema(
    schema,
    ctx.components ? { components: ctx.components } : undefined,
  )
  if (!validated.ok) {
    const nonLimit = validated.issues.filter((i) => !LIMIT_CODES.has(i.code))
    const first = validated.issues[0]
    if (nonLimit.length > 0 || !first) throw new SchemaInvalidError(validated.issues)
    throw new GenerationLimitError(first.code as LimitCode, first.message)
  }

  const merged: Record<string, MockNode> = { ...schema.components, ...(ctx.components ?? {}) }
  const { indexing, mode } = ctx.settings
  const indent = Math.max(0, Math.floor(opts?.indent ?? 0))
  const unit = ' '.repeat(indent)
  const colon = indent > 0 ? ': ' : ':'
  const nl = (level: number): string => (indent > 0 ? `\n${unit.repeat(level)}` : '')
  const globalRandom = ctx.random ?? Math.random

  const parts: string[] = []
  const provenance: Record<string, Provenance> = {}

  const resolveType = (node: MockNode): NodeType => {
    let cur = node
    // cycles are rejected by validateSchema, so this terminates
    while (cur.type === 'ref') cur = merged[cur.name as string] as MockNode
    return cur.type
  }

  /** Writes a JSON literal in the same layout as the rest of the output, recording leaf provenance. */
  const writeLiteral = (value: Json, ptr: string, level: number, prov: Provenance): void => {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        parts.push('[]')
        provenance[ptr] = prov
        return
      }
      parts.push('[')
      value.forEach((item, i) => {
        parts.push((i > 0 ? ',' : '') + nl(level + 1))
        writeLiteral(item, `${ptr}/${i}`, level + 1, prov)
      })
      parts.push(`${nl(level)}]`)
    } else if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value)
      if (keys.length === 0) {
        parts.push('{}')
        provenance[ptr] = prov
        return
      }
      parts.push('{')
      keys.forEach((k, i) => {
        parts.push((i > 0 ? ',' : '') + nl(level + 1) + JSON.stringify(k) + colon)
        writeLiteral(value[k] as Json, `${ptr}/${escapePointer(k)}`, level + 1, prov)
      })
      parts.push(`${nl(level)}}`)
    } else {
      parts.push(JSON.stringify(value))
      provenance[ptr] = prov
    }
  }

  const leaf = (
    node: MockNode,
    key: string | null,
    n: number,
    pfx: string,
    ptr: string,
    spath: string,
    level: number,
  ): void => {
    const plainKey = key ?? 'item'

    // 2. preset rule
    if (ctx.presets) {
      const hit = ctx.presets({ key, schemaPath: spath, type: node.type })
      if (hit) {
        if ('value' in hit) return writeLiteral(hit.value, ptr, level, 'preset')
        if ('values' in hit && hit.values.length > 0)
          return writeLiteral(hit.values[(n - 1) % hit.values.length] as Json, ptr, level, 'preset')
        if ('pattern' in hit) {
          parts.push(JSON.stringify(applyPattern(hit.pattern, n, plainKey)))
          provenance[ptr] = 'preset'
          return
        }
      }
    }
    // 3. examples[]
    if (Array.isArray(node.examples) && node.examples.length > 0)
      return writeLiteral(
        node.examples[(n - 1) % node.examples.length] as Json,
        ptr,
        level,
        'example',
      )
    // 4. enum.values
    if (node.type === 'enum' && Array.isArray(node.values) && node.values.length > 0) {
      parts.push(JSON.stringify(node.values[(n - 1) % node.values.length]))
      provenance[ptr] = 'enum'
      return
    }
    // 5. per-type rule
    const k = (indexing === 'path' ? pfx : '') + plainKey
    let value: string | number | boolean | null
    let prov: Provenance = 'generated'
    if (mode !== 'deterministic') {
      const rng = mode === 'seeded' ? mulberry32(hash32(`${ctx.projectId}|${ptr}`)) : globalRandom
      if (mode === 'random') prov = 'random'
      value = realisticValue(node, plainKey, rng)
    } else {
      switch (node.type) {
        case 'string':
          value = `${k}-${n}`
          break
        case 'email':
          value = `${k}-${n}@example.com`
          break
        case 'url':
          value = `https://example.com/${k}-${n}`
          break
        case 'integer':
          value = rangeValue(n, node, false)
          break
        case 'number':
          value = rangeValue(n, node, true)
          break
        case 'boolean':
          value = n % 2 === 1
          break
        case 'uuid':
          value = uuidv5(UUID_NAMESPACE, `${ctx.projectId}|${ptr}|${n}`)
          break
        case 'date':
          value = dateString(n)
          break
        case 'datetime':
          value = `${dateString(n)}T00:00:00+05:30`
          break
        case 'phone':
          value = phoneFor(n)
          break
        default:
          value = null
      }
    }
    parts.push(JSON.stringify(value))
    provenance[ptr] = prov
  }

  const emit = (
    node: MockNode,
    key: string | null,
    n: number,
    pfx: string,
    ptr: string,
    spath: string,
    level: number,
  ): void => {
    // 1. fixed always wins, on any node type, detected by key presence
    if ('fixed' in node) return writeLiteral(node.fixed as Json, ptr, level, 'fixed')

    switch (node.type) {
      case 'ref':
        return emit(merged[node.name as string] as MockNode, key, n, pfx, ptr, spath, level)
      case 'object': {
        const fields = node.fields ?? []
        if (fields.length === 0) {
          parts.push('{}')
          return
        }
        parts.push('{')
        fields.forEach((f, i) => {
          parts.push((i > 0 ? ',' : '') + nl(level + 1) + JSON.stringify(f.key) + colon)
          emit(
            f.node,
            f.key,
            n,
            pfx,
            `${ptr}/${escapePointer(f.key)}`,
            `${spath}.${f.key}`,
            level + 1,
          )
        })
        parts.push(`${nl(level)}}`)
        return
      }
      case 'array': {
        const count = node.count ?? 3
        const items = node.items as MockNode
        if (count === 0) {
          parts.push('[]')
          return
        }
        const itemType = resolveType(items)
        const branch = itemType === 'object' || itemType === 'array'
        parts.push('[')
        for (let i = 1; i <= count; i++) {
          parts.push((i > 1 ? ',' : '') + nl(level + 1))
          const childPfx = indexing === 'path' && branch ? `${pfx}${key ?? 'item'}-${i}-` : pfx
          emit(items, key, i, childPfx, `${ptr}/${i - 1}`, `${spath}[*]`, level + 1)
        }
        parts.push(`${nl(level)}]`)
        return
      }
      default:
        return leaf(node, key, n, pfx, ptr, spath, level)
    }
  }

  emit(schema.root, null, 1, '', '', '$', 0)
  return { json: parts.join(''), provenance }
}

/**
 * Convenience: the generated body as a JS value. Loses key order for integer-like keys ("200", "1"),
 * because JS objects reorder them; use `generate().json` wherever order matters.
 */
export function generateValue(schema: MockSchema, ctx: GenContext): Json {
  return JSON.parse(generate(schema, ctx).json) as Json
}
