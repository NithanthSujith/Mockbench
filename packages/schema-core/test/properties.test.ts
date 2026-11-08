import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { GenerationLimitError, LIMITS, generate, validateSchema } from '../src/index'
import type { GenContext, Json, MockNode, MockSchema } from '../src/index'
import { PROJECT_ID, countLeaves } from './helpers'

/** Recorded so a failure can be replayed: fc.assert(..., { seed: SEED, path: '<reported path>' }). */
const SEED = 20261108
const run = (numRuns = 120) => ({ seed: SEED, numRuns })

// ---- arbitraries -----------------------------------------------------------------------------

const keyArb = fc.stringMatching(/^[a-z][a-z0-9_]{0,7}$/)
const smallJson = fc.jsonValue({ maxDepth: 1 })
const LEAVES = [
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
] as const

/** Keys the validator does not know about. `source` is the one DESIGN reserves for the importer. */
const extrasArb = fc.dictionary(
  fc.constantFrom('source', 'x-vendor', '$comment', 'extra1', 'meta'),
  fc.jsonValue({ maxDepth: 2 }),
  { maxKeys: 3 },
)

const decorate = (node: fc.Arbitrary<MockNode>): fc.Arbitrary<MockNode> =>
  fc
    .record(
      {
        node,
        fixed: smallJson,
        examples: fc.array(smallJson, { maxLength: 3 }),
        nullable: fc.boolean(),
        description: fc.string({ maxLength: 20 }),
        extras: extrasArb,
      },
      { requiredKeys: ['node'] },
    )
    .map(({ node: n, extras, ...opt }) => ({ ...extras, ...n, ...opt }) as MockNode)

const leafArb: fc.Arbitrary<MockNode> = fc.oneof(
  fc.constantFrom(...LEAVES).map((type): MockNode => ({ type })),
  fc
    .record({
      type: fc.constantFrom('integer', 'number'),
      min: fc.integer({ min: -50, max: 50 }),
      span: fc.nat(100),
    })
    .map(({ type, min, span }): MockNode => ({ type, min, max: min + span })),
  fc
    .array(fc.oneof(fc.string({ maxLength: 6 }), fc.integer({ min: -9, max: 9 }), fc.boolean()), {
      minLength: 1,
      maxLength: 5,
    })
    .map((values): MockNode => ({ type: 'enum', values })),
)

const { node: nodeArb } = fc.letrec<{ node: MockNode; object: MockNode; array: MockNode }>(
  (tie) => ({
    node: fc.oneof(
      { maxDepth: 3, depthSize: 'small' },
      decorate(leafArb),
      decorate(tie('object')),
      decorate(tie('array')),
    ),
    object: fc
      .uniqueArray(fc.tuple(keyArb, tie('node')), {
        selector: (e) => e[0],
        minLength: 0,
        maxLength: 4,
      })
      .map((entries) => ({
        type: 'object',
        fields: entries.map(([key, node]) => ({ key, node })),
      })),
    array: fc
      .record({ items: tie('node'), count: fc.integer({ min: 0, max: 4 }) })
      .map(({ items, count }) => ({ type: 'array', items, count })),
  }),
)

const schemaArb: fc.Arbitrary<MockSchema> = nodeArb.map((root) => ({
  version: 1,
  components: {},
  root,
}))
/** Only schemas the validator accepts (almost all of them; the generator targets valid input). */
const validSchemaArb = schemaArb.filter((s) => validateSchema(s).ok)

const settingsArb = fc.record({
  mode: fc.constantFrom('deterministic', 'seeded'),
  indexing: fc.constantFrom('local', 'path'),
})
const ctx = (settings: GenContext['settings'], extra: Partial<GenContext> = {}): GenContext => ({
  projectId: PROJECT_ID,
  settings,
  ...extra,
})

