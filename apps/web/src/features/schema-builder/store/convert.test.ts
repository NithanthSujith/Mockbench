import type { MockSchema } from '@mockbench/schema-core'
import { describe, expect, it } from 'vitest'
import { fromSchema, toSchema } from './index'

// Read-only import of schema-core's shared corpus. `import.meta.glob` picks up EVERY schema fixture,
// so a fixture added later is covered automatically.
const fixtures = import.meta.glob<MockSchema>(
  '../../../../../../packages/schema-core/fixtures/**/*.schema.json',
  { eager: true, import: 'default' },
)
const entries = Object.entries(fixtures).map(
  ([path, schema]) => [path.split('/').pop()!.replace('.schema.json', ''), schema] as const,
)

describe('round trip over the schema-core corpus', () => {
  it('covers the whole corpus (worked example, all-types and the 16 corpus schemas)', () => {
    const names = entries.map(([n]) => n)
    expect(entries.length).toBeGreaterThanOrEqual(18)
    for (const must of [
      'worked-example',
      'all-types',
      'root-array',
      'root-primitive',
      'numeric-like-keys',
      'fixed-pins',
      'ref-reuse',
      'limits-nodes-2000',
      'limits-depth-10',
      'nested-arrays',
      'enum-cycling',
    ]) {
      expect(names, must).toContain(must)
    }
  })

  for (const [name, schema] of entries) {
    it(`toSchema(fromSchema(${name})) is deeply equal AND serialises identically`, () => {
      const copy = JSON.parse(JSON.stringify(schema)) as MockSchema
      const out = toSchema(fromSchema(schema))
      expect(out).toEqual(schema)
      // Byte-for-byte: key order of nodes, entries and the envelope is preserved too.
      expect(JSON.stringify(out)).toBe(JSON.stringify(schema))
      // The caller's object is neither mutated nor frozen by building a store from it.
      expect(schema).toEqual(copy)
      expect(Object.isFrozen(schema)).toBe(false)
    })
  }
})

describe('losslessness beyond the corpus', () => {
  const rich = JSON.parse(`{
    "$comment": "envelope extra",
    "version": 1,
    "components": { "Money": { "type": "number", "min": 0, "x-vendor": [1, 2] } },
    "root": {
      "x-first": "before type",
      "type": "object",
      "source": { "from": "path", "name": "id" },
      "fields": [
        { "key": "200", "node": { "type": "string", "fixed": 0 }, "x-entry": { "k": 1 } },
        { "node": { "type": "boolean", "fixed": false, "nullable": true }, "key": "flag" },
        { "key": "empty", "node": { "type": "string", "fixed": "" } },
        { "key": "nil", "node": { "fixed": null, "type": "string", "description": "pinned null" } },
        { "key": "list", "node": { "type": "array", "count": 0, "items": { "type": "ref", "name": "Money" }, "x-vendor": true } },
        { "key": "kind", "node": { "type": "enum", "values": ["a", 1, true], "examples": ["a"] } },
        { "key": "1", "node": { "type": "integer", "min": 1, "max": 9, "source": null } }
      ]
    }
  }`) as MockSchema

  it('keeps unknown keys on the node, on the field entry and on the envelope, in their original order', () => {
    const out = toSchema(fromSchema(rich))
    expect(out).toEqual(rich)
    expect(JSON.stringify(out)).toBe(JSON.stringify(rich))
  })

  it('keeps falsy pins by key presence: 0, "", false and null', () => {
    const state = fromSchema(rich)
    const attrsOf = (key: string) => {
      const id = state.nodes[state.rootId]!.childIds.find((c) => state.nodes[c]!.key === key)!
      return state.nodes[id]!.attrs
    }
    expect(attrsOf('200')).toHaveProperty('fixed', 0)
    expect(attrsOf('empty')).toHaveProperty('fixed', '')
    expect(attrsOf('flag')).toHaveProperty('fixed', false)
    expect(attrsOf('nil')).toHaveProperty('fixed', null)
  })

  it('files unknown keys under `extras` (source included) and known ones under `attrs`', () => {
    const state = fromSchema(rich)
    const root = state.nodes[state.rootId]!
    expect(Object.keys(root.extras).sort()).toEqual(['source', 'x-first'])
    expect(root.attrs).toEqual({})
    const ref = state.nodes[state.nodes[root.childIds[4]!]!.childIds[0]!]!
    expect(ref.type).toBe('ref')
    expect(ref.attrs).toEqual({ name: 'Money' })
  })

  it('preserves field order including integer-like keys ("200", "1")', () => {
    const keys = toSchema(fromSchema(rich)).root.fields!.map((f) => f.key)
    expect(keys).toEqual(['200', 'flag', 'empty', 'nil', 'list', 'kind', '1'])
  })

  it('treats a property literally named __proto__ as data and never pollutes Object.prototype', () => {
    const evil = JSON.parse(
      '{"version":1,"components":{},"root":{"type":"string","__proto__":{"polluted":true}}}',
    ) as MockSchema
    const out = toSchema(fromSchema(evil))
    expect(Object.prototype.hasOwnProperty.call(out.root, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(JSON.stringify(out)).toBe(JSON.stringify(evil))
  })

  it('hands back fresh mutable objects that share nothing with the state', () => {
    const state = fromSchema(rich)
    const out = toSchema(state)
    expect(Object.isFrozen(out)).toBe(false)
    expect(Object.isFrozen(out.root)).toBe(false)
    ;(out.root.fields![0]!.node as { fixed?: unknown }).fixed = 'changed'
    expect(toSchema(state)).toEqual(rich)
  })

  it('repairs an array with no items by giving it one string item (the only normalisation)', () => {
    const broken = {
      version: 1,
      components: {},
      root: { type: 'array', count: 2 },
    } as unknown as MockSchema
    const state = fromSchema(broken)
    const root = state.nodes[state.rootId]!
    expect(root.childIds).toHaveLength(1)
    expect(toSchema(state).root).toEqual({ type: 'array', count: 2, items: { type: 'string' } })
  })

  it('accepts any root type, including a primitive and an array', () => {
    const prim = { version: 1, components: {}, root: { type: 'integer', min: 3 } } as MockSchema
    expect(toSchema(fromSchema(prim))).toEqual(prim)
    const arr = {
      version: 1,
      components: {},
      root: { type: 'array', items: { type: 'object', fields: [] } },
    } as MockSchema
    expect(toSchema(fromSchema(arr))).toEqual(arr)
  })
})
