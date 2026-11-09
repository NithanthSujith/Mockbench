import type { MockSchema } from '@mockbench/schema-core'
import { describe, expect, it } from 'vitest'
import nodes2000 from '../../../../../../packages/schema-core/fixtures/corpus/limits-nodes-2000.schema.json'
import { fromSchema, moveNode, setKey, toSchema, type BuilderState } from './index'

const schema = nodes2000 as unknown as MockSchema

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number
const changedNodes = (a: BuilderState, b: BuilderState) =>
  Object.keys(b.nodes).filter((id) => a.nodes[id] !== b.nodes[id]).length

describe('performance budget with a 2,000-node schema', () => {
  const base = fromSchema(schema)
  const fieldIds = base.nodes[base.rootId]!.childIds

  it('the fixture really is 2,000 nodes', () => {
    expect(Object.keys(base.nodes)).toHaveLength(2000)
    expect(fieldIds).toHaveLength(1999)
  })

  it('setKey: median under 20 ms over 50 runs', () => {
    let state = base
    const times: number[] = []
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now()
      state = setKey(state, fieldIds[i * 7 + 3] as string, `renamed_${i}`)
      times.push(performance.now() - t0)
    }
    expect(median(times)).toBeLessThan(20)
  })

  it('moveNode: median under 20 ms over 50 runs', () => {
    let state = base
    const times: number[] = []
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now()
      state = moveNode(state, fieldIds[i] as string, state.rootId, 1_500 + i)
      times.push(performance.now() - t0)
    }
    expect(median(times)).toBeLessThan(20)
    expect(state).not.toBe(base)
  })

  it('snapshots share structure: a setKey creates O(depth) new node objects (here exactly one)', () => {
    const id = fieldIds[1000] as string
    const next = setKey(base, id, 'renamed')
    const depth = 2 // root -> field
    expect(changedNodes(base, next)).toBe(1)
    expect(changedNodes(base, next)).toBeLessThanOrEqual(depth)
    // Everything that did not change is the very same object, not a copy.
    expect(next.expanded).toBe(base.expanded)
    expect(next.envelope).toBe(base.envelope)
    expect(next.nodes[fieldIds[999] as string]).toBe(base.nodes[fieldIds[999] as string])
    expect(next.nodes[base.rootId]).toBe(base.nodes[base.rootId])
  })

  it('a move within one parent changes only the parent (its child list); the moved node object is reused', () => {
    const id = fieldIds[0] as string
    const next = moveNode(base, id, base.rootId, 1_000)
    expect(changedNodes(base, next)).toBeLessThanOrEqual(3)
    expect(next.nodes[id]).toBe(base.nodes[id])
  })

  it('the 2,000-node state still round-trips after edits', () => {
    const next = setKey(base, fieldIds[5] as string, 'zz')
    const out = toSchema(next)
    expect(out.root.fields).toHaveLength(1999)
    expect(out.root.fields![5]!.key).toBe('zz')
  })
})
