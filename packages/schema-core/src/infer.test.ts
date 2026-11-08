import { describe, expect, it } from 'vitest'
import { LIMITS, generate, inferSchema, validateSchema } from './index'
import type { InferWarning, MockNode, MockSchema } from './index'

const fields = (n: MockNode) => (n.fields ?? []).map((f) => f.key)
const field = (n: MockNode, key: string): MockNode => {
  const f = (n.fields ?? []).find((x) => x.key === key)
  if (!f) throw new Error(`no field ${key}`)
  return f.node
}
const codes = (w: InferWarning[]) => w.map((x) => x.code)
const only = (sample: unknown) => inferSchema(sample).schema.root

describe('the spec example', () => {
  const sample = {
    id: '8c1f0e2a-5b43-4c9d-9f12-6a7b8c9d0e1f',
    n: 1,
    x: 1.5,
    d: '2026-01-02',
    e: 'a@b.co',
    u: 'https://x.io',
    z: null,
    arr: [{ a: 1 }, { b: 'x' }],
  }

  it('infers uuid, integer, number, date, email, url; null becomes a nullable string with null_value', () => {
    const { schema, warnings } = inferSchema(sample)
    const root = schema.root
    expect(root.type).toBe('object')
    expect(field(root, 'id').type).toBe('uuid')
    expect(field(root, 'n').type).toBe('integer')
    expect(field(root, 'x').type).toBe('number')
    expect(field(root, 'd').type).toBe('date')
    expect(field(root, 'e').type).toBe('email')
    expect(field(root, 'u').type).toBe('url')
    expect(field(root, 'z')).toEqual({ type: 'string', nullable: true })
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'null_value', path: '$.z' }))
  })

  it('arr is count 2 over an object whose a and b are nullable, with optional_key and mixed_array_shapes', () => {
    const { schema, warnings } = inferSchema(sample)
    const arr = field(schema.root, 'arr')
    expect(arr.type).toBe('array')
    expect(arr.count).toBe(2)
    const item = arr.items as MockNode
    expect(item.type).toBe('object')
    expect(fields(item)).toEqual(['a', 'b'])
    expect(field(item, 'a')).toEqual({ type: 'integer', nullable: true })
    expect(field(item, 'b')).toEqual({ type: 'string', nullable: true })
    expect(codes(warnings)).toContain('mixed_array_shapes')
    const optional = warnings.filter((w) => w.code === 'optional_key').map((w) => w.path)
    expect(optional.sort()).toEqual(['$.arr[*].a', '$.arr[*].b'])
  })

  it('preserves key order', () => {
    expect(fields(only(sample))).toEqual(['id', 'n', 'x', 'd', 'e', 'u', 'z', 'arr'])
    // Limitation, not a bug: a parsed JS object has already moved integer-like keys ("1", "200") to the
    // front in ascending order, so that order cannot be recovered from a value (see the FND-04 spec).
    expect(fields(only({ b: 1, a: 2, '200': 3, '1': 4 }))).toEqual(['1', '200', 'b', 'a'])
  })

  it('the result validates, and the schema generates', () => {
    const { schema } = inferSchema(sample)
    expect(validateSchema(schema).ok).toBe(true)
    const out = generate(schema, {
      projectId: '11111111-1111-7111-8111-111111111111',
      settings: { indexing: 'local', mode: 'deterministic' },
    })
    expect(JSON.parse(out.json)).toBeTypeOf('object')
  })
})

