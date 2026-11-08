import { describe, expect, it } from 'vitest'
import { LIMITS, NODE_TYPES, generate, validateSchema } from '../src/index'
import type { MockNode, MockSchema } from '../src/index'
import {
  allSchemas,
  contextFor,
  goldenFiles,
  goldenPathFor,
  manifest,
  renderGolden,
  schemaFor,
} from './helpers'

// Goldens are compared byte for byte. They only change through `pnpm test:update-goldens`
// (vitest -u), and any change must come with a GENERATOR_VERSION bump (see generator-guard.test.ts).
describe('golden corpus', () => {
  for (const entry of manifest) {
    for (const combo of entry.combos) {
      it(`${entry.name} / ${combo}`, async () => {
        const golden = goldenPathFor(entry.name, combo)
        await expect(renderGolden(entry, combo)).toMatchFileSnapshot(golden)
      })
    }
  }

  it('every manifest case has every golden committed, and no golden is orphaned', () => {
    const expected = manifest.flatMap((e) => e.combos.map((c) => goldenPathFor(e.name, c))).sort()
    expect(Object.keys(goldenFiles).sort()).toEqual(expected)
  })

  it('every corpus schema is valid and generation is repeatable for every combination', () => {
    for (const entry of manifest) {
      expect(validateSchema(schemaFor(entry.name)).ok, entry.name).toBe(true)
      for (const combo of entry.combos) {
        const a = generate(schemaFor(entry.name), contextFor(entry, combo))
        const b = generate(schemaFor(entry.name), contextFor(entry, combo))
        expect(a.json, `${entry.name}/${combo}`).toBe(b.json)
        expect(() => JSON.parse(a.json)).not.toThrow()
      }
    }
  })

  it('local and path indexing differ exactly where nested arrays exist', () => {
    const differs = (name: string) =>
      renderGolden({ name, combos: [] }, 'deterministic-local') !==
      renderGolden({ name, combos: [] }, 'deterministic-path')
    expect(differs('nested-arrays')).toBe(true)
    expect(differs('flat-leaves')).toBe(true) // rows[] holds objects, so path mode prefixes them
    expect(differs('nested-objects')).toBe(false)
  })
})

/** Everything in the corpus, flattened, so coverage claims are checked by machine. */
function walk(node: MockNode, visit: (n: MockNode) => void): void {
  visit(node)
  for (const f of node.fields ?? []) walk(f.node, visit)
  if (node.items) walk(node.items, visit)
}

describe('corpus coverage', () => {
  const all: [string, MockSchema][] = allSchemas()
  const nodes: MockNode[] = []
  for (const [, s] of all) {
    walk(s.root, (n) => nodes.push(n))
    for (const c of Object.values(s.components)) walk(c, (n) => nodes.push(n))
  }

  it('has at least 12 schemas', () => {
    expect(all.length).toBeGreaterThanOrEqual(12)
  })

  it('uses every node type', () => {
    const used = new Set(nodes.map((n) => n.type))
    for (const t of NODE_TYPES) expect(used, t).toContain(t)
  })

  it('pins falsy and truthy fixed values, and uses an examples pool', () => {
    const fixed = nodes.filter((n) => 'fixed' in n).map((n) => n.fixed)
    for (const v of [0, '', false, null, 'INR']) expect(fixed).toContainEqual(v)
    expect(nodes.some((n) => (n.examples?.length ?? 0) > 0)).toBe(true)
    expect(nodes.some((n) => n.examples?.length === 0)).toBe(true)
  })

  it('covers roots that are an array and a primitive, and numeric-like keys', () => {
    const roots = all.map(([, s]) => s.root.type)
    expect(roots).toContain('array')
    expect(roots).toContain('integer')
    const keys = nodes.flatMap((n) => (n.fields ?? []).map((f) => f.key))
    expect(keys).toEqual(expect.arrayContaining(['200', '1', '10', '01']))
  })

  it('has preset hits at path, key, glob and type specificity', () => {
    const entry = manifest.find((e) => e.presets)
    expect(entry).toBeDefined()
    const golden = renderGolden(entry!, 'deterministic-local')
    expect(golden).toContain('PATH-WINS') // path
    expect(golden).toContain('Ahmedabad') // exact key
    expect(golden).toContain('glob-') // key glob
    expect(golden).toContain('-by-type-') // bare type
  })

  it('reuses a component at several positions', () => {
    const refs = nodes.filter((n) => n.type === 'ref')
    expect(refs.length).toBeGreaterThanOrEqual(4)
  })

  it('sits exactly at each limit (one just under would be too easy to miss)', () => {
    const stats = (name: string) => {
      const r = validateSchema(schemaFor(name))
      if (!r.ok) throw new Error(`${name} is invalid`)
      return r.stats
    }
    expect(stats('limits-depth-10').depth).toBe(LIMITS.maxDepth)
    expect(stats('limits-nodes-2000').nodes).toBe(LIMITS.maxNodes)
    expect(schemaFor('limits-array-1000').root.count).toBe(LIMITS.maxArrayCount)
    expect(stats('limits-leaves-50000').estimatedLeaves).toBe(LIMITS.maxLeaves)
  })
})
