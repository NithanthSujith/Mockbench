import { describe, expect, it } from 'vitest'
import allTypes from '../fixtures/all-types.schema.json'
import workedExample from '../fixtures/worked-example.schema.json'
import { NODE_TYPES, emptySchema, mockSchemaZod, validateSchema } from './index'
import type { Issue, MockNode, ValidateResult } from './index'

type F = [string, MockNode]
const obj = (...fields: F[]): MockNode => ({
  type: 'object',
  fields: fields.map(([key, node]) => ({ key, node })),
})
const arr = (items: MockNode, count?: number): MockNode =>
  count === undefined ? { type: 'array', items } : { type: 'array', items, count }
const str: MockNode = { type: 'string' }
const env = (root: MockNode, components: Record<string, MockNode> = {}) => ({
  version: 1,
  components,
  root,
})
const issues = (r: ValidateResult): Issue[] => (r.ok ? [] : r.issues)
const codes = (r: ValidateResult): string[] => issues(r).map((i) => i.code)
const chain = (length: number): MockNode => {
  let n: MockNode = str
  for (let i = 1; i < length; i++) n = obj(['a', n])
  return n
}

function countNodes(n: MockNode): number {
  let c = 1
  for (const f of n.fields ?? []) c += countNodes(f.node)
  if (n.items) c += countNodes(n.items)
  return c
}

describe('worked example', () => {
  it('validates and stats.nodes equals the authored node count', () => {
    const r = validateSchema(workedExample)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(countNodes(workedExample.root as MockNode)).toBe(15)
    expect(r.stats.nodes).toBe(15)
    expect(r.stats.depth).toBe(4) // root > orders > item object > total
    expect(r.stats.estimatedLeaves).toBe(5 + 3 + 2 + 2 * 2) // 5 scalars + branch_list(3) + address(2) + orders(2x2)
  })
})

describe('version and node types', () => {
  it('rejects version 2 with unsupported_schema_version', () => {
    const r = validateSchema({ ...workedExample, version: 2 })
    expect(codes(r)).toEqual(['unsupported_schema_version'])
    expect(issues(r)[0]?.path).toEqual(['version'])
  })
  it('rejects an unknown node type with unknown_node_type and the path to it', () => {
    const r = validateSchema(env(obj(['x', { type: 'wat' } as unknown as MockNode])))
    expect(codes(r)).toEqual(['unknown_node_type'])
    expect(issues(r)[0]?.path).toEqual(['root', 'fields', 0, 'node', 'type'])
  })
})

describe('unknown keys and source', () => {
  it('preserves source and unrelated unknown keys byte-for-byte', () => {
    const input = env(
      obj([
        'id',
        {
          type: 'string',
          source: { from: 'path', name: 'id' },
          'x-vendor': 1,
        },
      ]),
    )
    const r = validateSchema(input)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const node = r.schema.root.fields?.[0]?.node
    expect(node?.source).toEqual({ from: 'path', name: 'id' })
    expect(node?.['x-vendor']).toBe(1)
    expect(JSON.stringify(JSON.parse(JSON.stringify(r.schema)))).toBe(JSON.stringify(input))
  })
  it('round-trips the every-node-type fixture (with unknown keys) unchanged', () => {
    const r = validateSchema(allTypes)
    expect(issues(r)).toEqual([])
    if (!r.ok) return
    const text = JSON.stringify(allTypes)
    expect(JSON.stringify(r.schema)).toBe(text)
    expect(JSON.parse(JSON.stringify(r.schema))).toEqual(JSON.parse(text))
    // every node type appears in the fixture
    const seen = new Set<string>()
    const visit = (n: MockNode) => {
      seen.add(n.type)
      n.fields?.forEach((f) => visit(f.node))
      if (n.items) visit(n.items)
    }
    visit(r.schema.root)
    for (const t of NODE_TYPES) expect(seen.has(t), `fixture lacks node type ${t}`).toBe(true)
  })
})

