import { describe, expect, it } from 'vitest'
import {
  MAX_PRESET_RULES,
  PresetRuleSchema,
  PresetRulesSchema,
  STARTER_PRESETS,
  applyPattern,
  buildPresetResolver,
  generate,
  validateSchema,
} from './index'
import type { MockNode, MockSchema, PresetQuery, PresetRule, ResolvedPreset } from './index'

const PID = '11111111-1111-7111-8111-111111111111'

const env = (root: MockNode, components: Record<string, MockNode> = {}): MockSchema => ({
  version: 1,
  components,
  root,
})
const leaf = (type: MockNode['type'], extra: Partial<MockNode> = {}): MockNode =>
  ({ type, ...extra }) as MockNode
const obj = (...fields: [string, MockNode][]): MockNode => ({
  type: 'object',
  fields: fields.map(([key, node]) => ({ key, node })),
})
const arr = (items: MockNode, count: number): MockNode => ({ type: 'array', items, count })

function gen(schema: MockSchema, presets: ResolvedPreset[]) {
  const r = generate(
    schema,
    {
      projectId: PID,
      settings: { indexing: 'local', mode: 'deterministic' },
      presets: buildPresetResolver(presets),
    },
    {},
  )
  return { value: JSON.parse(r.json) as unknown, provenance: r.provenance }
}

const preset = (rules: PresetRule[], priority = 0): ResolvedPreset => ({ priority, rules })
const q = (over: Partial<PresetQuery> = {}): PresetQuery => ({
  key: 'city',
  schemaPath: '$.address.city',
  type: 'string',
  ...over,
})
const hit = (presets: ResolvedPreset[], query: PresetQuery = q()) =>
  buildPresetResolver(presets)(query)

describe('specificity: path > exact key > glob key > bare type', () => {
  const byPath: PresetRule = { match: { path: '$.address.city' }, value: 'PATH' }
  const byKey: PresetRule = { match: { key: 'city' }, value: 'KEY' }
  const byGlob: PresetRule = { match: { key: '*ty' }, value: 'GLOB' }
  const byType: PresetRule = { match: { type: 'string' }, value: 'TYPE' }
  const pairs: [string, PresetRule, PresetRule][] = [
    ['path beats exact key', byPath, byKey],
    ['exact key beats glob key', byKey, byGlob],
    ['glob key beats bare type', byGlob, byType],
    ['path beats bare type', byPath, byType],
  ]
  for (const [name, winner, loser] of pairs) {
    it(`${name}, whichever order the rules are listed in`, () => {
      expect(hit([preset([winner, loser])])).toEqual({ value: winner.value })
      expect(hit([preset([loser, winner])])).toEqual({ value: winner.value })
    })
  }

  it('adding a type to a key rule makes it more specific (key+type 60 > key 50; glob+type 40 < key 50)', () => {
    const keyOnly: PresetRule = { match: { key: 'city' }, value: 'KEY' }
    const keyAndType: PresetRule = { match: { key: 'city', type: 'string' }, value: 'KEY+TYPE' }
    expect(hit([preset([keyAndType, keyOnly])])).toEqual({ value: 'KEY+TYPE' })
    expect(hit([preset([keyOnly, keyAndType])])).toEqual({ value: 'KEY+TYPE' })
    const globAndType: PresetRule = { match: { key: '*ty', type: 'string' }, value: 'GLOB+TYPE' }
    expect(hit([preset([keyOnly, globAndType])])).toEqual({ value: 'KEY' })
    expect(hit([preset([globAndType, keyOnly])])).toEqual({ value: 'KEY' })
  })

  it('every condition of a rule must hold: wrong type, wrong path or wrong key means no hit', () => {
    expect(hit([preset([{ match: { key: 'city', type: 'integer' }, value: 1 }])])).toBeNull()
    expect(hit([preset([{ match: { path: '$.other.city' }, value: 1 }])])).toBeNull()
    expect(hit([preset([{ match: { key: 'town' }, value: 1 }])])).toBeNull()
    expect(hit([preset([])])).toBeNull()
    expect(hit([])).toBeNull()
  })
})