describe('roots of any type', () => {
  it('[] is a root array of string with count 0 and an empty_array warning', () => {
    const { schema, warnings } = inferSchema([])
    expect(schema.root).toEqual({ type: 'array', count: 0, items: { type: 'string' } })
    expect(codes(warnings)).toEqual(['empty_array'])
    expect(validateSchema(schema).ok).toBe(true)
  })
  it('5 is a root integer; 1.5 a number; true a boolean; a string by its pattern', () => {
    expect(inferSchema(5).schema.root).toEqual({ type: 'integer' })
    expect(inferSchema(1.5).schema.root).toEqual({ type: 'number' })
    expect(inferSchema(true).schema.root).toEqual({ type: 'boolean' })
    expect(inferSchema('hello').schema.root).toEqual({ type: 'string' })
    expect(inferSchema('a@b.co').schema.root).toEqual({ type: 'email' })
  })
  it('null at the root is a nullable string with null_value at $', () => {
    const { schema, warnings } = inferSchema(null)
    expect(schema.root).toEqual({ type: 'string', nullable: true })
    expect(warnings).toEqual([expect.objectContaining({ code: 'null_value', path: '$' })])
  })
  it('a root array of objects is allowed and its items follow the same rules', () => {
    const { schema } = inferSchema([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(schema.root.type).toBe('array')
    expect(schema.root.count).toBe(3)
    expect(fields(schema.root.items as MockNode)).toEqual(['id'])
  })
})

describe('semantic string detection', () => {
  const t = (s: string) => only(s).type
  it('detects each semantic type', () => {
    expect(t('a@b.co')).toBe('email')
    expect(t('8c1f0e2a-5b43-4c9d-9f12-6a7b8c9d0e1f')).toBe('uuid') // v4
    expect(t('01890a5d-ac96-774b-bcce-b302099a8057')).toBe('uuid') // v7
    expect(t('8C1F0E2A-5B43-4C9D-9F12-6A7B8C9D0E1F')).toBe('uuid') // upper case
    expect(t('2026-01-02')).toBe('date')
    expect(t('2026-01-02T10:00:00Z')).toBe('datetime')
    expect(t('2026-01-02T10:00:00+05:30')).toBe('datetime')
    expect(t('2026-01-02T10:00:00.123-0800')).toBe('datetime')
    expect(t('2026-01-02T10:00Z')).toBe('datetime')
    expect(t('https://example.com/x?y=1')).toBe('url')
    expect(t('http://192.168.1.24:8080/mock/demo')).toBe('url')
  })
  it('falls back to string for lookalikes', () => {
    expect(t('2026-02-30')).toBe('string') // not a real date
    expect(t('2026-13-01')).toBe('string')
    expect(t('2026-01-02T10:00:00')).toBe('string') // no offset
    expect(t('2026-01-02T25:00:00Z')).toBe('string')
    expect(t('ftp://example.com')).toBe('string')
    expect(t('example.com')).toBe('string')
    expect(t('not an email@')).toBe('string')
    expect(t('8c1f0e2a-5b43-4c9d-9f12')).toBe('string')
    expect(t('')).toBe('string')
  })
  it('whole numbers are integer, including 1.0 (which JSON parses as 1)', () => {
    expect(only(JSON.parse('1.0')).type).toBe('integer')
    expect(only(-3).type).toBe('integer')
    expect(only(0.1).type).toBe('number')
  })
})

describe('arrays', () => {
  it('count is the sample length and items come from the elements', () => {
    const n = only({ tags: ['a', 'b', 'c', 'd'] })
    expect(field(n, 'tags')).toEqual({ type: 'array', count: 4, items: { type: 'string' } })
  })
  it('elements of different types use the first and warn mixed_array_types', () => {
    const { schema, warnings } = inferSchema({ v: [1, 'a', true] })
    expect(field(schema.root, 'v').items).toEqual({ type: 'integer' })
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'mixed_array_types', path: '$.v[*]' }),
    )
  })
  it('an object next to a primitive is a type mismatch, not a shape mismatch', () => {
    const { warnings } = inferSchema([{ a: 1 }, 'x'])
    expect(codes(warnings)).toContain('mixed_array_types')
    expect(codes(warnings)).not.toContain('mixed_array_shapes')
  })
  it('elements with identical shapes produce no warnings', () => {
    expect(
      inferSchema([
        { a: 1, b: 'x' },
        { a: 2, b: 'y' },
      ]).warnings,
    ).toEqual([])
  })
  it('the union of keys keeps first-seen order and nests: shapes differ inside a shared key', () => {
    const { schema, warnings } = inferSchema([
      { id: 1, meta: { a: 1 } },
      { id: 2, meta: { b: 2 }, extra: true },
    ])
    const item = schema.root.items as MockNode
    expect(fields(item)).toEqual(['id', 'meta', 'extra'])
    expect(fields(field(item, 'meta'))).toEqual(['a', 'b'])
    expect(field(item, 'extra')).toEqual({ type: 'boolean', nullable: true })
    expect(
      warnings
        .filter((w) => w.code === 'mixed_array_shapes')
        .map((w) => w.path)
        .sort(),
    ).toEqual(['$[*]', '$[*].meta'])
  })
  it('a null among known values makes the node nullable without a null_value warning', () => {
    const { schema, warnings } = inferSchema([{ a: null }, { a: 'x' }])
    expect(field(schema.root.items as MockNode, 'a')).toEqual({ type: 'string', nullable: true })
    expect(codes(warnings)).not.toContain('null_value')
  })
  it('nested arrays infer from the first inner array', () => {
    const n = only([[1, 2], [3]])
    expect(n).toEqual({
      type: 'array',
      count: 2,
      items: { type: 'array', count: 2, items: { type: 'integer' } },
    })
  })
})