describe('keys', () => {
  it('rejects a duplicate key with duplicate_key', () => {
    expect(codes(validateSchema(env(obj(['a', str], ['a', str]))))).toEqual(['duplicate_key'])
  })
  it('rejects an empty key with empty_key', () => {
    expect(codes(validateSchema(env(obj(['', str]))))).toEqual(['empty_key'])
  })
  it('rejects __proto__ with forbidden_key', () => {
    expect(codes(validateSchema(env(obj(['__proto__', str]))))).toEqual(['forbidden_key'])
  })
})

describe('limits', () => {
  it('accepts depth 10 and rejects depth 11 with depth_exceeded', () => {
    expect(validateSchema(env(chain(10))).ok).toBe(true)
    expect(codes(validateSchema(env(chain(11))))).toContain('depth_exceeded')
  })
  it('accepts 2,000 nodes and rejects 2,001 with node_limit_exceeded', () => {
    const fields = (n: number): F[] => Array.from({ length: n }, (_, i) => [`k${i}`, str] as F)
    expect(validateSchema(env(obj(...fields(1999)))).ok).toBe(true)
    expect(codes(validateSchema(env(obj(...fields(2000)))))).toEqual(['node_limit_exceeded'])
  })
  it('rejects count 1001 with array_count_exceeded and accepts 1000', () => {
    expect(validateSchema(env(arr(str, 1000))).ok).toBe(true)
    expect(codes(validateSchema(env(arr(str, 1001))))).toEqual(['array_count_exceeded'])
  })
  it('rejects 1,000,000 estimated leaves with leaf_limit_exceeded in under 50 ms', () => {
    const t0 = performance.now()
    const r = validateSchema(env(arr(arr(str, 1000), 1000)))
    const ms = performance.now() - t0
    expect(codes(r)).toEqual(['leaf_limit_exceeded'])
    expect(ms).toBeLessThan(50)
  })
  it('does not turn a count-0 array over an unbounded child into NaN', () => {
    const huge = arr(arr(arr(arr(str, 1000), 1000), 1000), 1000) // would overflow past 1e12
    expect(codes(validateSchema(env(obj(['a', arr(huge, 0)], ['b', huge]))))).toContain(
      'leaf_limit_exceeded',
    )
    expect(validateSchema(env(arr(huge, 0))).ok).toBe(true)
  })
  it('measures depth on the expanded tree through refs', () => {
    const comps = { C: chain(9) }
    const r = validateSchema(env(obj(['x', { type: 'ref', name: 'C' }]), comps))
    // root object (1) + C (9 nodes) = 10 -> ok; one more wrapper -> 11 -> depth_exceeded
    expect(r.ok).toBe(true)
    const r2 = validateSchema(env(obj(['y', obj(['x', { type: 'ref', name: 'C' }])]), comps))
    expect(codes(r2)).toContain('depth_exceeded')
  })
})

describe('refs', () => {
  it('rejects a ref to an undefined name with unknown_ref', () => {
    const r = validateSchema(env(obj(['x', { type: 'ref', name: 'Nope' }])))
    expect(codes(r)).toEqual(['unknown_ref'])
    expect(issues(r)[0]?.path).toEqual(['root', 'fields', 0, 'node'])
  })
  it('rejects a self-referencing component with ref_cycle', () => {
    const comps = { A: obj(['me', { type: 'ref', name: 'A' }]) }
    expect(codes(validateSchema(env(obj(['x', { type: 'ref', name: 'A' }]), comps)))).toEqual([
      'ref_cycle',
    ])
  })
  it('rejects A -> B -> A with ref_cycle, even when the root never uses them', () => {
    const comps = {
      A: obj(['b', { type: 'ref', name: 'B' }]),
      B: obj(['a', { type: 'ref', name: 'A' }]),
    }
    const r = validateSchema(env(obj(['x', str]), comps))
    expect(codes(r)).toEqual(['ref_cycle'])
  })
  it('resolves a ref via opts.components, and caller-supplied components win', () => {
    const input = env(obj(['x', { type: 'ref', name: 'User' }]))
    expect(validateSchema(input).ok).toBe(false)
    expect(validateSchema(input, { components: { User: obj(['n', str]) } }).ok).toBe(true)
    const own = env(obj(['x', { type: 'ref', name: 'User' }]), { User: chain(9) })
    // envelope's User is 9 deep (ok); the override is 11 deep (rejected) -> proves the override is the one used
    const r = validateSchema(own, { components: { User: chain(11) } })
    expect(r.ok).toBe(false)
  })
})