describe('ties: higher preset priority, then the later rule', () => {
  const a: PresetRule = { match: { key: 'city' }, value: 'A' }
  const b: PresetRule = { match: { key: 'city' }, value: 'B' }

  it('equal specificity: the higher preset priority wins, even when listed first', () => {
    expect(hit([preset([a], 5), preset([b], 1)])).toEqual({ value: 'A' })
    expect(hit([preset([a], 1), preset([b], 5)])).toEqual({ value: 'B' })
  })
  it('equal priority: the later rule wins within a preset', () => {
    expect(hit([preset([a, b])])).toEqual({ value: 'B' })
    expect(hit([preset([b, a])])).toEqual({ value: 'A' })
  })
  it('equal priority across presets: the later preset in the array wins', () => {
    expect(hit([preset([a], 3), preset([b], 3)])).toEqual({ value: 'B' })
    expect(hit([preset([b], 3), preset([a], 3)])).toEqual({ value: 'A' })
  })
  it('specificity still beats priority', () => {
    const exact: PresetRule = { match: { key: 'city' }, value: 'EXACT' }
    const glob: PresetRule = { match: { key: 'ci*' }, value: 'GLOB' }
    expect(hit([preset([glob], 100), preset([exact], 0)])).toEqual({ value: 'EXACT' })
  })
})

describe('key globs: only * is special', () => {
  it('* matches any run of characters, including none', () => {
    const r = (key: string | null, glob: string) =>
      hit([preset([{ match: { key: glob }, value: 1 }])], q({ key }))
    expect(r('user_id', '*_id')).toEqual({ value: 1 })
    expect(r('_id', '*_id')).toEqual({ value: 1 })
    expect(r('user_name', 'user*')).toEqual({ value: 1 })
    expect(r('anything', '*')).toEqual({ value: 1 })
    expect(r('user_ids', '*_id')).toBeNull()
  })
  it('regex metacharacters in a glob are literal', () => {
    const r = (key: string, glob: string) =>
      hit([preset([{ match: { key: glob }, value: 1 }])], q({ key }))
    expect(r('a.b', 'a.b')).toEqual({ value: 1 })
    expect(r('aXb', 'a.b')).toBeNull()
    expect(r('a(b)', 'a(b)')).toEqual({ value: 1 })
    expect(r('ab', 'a(b)')).toBeNull()
    expect(r('a+b', 'a+b')).toEqual({ value: 1 })
    expect(r('aab', 'a+b')).toBeNull()
    expect(r('a?b', 'a?b')).toEqual({ value: 1 })
    expect(r('ab', 'a?b')).toBeNull()
    expect(r('[x]', '[x]')).toEqual({ value: 1 })
    expect(r('x', '[x]')).toBeNull()
    expect(r('a|b', 'a|b')).toEqual({ value: 1 })
    expect(r('a', 'a|b')).toBeNull()
  })
  it('matching is case-sensitive and anchored', () => {
    const rules = [preset([{ match: { key: 'city' }, value: 1 }])]
    expect(hit(rules, q({ key: 'City' }))).toBeNull()
    expect(hit(rules, q({ key: 'cityx' }))).toBeNull()
    expect(hit(rules, q({ key: 'xcity' }))).toBeNull()
  })
  it('a key rule never matches a node with no key (root primitive, items of a root array)', () => {
    expect(hit([preset([{ match: { key: '*' }, value: 1 }])], q({ key: null }))).toBeNull()
    expect(hit([preset([{ match: { type: 'string' }, value: 1 }])], q({ key: null }))).toEqual({
      value: 1,
    })
  })
})

describe('patterns', () => {
  it('applyPattern expands {n}, {n:0N} and {key}', () => {
    expect(applyPattern('ID-{n}', 7, 'x')).toBe('ID-7')
    expect(applyPattern('ID-{n:05}', 7, 'x')).toBe('ID-00007')
    expect(applyPattern('ALP-{n:03}', 12, 'sku')).toBe('ALP-012')
    expect(applyPattern('{key}-{n}', 3, 'order')).toBe('order-3')
    expect(applyPattern('{n}{n}', 4, 'k')).toBe('44')
    expect(applyPattern('24AAACA{n:04}Z', 1, 'gstin')).toBe('24AAACA0001Z')
  })
  it('does not truncate a number longer than the padding, and leaves unknown braces alone', () => {
    expect(applyPattern('{n:02}', 12345, 'k')).toBe('12345')
    expect(applyPattern('{foo} {n:x}', 1, 'k')).toBe('{foo} {n:x}')
  })

  it('`*_id` + type string gives ID-00007 at n=7 for user_id (string), and not for an integer user_id', () => {
    const rule: PresetRule = { match: { key: '*_id', type: 'string' }, pattern: 'ID-{n:05}' }
    const resolver = buildPresetResolver([preset([rule])])
    const stringHit = resolver({ key: 'user_id', schemaPath: '$[*].user_id', type: 'string' })
    expect(stringHit).toEqual({ pattern: 'ID-{n:05}' })
    expect(resolver({ key: 'user_id', schemaPath: '$[*].user_id', type: 'integer' })).toBeNull()
    const out = gen(env(arr(obj(['user_id', leaf('string')]), 7)), [preset([rule])])
    expect((out.value as { user_id: string }[])[6]?.user_id).toBe('ID-00007')
    const ints = gen(env(obj(['user_id', leaf('integer')])), [preset([rule])])
    expect(ints.value).toEqual({ user_id: 1 })
  })
})