/** A tiny deterministic RNG for `random` mode. */
const lcg = (seed: number): (() => number) => {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// ---- generation properties -------------------------------------------------------------------

describe('generation properties', () => {
  it('generating twice yields identical output, and the output is valid JSON', () => {
    fc.assert(
      fc.property(validSchemaArb, settingsArb, (schema, settings) => {
        const a = generate(schema, ctx(settings))
        const b = generate(schema, ctx(settings))
        expect(a.json).toBe(b.json)
        expect(() => JSON.parse(a.json)).not.toThrow()
        expect(JSON.stringify(a.provenance)).toBe(JSON.stringify(b.provenance))
      }),
      run(),
    )
  })

  it('random mode with the same injected RNG repeats, and is valid JSON', () => {
    fc.assert(
      fc.property(validSchemaArb, fc.integer(), (schema, seed) => {
        const mk = () => ctx({ mode: 'random', indexing: 'local' }, { random: lcg(seed) })
        const a = generate(schema, mk())
        const b = generate(schema, mk())
        expect(a.json).toBe(b.json)
        expect(() => JSON.parse(a.json)).not.toThrow()
      }),
      run(),
    )
  })

  it('pretty and compact output are the same document', () => {
    fc.assert(
      fc.property(validSchemaArb, settingsArb, (schema, settings) => {
        const compact = generate(schema, ctx(settings)).json
        const pretty = generate(schema, ctx(settings), { indent: 2 }).json
        expect(JSON.parse(pretty)).toEqual(JSON.parse(compact))
      }),
      run(),
    )
  })

  it('generation never mutates its input', () => {
    fc.assert(
      fc.property(validSchemaArb, settingsArb, (schema, settings) => {
        const before = JSON.stringify(schema)
        generate(schema, ctx(settings))
        expect(JSON.stringify(schema)).toBe(before)
      }),
      run(),
    )
  })

  it('the output never has more leaves than the limit', () => {
    fc.assert(
      fc.property(validSchemaArb, settingsArb, (schema, settings) => {
        const parsed = JSON.parse(generate(schema, ctx(settings)).json) as Json
        expect(countLeaves(parsed)).toBeLessThanOrEqual(LIMITS.maxLeaves)
      }),
      run(),
    )
  })

  it('nested arrays whose product is over the leaf limit throw GenerationLimitError, never return', () => {
    const over = fc
      .array(fc.integer({ min: 2, max: 1000 }), { minLength: 2, maxLength: 5 })
      .filter((counts) => counts.reduce((a, b) => a * b, 1) > LIMITS.maxLeaves)
    fc.assert(
      fc.property(over, settingsArb, (counts, settings) => {
        let node: MockNode = { type: 'string' }
        for (const count of counts) node = { type: 'array', items: node, count }
        const schema: MockSchema = { version: 1, components: {}, root: node }
        let error: unknown
        try {
          generate(schema, ctx(settings))
        } catch (e) {
          error = e
        }
        expect(error).toBeInstanceOf(GenerationLimitError)
        expect((error as GenerationLimitError).code).toBe('leaf_limit_exceeded')
      }),
      run(80),
    )
  })

  it('nested arrays whose product is within the limit generate exactly that many leaves', () => {
    const within = fc
      .array(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 3 })
      .filter((counts) => counts.reduce((a, b) => a * b, 1) <= LIMITS.maxLeaves)
    fc.assert(
      fc.property(within, (counts) => {
        let node: MockNode = { type: 'integer' }
        for (const count of counts) node = { type: 'array', items: node, count }
        const schema: MockSchema = { version: 1, components: {}, root: node }
        const parsed = JSON.parse(
          generate(schema, ctx({ mode: 'deterministic', indexing: 'local' })).json,
        )
        expect(countLeaves(parsed)).toBe(counts.reduce((a, b) => a * b, 1))
      }),
      run(80),
    )
  })
})

// ---- validator properties --------------------------------------------------------------------

const POLLUTION_KEYS = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']

/** Own enumerable state of Object.prototype must be untouched by anything the validator does. */
const protoSnapshot = (): string =>
  JSON.stringify(Object.getOwnPropertyNames(Object.prototype).sort())