describe('keys MockSchema cannot hold', () => {
  it('skips empty, __proto__ and over-long keys with an invalid_key warning, so the schema still validates', () => {
    const sample = JSON.parse(`{"": 1, "__proto__": 2, "${'k'.repeat(201)}": 3, "ok": 4}`)
    const { schema, warnings } = inferSchema(sample)
    expect(fields(schema.root)).toEqual(['ok'])
    expect(warnings.filter((w) => w.code === 'invalid_key')).toHaveLength(3)
    expect(validateSchema(schema).ok).toBe(true)
  })
})

describe('limits: a sample over a limit gives an empty-object schema and limits_exceeded', () => {
  const emptyObject: MockSchema = {
    version: 1,
    components: {},
    root: { type: 'object', fields: [] },
  }
  const expectStopped = (sample: unknown) => {
    const { schema, warnings } = inferSchema(sample)
    expect(schema).toEqual(emptyObject)
    expect(codes(warnings)).toEqual(['limits_exceeded'])
    expect(warnings[0]?.path).toBe('$')
    expect(validateSchema(schema).ok).toBe(true)
  }

  it('nested deeper than the depth limit', () => {
    let v: unknown = 1
    for (let i = 0; i < LIMITS.maxDepth + 1; i++) v = { a: v }
    expectStopped(v)
  })
  it('exactly the depth limit still infers', () => {
    let v: unknown = 1
    for (let i = 0; i < LIMITS.maxDepth - 1; i++) v = { a: v }
    expect(codes(inferSchema(v).warnings)).not.toContain('limits_exceeded')
  })
  it('an array longer than 1,000', () => {
    expectStopped(Array.from({ length: LIMITS.maxArrayCount + 1 }, () => 1))
    expect(
      codes(inferSchema(Array.from({ length: LIMITS.maxArrayCount }, () => 1)).warnings),
    ).not.toContain('limits_exceeded')
  })
  it('more than 2,000 nodes', () => {
    const wide: Record<string, number> = {}
    for (let i = 0; i < LIMITS.maxNodes + 1; i++) wide[`k${i}`] = i
    expectStopped(wide)
  })
  it('a leaf count over 50,000 (1000 x 1000)', () => {
    expectStopped(Array.from({ length: 1000 }, () => Array.from({ length: 1000 }, () => 1)))
  })
  it('a pathologically deep sample does not overflow the stack', () => {
    let v: unknown[] = []
    for (let i = 0; i < 50_000; i++) v = [v]
    expectStopped(v)
  })
  it('a circular sample does not hang or throw', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expectStopped(a)
  })
})

describe('robustness', () => {
  it('does not mutate its input', () => {
    const sample = { a: [{ b: 1 }, { c: null }], d: 'x@y.zz' }
    const before = JSON.stringify(sample)
    inferSchema(sample)
    expect(JSON.stringify(sample)).toBe(before)
  })
  it('never throws on non-JSON values and still validates', () => {
    for (const s of [undefined, () => 1, Symbol('x'), 10n, new Date(0), { f: () => 1 }]) {
      const { schema } = inferSchema(s)
      expect(validateSchema(schema).ok).toBe(true)
    }
  })
})

describe('fuzz: every inferred schema validates (and generates)', () => {
  // Plain seeded LCG so failures are reproducible and nothing extra is installed.
  function rng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 2 ** 32
    }
  }
  const STRINGS = [
    '',
    'x',
    'hello world',
    'a@b.co',
    '8c1f0e2a-5b43-4c9d-9f12-6a7b8c9d0e1f',
    '2026-01-02',
    '2026-01-02T10:00:00Z',
    'https://x.io/p',
    '2026-02-30',
    'ftp://x',
  ]
  function sampleOf(r: () => number, depth: number): unknown {
    const k = Math.floor(r() * (depth >= 4 ? 5 : 7))
    switch (k) {
      case 0:
        return null
      case 1:
        return r() < 0.5
      case 2:
        return Math.floor(r() * 1000) - 500
      case 3:
        return Math.round(r() * 10000) / 100 + 0.5
      case 4:
        return STRINGS[Math.floor(r() * STRINGS.length)]
      case 5: {
        const n = Math.floor(r() * 5)
        return Array.from({ length: n }, () => sampleOf(r, depth + 1))
      }
      default: {
        const o: Record<string, unknown> = {}
        const n = Math.floor(r() * 5)
        for (let i = 0; i < n; i++) o[`k${Math.floor(r() * 6)}`] = sampleOf(r, depth + 1)
        return o
      }
    }
  }

  it('300 random samples', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const sample = sampleOf(rng(seed), 0)
      const { schema } = inferSchema(sample)
      const res = validateSchema(schema)
      if (!res.ok) throw new Error(`seed ${seed}: ${JSON.stringify(res.issues)}`)
      const out = generate(schema, {
        projectId: '11111111-1111-7111-8111-111111111111',
        settings: { indexing: 'local', mode: 'deterministic' },
      })
      JSON.parse(out.json) // valid JSON
    }
  })
})