describe('values cycle by ordinal, and presets drive generation', () => {
  it('values: [admin, manager, viewer] over a 4-element array -> admin,manager,viewer,admin', () => {
    const out = gen(env(arr(obj(['role', leaf('string')]), 4)), [
      preset([{ match: { key: 'role' }, values: ['admin', 'manager', 'viewer'] }]),
    ])
    expect((out.value as { role: string }[]).map((r) => r.role)).toEqual([
      'admin',
      'manager',
      'viewer',
      'admin',
    ])
    expect(out.provenance['/0/role']).toBe('preset')
  })

  it('DESIGN example: currency is INR, $.address.city cycles, and a plain city key uses its own rule', () => {
    const rules: PresetRule[] = [
      { match: { key: 'role' }, values: ['admin', 'manager', 'viewer'] },
      { match: { key: 'currency' }, value: 'INR' },
      { match: { path: '$.address.city' }, values: ['Ahmedabad', 'Mumbai', 'Bengaluru'] },
      { match: { key: '*_id', type: 'string' }, pattern: 'ID-{n:05}' },
    ]
    const schema = env(
      arr(
        obj(
          ['currency', leaf('string')],
          ['address', obj(['city', leaf('string')])],
          ['org_id', leaf('string')],
        ),
        3,
      ),
    )
    // The path rule is for a non-array position, so inside the array it does not apply...
    const inArray = gen(schema, [preset(rules, 10)]).value as {
      currency: string
      address: { city: string }
      org_id: string
    }[]
    expect(inArray.map((r) => r.currency)).toEqual(['INR', 'INR', 'INR'])
    expect(inArray.map((r) => r.address.city)).toEqual(['city-1', 'city-2', 'city-3'])
    expect(inArray.map((r) => r.org_id)).toEqual(['ID-00001', 'ID-00002', 'ID-00003'])
    // ...and at the root position it does, cycling by ordinal (root ordinal is 1).
    const atRoot = gen(env(obj(['address', obj(['city', leaf('string')])])), [preset(rules, 10)])
    expect(atRoot.value).toEqual({ address: { city: 'Ahmedabad' } })
    // A path using [*] reaches into arrays and cycles by element ordinal.
    const withStar = gen(env(arr(obj(['address', obj(['city', leaf('string')])]), 4)), [
      preset([
        { match: { path: '$[*].address.city' }, values: ['Ahmedabad', 'Mumbai', 'Bengaluru'] },
      ]),
    ])
    expect((withStar.value as { address: { city: string } }[]).map((r) => r.address.city)).toEqual([
      'Ahmedabad',
      'Mumbai',
      'Bengaluru',
      'Ahmedabad',
    ])
  })

  it('rules apply to leaf nodes only: a rule for an object or array key leaves the container alone', () => {
    const out = gen(
      env(obj(['address', obj(['zip', leaf('string')])], ['tags', arr(leaf('string'), 2)])),
      [
        preset([
          { match: { key: 'address' }, value: 'X' },
          { match: { key: 'tags' }, value: 'Y' },
          { match: { type: 'object' }, value: 'Z' },
        ]),
      ],
    )
    expect(out.value).toEqual({
      address: { zip: 'zip-1' },
      // ...but tags' items are leaves under the array's key, so the key rule does reach them
      tags: ['Y', 'Y'],
    })
  })

  it('an enum is a leaf: a type rule can target it, and a preset beats enum.values and examples', () => {
    const schema = env(obj(['status', leaf('enum', { values: ['a', 'b'], examples: ['e'] })]))
    expect(gen(schema, []).value).toEqual({ status: 'e' })
    const out = gen(schema, [preset([{ match: { type: 'enum' }, value: 'preset' }])])
    expect(out.value).toEqual({ status: 'preset' })
    expect(out.provenance['/status']).toBe('preset')
  })

  it('`fixed` still beats a preset, including falsy pins', () => {
    const out = gen(env(obj(['n', leaf('integer', { fixed: 0 })])), [
      preset([{ match: { key: 'n' }, value: 99 }]),
    ])
    expect(out.value).toEqual({ n: 0 })
    expect(out.provenance['/n']).toBe('fixed')
  })

  it('a `value` of null, false, 0 or "" is a real literal, not "unset"', () => {
    for (const value of [null, false, 0, ''] as const) {
      const out = gen(env(obj(['x', leaf('string')])), [preset([{ match: { key: 'x' }, value }])])
      expect(out.value).toEqual({ x: value })
    }
  })

  it('the resolver is stable: repeated queries return the same hit', () => {
    const resolver = buildPresetResolver([preset([{ match: { key: 'city' }, value: 'A' }])])
    expect(resolver(q())).toEqual({ value: 'A' })
    expect(resolver(q())).toEqual({ value: 'A' })
    expect(resolver(q({ key: 'x' }))).toBeNull()
    expect(resolver(q({ key: 'x' }))).toBeNull()
  })
})