describe('validator properties', () => {
  it('never throws for arbitrary JSON, and rejects with at least one issue when invalid', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const r = validateSchema(value)
        if (!r.ok) expect(r.issues.length).toBeGreaterThan(0)
      }),
      run(400),
    )
  })

  it('never throws for envelope-shaped garbage', () => {
    fc.assert(
      fc.property(
        fc.record({
          version: fc.oneof(fc.constant(1), fc.constant(2), fc.string(), fc.constant(null)),
          components: fc.jsonValue(),
          root: fc.jsonValue(),
        }),
        (value) => {
          const r = validateSchema(value)
          if (!r.ok) expect(r.issues.length).toBeGreaterThan(0)
        },
      ),
      run(400),
    )
  })

  it('prototype-pollution-shaped keys are handled without throwing or touching Object.prototype', () => {
    const before = protoSnapshot()
    fc.assert(
      fc.property(
        fc.constantFrom(...POLLUTION_KEYS),
        fc.constantFrom(...POLLUTION_KEYS),
        (fieldKey, componentName) => {
          // JSON.parse makes `__proto__` an own property, exactly as a pasted document would.
          const doc = JSON.parse(
            `{"version":1,"components":{${JSON.stringify(componentName)}:{"type":"string"}},` +
              `"root":{"type":"object","fields":[` +
              `{"key":${JSON.stringify(fieldKey)},"node":{"type":"string"}},` +
              `{"key":"viaRef","node":{"type":"ref","name":${JSON.stringify(componentName)}}}]}}`,
          ) as unknown
          const r = validateSchema(doc)
          if (fieldKey === '__proto__') {
            expect(r.ok).toBe(false)
            if (!r.ok) expect(r.issues.map((i) => i.code)).toContain('forbidden_key')
          }
          expect(protoSnapshot()).toBe(before)
          expect(({} as Record<string, unknown>).polluted).toBeUndefined()
        },
      ),
      run(60),
    )
    // the same, with the polluting payload nested in a node's unknown keys
    const nested = JSON.parse(
      '{"version":1,"components":{},"root":{"type":"string","__proto__":{"polluted":true},"source":{"__proto__":{"polluted":true}}}}',
    ) as unknown
    expect(() => validateSchema(nested)).not.toThrow()
    expect(protoSnapshot()).toBe(before)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('unknown keys survive validate, JSON round trip and validate again', () => {
    fc.assert(
      fc.property(validSchemaArb, (schema) => {
        const first = validateSchema(schema)
        expect(first.ok).toBe(true)
        if (!first.ok) return
        // validating never rewrites the document: every unknown key and the key order are intact
        expect(JSON.stringify(first.schema)).toBe(JSON.stringify(schema))
        const roundTripped = JSON.parse(JSON.stringify(first.schema)) as unknown
        const second = validateSchema(roundTripped)
        expect(second.ok).toBe(true)
        if (second.ok) expect(JSON.stringify(second.schema)).toBe(JSON.stringify(schema))
      }),
      run(),
    )
  })

  it('unknown keys are ignored by generation: removing them does not change the output', () => {
    // Only the schema structure is walked: values of fixed / examples / values are data and stay as is.
    const KNOWN = new Set([
      'type',
      'nullable',
      'description',
      'fixed',
      'examples',
      'min',
      'max',
      'values',
      'fields',
      'items',
      'count',
      'name',
    ])
    const stripNode = (n: MockNode): MockNode => {
      const o: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(n)) if (KNOWN.has(k)) o[k] = v
      if (n.fields) o.fields = n.fields.map((f) => ({ key: f.key, node: stripNode(f.node) }))
      if (n.items) o.items = stripNode(n.items)
      return o as MockNode
    }
    const strip = (s: MockSchema): MockSchema => ({
      version: 1,
      components: {},
      root: stripNode(s.root),
    })
    fc.assert(
      fc.property(validSchemaArb, settingsArb, (schema, settings) => {
        const stripped = strip(schema)
        expect(generate(schema, ctx(settings)).json).toBe(generate(stripped, ctx(settings)).json)
      }),
      run(),
    )
  })
})
