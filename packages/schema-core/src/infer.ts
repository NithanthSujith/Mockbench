import { LIMITS } from './limits'
import type { FieldEntry, MockNode, MockSchema } from './types'
import { emptySchema, validateSchema } from './validate'

export type WarningCode =
  | 'null_value'
  | 'empty_array'
  | 'mixed_array_shapes'
  | 'mixed_array_types'
  | 'optional_key'
  | 'invalid_key'
  | 'limits_exceeded'

export interface InferWarning {
  /** Schema path of the node concerned: `$.orders[*].total` (`[*]` = any array element). */
  path: string
  code: WarningCode
  message: string
}

export interface InferResult {
  schema: MockSchema
  warnings: InferWarning[]
}

// Semantic detectors, tried in DESIGN's order: email, UUID, date, datetime, URL.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/
const URL_RE = /^https?:\/\/\S+$/i

function isRealDate(y: string, m: string, d: string): boolean {
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  const dt = new Date(Date.UTC(year, month - 1, day))
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
}

function stringType(s: string): 'email' | 'uuid' | 'date' | 'datetime' | 'url' | 'string' {
  if (EMAIL_RE.test(s)) return 'email'
  if (UUID_RE.test(s)) return 'uuid'
  const d = DATE_RE.exec(s)
  if (d && isRealDate(d[1] as string, d[2] as string, d[3] as string)) return 'date'
  const dt = DATETIME_RE.exec(s)
  if (
    dt &&
    isRealDate(dt[1] as string, dt[2] as string, dt[3] as string) &&
    Number(dt[4]) < 24 &&
    Number(dt[5]) < 60 &&
    Number(dt[6] ?? 0) < 60
  )
    return 'datetime'
  if (URL_RE.test(s)) return 'url'
  return 'string'
}

type Kind = 'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'other'

function kindOf(v: unknown): Kind {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return 'array'
  switch (typeof v) {
    case 'object':
      return 'object'
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'other'
  }
}

/** Thrown internally when the sample is bigger than a MockSchema may be; caught in `inferSchema`. */
class LimitStop extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Walks a sample JSON value and guesses a MockSchema node per value (DESIGN § Inferring a schema).
 * A starting point, not an answer: every guess that the sample cannot settle comes back as a warning.
 * The returned schema ALWAYS validates; a sample over the size limits yields an empty-object schema
 * plus a `limits_exceeded` warning instead.
 */
export function inferSchema(sample: unknown): InferResult {
  const warnings: InferWarning[] = []
  let nodes = 0

  const warn = (path: string, code: WarningCode, message: string): void => {
    warnings.push({ path, code, message })
  }
  const count = (): void => {
    if (++nodes > LIMITS.maxNodes) throw new LimitStop(`more than ${LIMITS.maxNodes} nodes`)
  }

  /** Infers one node from `values`: all the samples seen at this position (one, or the elements of an array). */
  const inferMany = (values: unknown[], path: string, depth: number, mixedAt: string): MockNode => {
    if (depth > LIMITS.maxDepth) throw new LimitStop(`nested more than ${LIMITS.maxDepth} levels`)
    count()

    const present = values.filter((v) => kindOf(v) !== 'null')
    const sawNull = present.length !== values.length
    if (present.length === 0) {
      warn(
        path,
        'null_value',
        'Real type unknown (the sample value was null); defaulted to string.',
      )
      return { type: 'string', nullable: true }
    }

    const kinds = new Set(present.map(kindOf))
    if (kinds.size > 1) {
      warn(
        mixedAt,
        'mixed_array_types',
        `Samples disagree on type (${[...kinds].join(', ')}); used the first one.`,
      )
    }
    const first = present[0]
    let node: MockNode

    if (kindOf(first) === 'object') {
      const objs = present.filter(isObject)
      const keyOrder: string[] = []
      const seen = new Map<string, unknown[]>()
      for (const o of objs) {
        for (const k of Object.keys(o)) {
          let bucket = seen.get(k)
          if (!bucket) {
            bucket = []
            seen.set(k, bucket)
            keyOrder.push(k)
          }
          bucket.push(o[k])
        }
      }
      const shapes = new Set(objs.map((o) => Object.keys(o).sort().join('\u0000')))
      if (objs.length > 1 && shapes.size > 1) {
        warn(
          path,
          'mixed_array_shapes',
          'Elements have different keys; used the union of all keys.',
        )
      }
      const fields: FieldEntry[] = []
      for (const k of keyOrder) {
        const childPath = `${path}.${k}`
        if (k === '' || k === '__proto__' || k.length > LIMITS.maxKeyLength) {
          warn(
            childPath,
            'invalid_key',
            `Skipped a key MockSchema cannot hold (${JSON.stringify(k.slice(0, 40))}).`,
          )
          continue
        }
        const bucket = seen.get(k) as unknown[]
        const child = inferMany(bucket, childPath, depth + 1, childPath)
        if (bucket.length < objs.length) {
          child.nullable = true
          warn(childPath, 'optional_key', 'Key is missing from some elements; marked nullable.')
        }
        fields.push({ key: k, node: child })
      }
      node = { type: 'object', fields }
    } else if (kindOf(first) === 'array') {
      const arr = first as unknown[]
      if (arr.length > LIMITS.maxArrayCount)
        throw new LimitStop(`an array longer than ${LIMITS.maxArrayCount}`)
      const itemsPath = `${path}[*]`
      if (arr.length === 0) {
        warn(path, 'empty_array', 'Empty array: item type unknown; defaulted to string.')
        count()
        node = { type: 'array', count: 0, items: { type: 'string' } }
      } else {
        node = {
          type: 'array',
          count: arr.length,
          items: inferMany(arr, itemsPath, depth + 1, itemsPath),
        }
      }
    } else if (kindOf(first) === 'string') {
      node = { type: stringType(first as string) }
    } else if (kindOf(first) === 'boolean') {
      node = { type: 'boolean' }
    } else if (kindOf(first) === 'number') {
      node = { type: Number.isInteger(first) ? 'integer' : 'number' }
    } else {
      node = { type: 'string' }
    }

    if (sawNull) node.nullable = true
    return node
  }

  try {
    const root = inferMany([sample], '$', 1, '$')
    const schema: MockSchema = { version: 1, components: {}, root }
    const checked = validateSchema(schema)
    if (!checked.ok) {
      const first = checked.issues[0]
      throw new LimitStop(first ? first.message : 'the schema is too large')
    }
    return { schema, warnings }
  } catch (e) {
    if (!(e instanceof LimitStop)) throw e
    return {
      schema: emptySchema(),
      warnings: [
        {
          path: '$',
          code: 'limits_exceeded',
          message: `The sample is too large to infer a schema from (${e.message}); nothing was inferred.`,
        },
      ],
    }
  }
}