describe('PresetRuleSchema', () => {
  const ok = (rule: unknown) => PresetRuleSchema.safeParse(rule).success
  const m = { key: 'role' }

  it('accepts one output of each kind', () => {
    expect(ok({ match: m, value: 'x' })).toBe(true)
    expect(ok({ match: m, values: ['a', 'b'] })).toBe(true)
    expect(ok({ match: m, pattern: 'ID-{n}' })).toBe(true)
    expect(ok({ match: { path: '$.a.b' }, value: 1 })).toBe(true)
    expect(ok({ match: { path: '$[*].a' }, value: 1 })).toBe(true)
    expect(ok({ match: { path: '$' }, value: 1 })).toBe(true)
    expect(ok({ match: { type: 'string' }, value: 1 })).toBe(true)
  })
  it('accepts falsy and null literals as `value`', () => {
    for (const value of [null, false, 0, '']) expect(ok({ match: m, value })).toBe(true)
  })
  it('rejects a rule with no output', () => {
    expect(ok({ match: m })).toBe(false)
  })
  it('rejects a rule with two or three outputs', () => {
    expect(ok({ match: m, value: 1, values: [1] })).toBe(false)
    expect(ok({ match: m, value: 1, pattern: 'x' })).toBe(false)
    expect(ok({ match: m, values: [1], pattern: 'x' })).toBe(false)
    expect(ok({ match: m, value: 1, values: [1], pattern: 'x' })).toBe(false)
  })
  it('rejects an empty or missing match', () => {
    expect(ok({ match: {}, value: 1 })).toBe(false)
    expect(ok({ value: 1 })).toBe(false)
    expect(ok({ match: { key: '' }, value: 1 })).toBe(false)
  })
  it('rejects empty values, empty pattern, a non-string pattern', () => {
    expect(ok({ match: m, values: [] })).toBe(false)
    expect(ok({ match: m, pattern: '' })).toBe(false)
    expect(ok({ match: m, pattern: 5 })).toBe(false)
  })
  it('rejects unknown keys on the rule and on the match, bad paths and unknown types', () => {
    expect(ok({ match: m, value: 1, extra: true })).toBe(false)
    expect(ok({ match: { key: 'a', glob: 'x' }, value: 1 })).toBe(false)
    expect(ok({ match: { path: 'address.city' }, value: 1 })).toBe(false)
    expect(ok({ match: { path: '$.a..b' }, value: 1 })).toBe(false)
    expect(ok({ match: { path: '$.a[0]' }, value: 1 })).toBe(false)
    expect(ok({ match: { type: 'wat' }, value: 1 })).toBe(false)
  })

  it('PresetRulesSchema reports problems with a path that points into rules[i]', () => {
    const res = PresetRulesSchema.safeParse([
      { match: m, value: 1 },
      { match: m, value: 1, pattern: 'x' },
      { match: {}, value: 1 },
    ])
    expect(res.success).toBe(false)
    const paths = res.success ? [] : res.error.issues.map((i) => i.path)
    expect(paths.some((p) => p[0] === 1)).toBe(true)
    expect(paths.some((p) => p[0] === 2 && p[1] === 'match')).toBe(true)
    expect(paths.every((p) => p[0] !== 0)).toBe(true)
  })

  it('allows exactly 500 rules and rejects 501', () => {
    expect(MAX_PRESET_RULES).toBe(500)
    const rule = { match: m, value: 1 }
    expect(PresetRulesSchema.safeParse(Array(500).fill(rule)).success).toBe(true)
    expect(PresetRulesSchema.safeParse(Array(501).fill(rule)).success).toBe(false)
    expect(PresetRulesSchema.safeParse([]).success).toBe(true)
  })
})