describe('attributes', () => {
  it('rejects integer min 5 max 1 with min_greater_than_max', () => {
    const r = validateSchema(env(obj(['x', { type: 'integer', min: 5, max: 1 }])))
    expect(codes(r)).toEqual(['min_greater_than_max'])
  })
  it('rejects an enum with values [] with enum_empty (and a missing values key)', () => {
    expect(codes(validateSchema(env(obj(['x', { type: 'enum', values: [] }]))))).toEqual([
      'enum_empty',
    ])
    expect(codes(validateSchema(env(obj(['x', { type: 'enum' }]))))).toEqual(['enum_empty'])
  })
  it('reports missing_items and missing_fields', () => {
    expect(codes(validateSchema(env({ type: 'array' })))).toEqual(['missing_items'])
    expect(codes(validateSchema(env({ type: 'object' })))).toEqual(['missing_fields'])
  })
  it('accepts a root array (D2)', () => {
    expect(validateSchema(env(arr(str))).ok).toBe(true)
  })
  it('accepts a root primitive', () => {
    expect(validateSchema(env({ type: 'integer' })).ok).toBe(true)
  })
  it('validates and retains fixed: null, 0 and "" (key presence)', () => {
    const input = env(
      obj(
        ['n', { type: 'string', fixed: null }],
        ['z', { type: 'integer', fixed: 0 }],
        ['e', { type: 'string', fixed: '' }],
        ['f', { type: 'boolean', fixed: false }],
      ),
    )
    const r = validateSchema(input)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const f of r.schema.root.fields ?? []) expect('fixed' in f.node).toBe(true)
    expect((r.schema.root.fields ?? []).map((f) => f.node.fixed)).toEqual([null, 0, '', false])
  })
  it('rejects a fixed value that is not JSON', () => {
    const bad = env(obj(['x', { type: 'string', fixed: undefined } as unknown as MockNode]))
    expect(codes(validateSchema(bad))).toEqual(['invalid_type'])
  })
})

describe('totality', () => {
  it('returns issues, never throws, for non-schema input', () => {
    for (const v of [
      null,
      undefined,
      5,
      'x',
      [],
      {},
      { version: 1 },
      { version: 1, components: {}, root: 3 },
    ]) {
      const r = validateSchema(v)
      expect(r.ok).toBe(false)
    }
  })
  it('does not throw on absurdly deep input', () => {
    let n: unknown = { type: 'string' }
    for (let i = 0; i < 50000; i++) n = { type: 'array', items: n }
    expect(validateSchema({ version: 1, components: {}, root: n }).ok).toBe(false)
  })
  it('emptySchema is valid and returns fresh objects', () => {
    expect(validateSchema(emptySchema()).ok).toBe(true)
    expect(emptySchema()).not.toBe(emptySchema())
  })
})

describe('mockSchemaZod (shape-only Zod schema)', () => {
  it('accepts everything validateSchema accepts in the fixtures, preserving unknown keys', () => {
    for (const fx of [workedExample, allTypes]) {
      const p = mockSchemaZod.safeParse(fx)
      expect(p.success).toBe(true)
      if (p.success)
        expect(JSON.parse(JSON.stringify(p.data))).toEqual(JSON.parse(JSON.stringify(fx)))
    }
  })
  it('rejects an unknown node type and a wrong version', () => {
    expect(
      mockSchemaZod.safeParse(env(obj(['x', { type: 'wat' } as unknown as MockNode]))).success,
    ).toBe(false)
    expect(mockSchemaZod.safeParse({ ...workedExample, version: 2 }).success).toBe(false)
  })
})
