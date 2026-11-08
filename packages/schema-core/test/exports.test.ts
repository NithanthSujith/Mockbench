import { describe, expect, it } from 'vitest'
import * as api from '../src/index'
import indexSource from '../src/index.ts?raw'

/**
 * The public API of @mockbench/schema-core is a reviewed snapshot (test/exports.snapshot.txt): adding,
 * removing or renaming an export fails here until the snapshot is updated on purpose
 * (`pnpm test:update-goldens`), which puts the change in front of the reviewer.
 */
function exportedNames(source: string): { kind: 'value' | 'type'; name: string }[] {
  const out: { kind: 'value' | 'type'; name: string }[] = []
  const re = /export\s+(type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g
  for (const m of source.matchAll(re)) {
    const groupIsType = Boolean(m[1])
    for (const raw of (m[2] ?? '').split(',')) {
      const item = raw.trim()
      if (!item) continue
      const inlineType = item.startsWith('type ')
      const spec = inlineType ? item.slice(5).trim() : item
      const name = (spec.split(/\s+as\s+/).pop() ?? spec).trim()
      out.push({ kind: groupIsType || inlineType ? 'type' : 'value', name })
    }
  }
  return out
}

describe('public export snapshot', () => {
  const names = exportedNames(indexSource)

  it('matches the committed snapshot', async () => {
    const text =
      names
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind))
        .map((n) => `${n.kind} ${n.name}`)
        .join('\n') + '\n'
    await expect(text).toMatchFileSnapshot('./exports.snapshot.txt')
  })

  it('lists every runtime export (the parsed list agrees with what the module really exports)', () => {
    const values = names
      .filter((n) => n.kind === 'value')
      .map((n) => n.name)
      .sort()
    expect(Object.keys(api).sort()).toEqual(values)
  })

  it('has no duplicate export names', () => {
    const all = names.map((n) => n.name)
    expect(new Set(all).size).toBe(all.length)
  })
})
