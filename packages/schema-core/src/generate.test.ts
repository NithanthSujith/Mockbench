import { describe, expect, it } from 'vitest'
import allTypes from '../fixtures/all-types.schema.json'
import allTypesGolden from '../fixtures/all-types.deterministic-local.golden.txt?raw'
import workedExample from '../fixtures/worked-example.schema.json'
import workedGolden from '../fixtures/worked-example.deterministic-local.golden.txt?raw'
import { GenerationLimitError, SchemaInvalidError, generate, generateValue } from './index'
import type { GenContext, MockNode, MockSchema, PresetResolver } from './index'
import { phoneFor } from './generate'

const P = '11111111-1111-7111-8111-111111111111'
const ctx = (over: Partial<GenContext> = {}): GenContext => ({
  projectId: P,
  settings: { indexing: 'local', mode: 'deterministic' },
  ...over,
})
const path = (mode: 'deterministic' | 'seeded' | 'random' = 'deterministic'): GenContext =>
  ctx({ settings: { indexing: 'path', mode } })

type F = [string, MockNode]
const obj = (...fields: F[]): MockNode => ({
  type: 'object',
  fields: fields.map(([key, node]) => ({ key, node })),
})
const arr = (items: MockNode, count?: number): MockNode =>
  count === undefined ? { type: 'array', items } : { type: 'array', items, count }
const leaf = (type: MockNode['type'], extra: Partial<MockNode> = {}): MockNode => ({
  type,
  ...extra,
})
const env = (root: MockNode, components: Record<string, MockNode> = {}): MockSchema => ({
  version: 1,
  components,
  root,
})
const out = (root: MockNode, c: GenContext = ctx()): unknown =>
  JSON.parse(generate(env(root), c).json)

/** A preset resolver driven by a map from field key to a hit. */
const presetsByKey =
  (hits: Record<string, ReturnType<PresetResolver>>): PresetResolver =>
  ({ key }) =>
    (key !== null && hits[key]) || null