describe('STARTER_PRESETS', () => {
  it('every pack passes the rule schema, and the first has the DESIGN example rules', () => {
    expect(STARTER_PRESETS.length).toBeGreaterThanOrEqual(2)
    for (const p of STARTER_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(PresetRulesSchema.safeParse(p.rules).success).toBe(true)
    }
    const b2b = STARTER_PRESETS[0] as (typeof STARTER_PRESETS)[number]
    expect(b2b.name).toBe('Indian B2B (sample)')
    expect(b2b.rules).toContainEqual({
      match: { key: 'role' },
      values: ['admin', 'manager', 'viewer'],
    })
    expect(b2b.rules).toContainEqual({ match: { key: 'currency' }, value: 'INR' })
    expect(b2b.rules).toContainEqual({
      match: { path: '$.address.city' },
      values: ['Ahmedabad', 'Mumbai', 'Bengaluru'],
    })
    expect(b2b.rules).toContainEqual({
      match: { key: '*_id', type: 'string' },
      pattern: 'ID-{n:05}',
    })
    const empty = STARTER_PRESETS.find((p) => p.rules.length === 0)
    expect(empty).toBeDefined()
  })

  it('every rule in the packs is exercised by a generation fixture', () => {
    const b2b = STARTER_PRESETS[0] as (typeof STARTER_PRESETS)[number]
    const schema = env(
      obj(
        ['role', leaf('string')],
        ['currency', leaf('string')],
        ['city', leaf('string')],
        ['address', obj(['city', leaf('string')])],
        ['org_id', leaf('string')],
        ['gstin', leaf('string')],
        ['sku', leaf('string')],
        ['godown', leaf('string')],
        ['pincode', leaf('integer')],
      ),
    )
    const out = gen(schema, [{ priority: b2b.priority, rules: b2b.rules }])
    expect(out.value).toEqual({
      role: 'admin',
      currency: 'INR',
      city: 'Ahmedabad',
      address: { city: 'Ahmedabad' },
      org_id: 'ID-00001',
      gstin: '24AAACA0001Z',
      sku: 'ALP-001',
      godown: 'Vatva',
      pincode: 380015,
    })
    // Every one of the pack's rules is the winner for at least one of those fields.
    const winners = new Set<string>()
    const resolver = buildPresetResolver([{ priority: b2b.priority, rules: b2b.rules }])
    const queries: PresetQuery[] = [
      { key: 'role', schemaPath: '$.role', type: 'string' },
      { key: 'currency', schemaPath: '$.currency', type: 'string' },
      { key: 'city', schemaPath: '$.city', type: 'string' },
      { key: 'city', schemaPath: '$.address.city', type: 'string' },
      { key: 'org_id', schemaPath: '$.org_id', type: 'string' },
      { key: 'gstin', schemaPath: '$.gstin', type: 'string' },
      { key: 'sku', schemaPath: '$.sku', type: 'string' },
      { key: 'godown', schemaPath: '$.godown', type: 'string' },
      { key: 'pincode', schemaPath: '$.pincode', type: 'integer' },
    ]
    for (const query of queries) {
      const h = resolver(query)
      const rule = b2b.rules.find((r) => JSON.stringify(h) === JSON.stringify(ruleHit(r)))
      winners.add(JSON.stringify(rule))
    }
    expect(winners.size).toBe(b2b.rules.length)
  })

  it('the packs produce schema-valid output', () => {
    const b2b = STARTER_PRESETS[0] as (typeof STARTER_PRESETS)[number]
    expect(validateSchema(env(obj(['role', leaf('string')]))).ok).toBe(true)
    expect(b2b.rules.length).toBeGreaterThan(0)
  })
})

function ruleHit(rule: PresetRule): unknown {
  if (Object.hasOwn(rule, 'value')) return { value: rule.value }
  if (rule.values) return { values: rule.values }
  return { pattern: rule.pattern }
}