describe('worked example (DESIGN § Generation engine)', () => {
  it('is byte-identical to the committed golden', () => {
    const r = generate(workedExample as unknown as MockSchema, ctx(), { indent: 2 })
    expect(`${r.json}\n`).toBe(workedGolden)
  })

  it('has the values DESIGN specifies', () => {
    const v = generateValue(workedExample as unknown as MockSchema, ctx()) as Record<
      string,
      unknown
    >
    expect(v).toMatchObject({
      name: 'name-1',
      email: 'email-1@example.com',
      role: 'role-1',
      is_active: true,
      branch_list: ['branch_list-1', 'branch_list-2', 'branch_list-3'],
      address: { city: 'city-1', pincode: 1 },
    })
    const orders = v.orders as { order_id: string; total: number }[]
    expect(orders.map((o) => o.total)).toEqual([1.5, 2.5])
    expect(orders[0]?.order_id).not.toBe(orders[1]?.order_id)
    expect(v.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('the all-types fixture matches its golden (every type, pins, refs, numeric-like keys)', () => {
    const r = generate(allTypes as unknown as MockSchema, ctx(), { indent: 2 })
    expect(`${r.json}\n`).toBe(allTypesGolden)
  })

  it('compact output is the same document as the pretty output', () => {
    const pretty = generate(workedExample as unknown as MockSchema, ctx(), { indent: 2 }).json
    const compact = generate(workedExample as unknown as MockSchema, ctx()).json
    expect(compact).toBe(JSON.stringify(JSON.parse(pretty)))
    expect(compact).not.toContain('\n')
    expect(pretty).toBe(JSON.stringify(JSON.parse(pretty), null, 2))
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(workedExample)
    generate(workedExample as unknown as MockSchema, ctx())
    expect(JSON.stringify(workedExample)).toBe(before)
  })
})

describe('indexing: local vs path', () => {
  const users = obj(['users', arr(obj(['tags', arr(leaf('string'), 2)]), 2)])

  it('local: users[1].tags restarts at 1', () => {
    const v = out(users) as { users: { tags: string[] }[] }
    expect(v.users[1]?.tags).toEqual(['tags-1', 'tags-2'])
    expect(v.users[0]?.tags).toEqual(['tags-1', 'tags-2'])
  })
  it('path: users[1].tags is qualified by the ancestor position', () => {
    const v = out(users, path()) as { users: { tags: string[] }[] }
    expect(v.users[1]?.tags).toEqual(['users-2-tags-1', 'users-2-tags-2'])
    expect(v.users[0]?.tags).toEqual(['users-1-tags-1', 'users-1-tags-2'])
  })
  it('path: leaves directly inside an element are qualified too', () => {
    const v = out(obj(['orders', arr(obj(['note', leaf('string')]), 2)]), path()) as {
      orders: { note: string }[]
    }
    expect(v.orders.map((o) => o.note)).toEqual(['orders-1-note-1', 'orders-2-note-2'])
  })
  it('path: an array of arrays extends the prefix at each branch level', () => {
    const m = obj(['m', arr(arr(leaf('string'), 2), 2)])
    expect(out(m, path())).toEqual({
      m: [
        ['m-1-m-1', 'm-1-m-2'],
        ['m-2-m-1', 'm-2-m-2'],
      ],
    })
    expect(out(m)).toEqual({
      m: [
        ['m-1', 'm-2'],
        ['m-1', 'm-2'],
      ],
    })
  })
  it('path: a top-level leaf array is unqualified (branch_list-1)', () => {
    expect(out(obj(['branch_list', arr(leaf('string'), 3)]), path())).toEqual({
      branch_list: ['branch_list-1', 'branch_list-2', 'branch_list-3'],
    })
  })
  it('a ref to an object counts as a branch in path mode', () => {
    const r = env(obj(['xs', arr({ type: 'ref', name: 'Box' }, 2)]), {
      Box: obj(['label', leaf('string')]),
    })
    const v = JSON.parse(generate(r, path()).json) as { xs: { label: string }[] }
    expect(v.xs.map((x) => x.label)).toEqual(['xs-1-label-1', 'xs-2-label-2'])
  })
})

describe('key order', () => {
  it('numeric-like keys keep their declared position ("200", "1", "b")', () => {
    const r = generate(
      env(obj(['200', leaf('string')], ['1', leaf('string')], ['b', leaf('string')])),
      ctx(),
    )
    expect(r.json).toBe('{"200":"200-1","1":"1-1","b":"b-1"}')
  })
  it('the same holds when pretty-printed', () => {
    const r = generate(env(obj(['10', leaf('integer')], ['2', leaf('integer')])), ctx(), {
      indent: 2,
    })
    expect(r.json).toBe('{\n  "10": 1,\n  "2": 1\n}')
  })
})

describe('roots and containers', () => {
  it('a root array uses the key "item"', () => {
    expect(out(arr(leaf('string'), 2))).toEqual(['item-1', 'item-2'])
  })
  it('a root primitive generates at ordinal 1 and is recorded under the empty pointer', () => {
    const r = generate(env(leaf('integer')), ctx())
    expect(r.json).toBe('1')
    expect(r.provenance).toEqual({ '': 'generated' })
  })
  it('empty containers serialise as {} and []', () => {
    expect(generate(env(obj()), ctx(), { indent: 2 }).json).toBe('{}')
    expect(generate(env(arr(leaf('string'), 0)), ctx(), { indent: 2 }).json).toBe('[]')
    expect(generate(env(obj(['a', arr(leaf('string'), 0)])), ctx()).json).toBe('{"a":[]}')
  })
  it('array count defaults to 3', () => {
    expect(out(arr(leaf('integer')))).toEqual([1, 2, 3])
  })
})

describe('per-type rules', () => {
  const at = (type: MockNode['type'], extra: Partial<MockNode> = {}, count = 12): unknown[] =>
    out(arr(leaf(type, extra), count)) as unknown[]

  it('phone: n=1, 12 and the wrap at 100000 (+91 90000 xxxxx)', () => {
    const v = at('phone')
    expect(v[0]).toBe('+91 90000 00001')
    expect(v[11]).toBe('+91 90000 00012')
    expect(phoneFor(100000)).toBe('+91 90000 00000')
    expect(phoneFor(99999)).toBe('+91 90000 99999')
  })
  it('date: 2026-01-01 plus n days', () => {
    const v = at('date')
    expect(v[0]).toBe('2026-01-02')
    expect(at('date', {}, 31)[30]).toBe('2026-02-01')
  })
  it('datetime: the same date at T00:00:00+05:30', () => {
    expect(at('datetime')[0]).toBe('2026-01-02T00:00:00+05:30')
  })
  it('boolean: n is odd', () => {
    expect(at('boolean', {}, 4)).toEqual([true, false, true, false])
  })
  it('number: n + 0.5', () => {
    expect(at('number', {}, 3)).toEqual([1.5, 2.5, 3.5])
  })
  it('email and url use the key and ordinal', () => {
    expect(out(obj(['contact', leaf('email')], ['site', leaf('url')]))).toEqual({
      contact: 'contact-1@example.com',
      site: 'https://example.com/site-1',
    })
  })
  it('null generates null', () => {
    expect(out(obj(['z', leaf('null')]))).toEqual({ z: null })
  })
  it('integer: starts at min, counts up with the ordinal, stops at max', () => {
    expect(at('integer', { min: 5, max: 8 }, 10)).toEqual([5, 6, 7, 8, 8, 8, 8, 8, 8, 8])
    expect(at('integer', { max: 2 }, 4)).toEqual([1, 2, 2, 2])
    expect(at('integer', { min: 3 }, 4)).toEqual([3, 4, 5, 6])
    expect(at('integer', { min: -2, max: 1 }, 5)).toEqual([-2, -1, 0, 1, 1])
  })
  it('integer stays integral for fractional bounds', () => {
    expect(at('integer', { min: 2.5, max: 4.9 }, 4)).toEqual([3, 4, 4, 4])
  })
  it('number: starts at min + 0.5, counts up, stops at max', () => {
    expect(at('number', { min: 2, max: 3 }, 4)).toEqual([2.5, 3, 3, 3])
    expect(at('number', {}, 3)).toEqual([1.5, 2.5, 3.5])
  })
  it('enum cycles by ordinal: a, b, a', () => {
    expect(at('enum', { values: ['a', 'b'] }, 3)).toEqual(['a', 'b', 'a'])
    expect(at('enum', { values: [1, true, 'x'] }, 4)).toEqual([1, true, 'x', 1])
  })
  it('uuid is stable for the same project and position, and differs by project, position and ordinal', () => {
    const a = out(obj(['id', leaf('uuid')])) as { id: string }
    expect(out(obj(['id', leaf('uuid')]))).toEqual(a)
    expect(out(obj(['id', leaf('uuid')]), ctx({ projectId: 'other' }))).not.toEqual(a)
    expect(out(obj(['other_id', leaf('uuid')]))).not.toEqual({ other_id: a.id })
    const list = out(arr(leaf('uuid'), 3)) as string[]
    expect(new Set(list).size).toBe(3)
  })
  it('a ref used twice yields different uuids (the pointer is the output position)', () => {
    const r = env(obj(['a', { type: 'ref', name: 'Ent' }], ['b', { type: 'ref', name: 'Ent' }]), {
      Ent: obj(['id', leaf('uuid')]),
    })
    const v = JSON.parse(generate(r, ctx()).json) as { a: { id: string }; b: { id: string } }
    expect(v.a.id).not.toBe(v.b.id)
  })
  it('nullable is documentary: it never makes generation emit null', () => {
    expect(out(obj(['x', leaf('string', { nullable: true })]))).toEqual({ x: 'x-1' })
  })
})

describe('fixed, presets, examples, enum, type — precedence', () => {
  it.each([
    ['empty string', ''],
    ['zero', 0],
    ['false', false],
    ['null', null],
  ])(
    'fixed %s wins over a preset hit, examples and the type rule (provenance fixed)',
    (_n, pin) => {
      const node = leaf('string', { fixed: pin, examples: ['ex'] })
      const r = generate(
        env(obj(['k', node])),
        ctx({ presets: presetsByKey({ k: { value: 'PRESET' } }) }),
      )
      expect(JSON.parse(r.json)).toEqual({ k: pin })
      expect(r.provenance).toEqual({ '/k': 'fixed' })
    },
  )

  it('fixed on an object writes the literal and records each leaf as fixed', () => {
    const r = generate(env(obj(['o', obj(['a', leaf('string')]) as MockNode])), ctx())
    expect(JSON.parse(r.json)).toEqual({ o: { a: 'a-1' } })
    const pinned: MockNode = { ...obj(['a', leaf('string')]), fixed: { x: [1, { y: 2 }], z: {} } }
    const p = generate(env(obj(['o', pinned])), ctx())
    expect(JSON.parse(p.json)).toEqual({ o: { x: [1, { y: 2 }], z: {} } })
    expect(p.provenance).toEqual({ '/o/x/0': 'fixed', '/o/x/1/y': 'fixed', '/o/z': 'fixed' })
  })

  it('preset > examples > enum > type, one fixture each, with provenance', () => {
    const base = leaf('enum', { values: ['E1', 'E2'], examples: ['X1', 'X2'] })
    const run = (n: MockNode, presets?: PresetResolver) => {
      const r = generate(env(obj(['k', n])), ctx(presets ? { presets } : {}))
      return { v: (JSON.parse(r.json) as { k: unknown }).k, p: r.provenance['/k'] }
    }
    expect(run(base, presetsByKey({ k: { value: 'P' } }))).toEqual({ v: 'P', p: 'preset' })
    expect(run(base)).toEqual({ v: 'X1', p: 'example' })
    expect(run(leaf('enum', { values: ['E1', 'E2'] }))).toEqual({ v: 'E1', p: 'enum' })
    expect(run(leaf('string'))).toEqual({ v: 'k-1', p: 'generated' })
  })

  it('preset values cycle by ordinal, patterns expand {n:0N} and {key}', () => {
    const presets = presetsByKey({
      role: { values: ['admin', 'manager', 'viewer'] },
      user_id: { pattern: 'ID-{n:05}-{key}' },
    })
    const root = arr(obj(['role', leaf('string')], ['user_id', leaf('string')]), 4)
    const v = JSON.parse(generate(env(root), ctx({ presets })).json) as Record<string, string>[]
    expect(v.map((x) => x.role)).toEqual(['admin', 'manager', 'viewer', 'admin'])
    expect(v[3]?.user_id).toBe('ID-00004-user_id')
  })

  it('the preset resolver is called for leaves only, with key, schema path and type', () => {
    const seen: string[] = []
    const presets: PresetResolver = (q) => {
      seen.push(`${q.key}|${q.schemaPath}|${q.type}`)
      return null
    }
    generate(
      env(obj(['a', obj(['b', leaf('string')])], ['c', arr(leaf('integer'), 1)])),
      ctx({ presets }),
    )
    expect(seen).toEqual(['b|$.a.b|string', 'c|$.c[*]|integer'])
  })

  it('a root array item has a null key for the resolver but generates as "item"', () => {
    const seen: (string | null)[] = []
    generate(env(arr(leaf('string'), 1)), ctx({ presets: (q) => (seen.push(q.key), null) }))
    expect(seen).toEqual([null])
  })

  it('examples cycle by ordinal; empty examples are ignored', () => {
    expect(out(arr(leaf('string', { examples: ['a', 'b'] }), 3))).toEqual(['a', 'b', 'a'])
    expect(out(arr(leaf('string', { examples: [] }), 2))).toEqual(['item-1', 'item-2'])
  })

  it('fixed on a ref node wins over expanding the component', () => {
    const r = env(obj(['a', { type: 'ref', name: 'C', fixed: 'pinned' }]), { C: leaf('string') })
    expect(JSON.parse(generate(r, ctx()).json)).toEqual({ a: 'pinned' })
  })
})

describe('refs and components', () => {
  it('expands refs from envelope components', () => {
    const r = env(obj(['home', { type: 'ref', name: 'Addr' }]), {
      Addr: obj(['city', leaf('string')]),
    })
    expect(JSON.parse(generate(r, ctx()).json)).toEqual({ home: { city: 'city-1' } })
  })
  it('ctx.components are merged over the envelope components (same rule as validateSchema)', () => {
    const r = env(obj(['home', { type: 'ref', name: 'Addr' }]), {
      Addr: obj(['city', leaf('string')]),
    })
    const c = ctx({ components: { Addr: obj(['zip', leaf('integer')]) } })
    expect(JSON.parse(generate(r, c).json)).toEqual({ home: { zip: 1 } })
  })
  it('resolves a project-level component absent from the envelope', () => {
    const c = ctx({ components: { Addr: obj(['city', leaf('string')]) } })
    expect(JSON.parse(generate(env(obj(['h', { type: 'ref', name: 'Addr' }])), c).json)).toEqual({
      h: { city: 'city-1' },
    })
  })
  it('records preset schema paths through a ref at the use site', () => {
    const seen: string[] = []
    const r = env(obj(['home', { type: 'ref', name: 'Addr' }]), {
      Addr: obj(['city', leaf('string')]),
    })
    generate(r, ctx({ presets: (q) => (seen.push(q.schemaPath), null) }))
    expect(seen).toEqual(['$.home.city'])
  })
})

describe('seeded and random modes', () => {
  const sample = obj(
    ['name', leaf('string')],
    ['ids', arr(leaf('uuid'), 4)],
    ['n', arr(leaf('integer'), 6)],
    ['when', leaf('datetime')],
    ['city', leaf('string')],
  )
  const run = (c: GenContext) => generate(env(sample), c).json

  it('seeded: the same project gives identical output on every call', () => {
    expect(run(path('seeded'))).toBe(run(path('seeded')))
    expect(run(ctx({ settings: { indexing: 'local', mode: 'seeded' } }))).toBe(
      run(ctx({ settings: { indexing: 'local', mode: 'seeded' } })),
    )
  })
  it('seeded: a different projectId gives different output', () => {
    const a = run(ctx({ settings: { indexing: 'local', mode: 'seeded' } }))
    const b = run(
      ctx({ projectId: 'another-project', settings: { indexing: 'local', mode: 'seeded' } }),
    )
    expect(a).not.toBe(b)
  })
  it('seeded: output is realistic (pools) and marked generated; names/cities come from the pools', () => {
    const r = generate(env(sample), ctx({ settings: { indexing: 'local', mode: 'seeded' } }))
    const v = JSON.parse(r.json) as { name: string; city: string; ids: string[] }
    expect(v.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    expect(v.city).toMatch(/^[A-Z][a-z]+$/)
    expect(v.ids.every((u) => /^[0-9a-f]{8}-[0-9a-f]{4}-4/.test(u))).toBe(true)
    expect(new Set(v.ids).size).toBe(4)
    expect(new Set(Object.values(r.provenance))).toEqual(new Set(['generated']))
  })
  it('random with a fixed RNG is reproducible and marked random', () => {
    const c = ctx({ settings: { indexing: 'local', mode: 'random' }, random: () => 0.5 })
    const r1 = generate(env(sample), c)
    expect(r1.json).toBe(generate(env(sample), c).json)
    expect(new Set(Object.values(r1.provenance))).toEqual(new Set(['random']))
  })
  it('random with the default RNG differs between calls', () => {
    const c = ctx({ settings: { indexing: 'local', mode: 'random' } })
    expect(run(c)).not.toBe(run(c))
  })
  it('seeded/random still honour fixed, presets, examples and enum before the pools', () => {
    const schema = env(
      obj(
        ['a', leaf('string', { fixed: 'F' })],
        ['b', leaf('enum', { values: ['E'] })],
        ['c', leaf('string')],
      ),
    )
    const c = ctx({
      settings: { indexing: 'local', mode: 'random' },
      random: () => 0.1,
      presets: presetsByKey({ c: { value: 'P' } }),
    })
    expect(JSON.parse(generate(schema, c).json)).toEqual({ a: 'F', b: 'E', c: 'P' })
  })
  it('seeded integers respect min/max', () => {
    const schema = env(arr(leaf('integer', { min: 10, max: 12 }), 30))
    const v = JSON.parse(
      generate(schema, ctx({ settings: { indexing: 'local', mode: 'seeded' } })).json,
    ) as number[]
    expect(v.every((x) => x >= 10 && x <= 12)).toBe(true)
  })
})

describe('provenance', () => {
  it('is keyed by the JSON Pointer of each leaf and distinguishes fixed / preset / generated', () => {
    const schema = env(
      obj(
        ['currency', leaf('string', { fixed: 'INR' })],
        ['role', leaf('string')],
        ['address', obj(['city', leaf('string')])],
        ['rows', arr(obj(['total', leaf('number')]), 2)],
        ['a/b~c', leaf('string')],
      ),
    )
    const r = generate(schema, ctx({ presets: presetsByKey({ city: { values: ['Pune'] } }) }))
    expect(r.provenance).toEqual({
      '/currency': 'fixed',
      '/role': 'generated',
      '/address/city': 'preset',
      '/rows/0/total': 'generated',
      '/rows/1/total': 'generated',
      '/a~1b~0c': 'generated',
    })
    // every pointer resolves to a leaf in the document
    const doc = JSON.parse(r.json) as Record<string, unknown>
    expect(doc.currency).toBe('INR')
    expect((doc.address as { city: string }).city).toBe('Pune')
  })
})

describe('limits and invalid schemas', () => {
  it('two nested count:1000 arrays throw GenerationLimitError in under 50 ms, before allocating output', () => {
    const huge = env(arr(arr(leaf('string'), 1000), 1000))
    const t0 = performance.now()
    let error: unknown
    try {
      generate(huge, ctx())
    } catch (e) {
      error = e
    }
    const elapsed = performance.now() - t0
    expect(error).toBeInstanceOf(GenerationLimitError)
    expect((error as GenerationLimitError).code).toBe('leaf_limit_exceeded')
    expect(elapsed).toBeLessThan(50)
  })
  it('a schema deeper than the limit throws GenerationLimitError(depth_exceeded)', () => {
    let n: MockNode = leaf('string')
    for (let i = 0; i < 11; i++) n = obj(['a', n])
    expect(() => generate(env(n), ctx())).toThrow(GenerationLimitError)
  })
  it('an unknown ref or a ref cycle throws SchemaInvalidError (never loops)', () => {
    expect(() => generate(env(obj(['a', { type: 'ref', name: 'Nope' }])), ctx())).toThrow(
      SchemaInvalidError,
    )
    const cyc = env(obj(['a', { type: 'ref', name: 'A' }]), {
      A: obj(['b', { type: 'ref', name: 'A' }]),
    })
    expect(() => generate(cyc, ctx())).toThrow(SchemaInvalidError)
  })
  it('a schema that passes validation never throws (output stays within the leaf cap)', () => {
    const big = env(arr(arr(leaf('string'), 223), 223)) // 49,729 leaves, just under the 50,000 limit
    const v = JSON.parse(generate(big, ctx()).json) as string[][]
    expect(v.flat().length).toBe(223 * 223)
  })
})

describe('browser-like environment', () => {
  it.todo('goldens are byte-identical under a browser-like environment (FND-05: needs happy-dom)')
})
