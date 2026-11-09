import type { MockNode, MockSchema } from '@mockbench/schema-core'
import { describe, expect, it } from 'vitest'
import { fromSchema, setExpanded, toggleExpanded, visibleRows, type BuilderState } from './index'

const leaf = (type: string, extra: Record<string, unknown> = {}): MockNode =>
  ({ type, ...extra }) as MockNode
const obj = (...fields: [string, MockNode][]): MockNode => ({
  type: 'object',
  fields: fields.map(([key, node]) => ({ key, node })),
})
const env = (root: MockNode): MockSchema => ({ version: 1, components: {}, root })
const summary = (state: BuilderState) =>
  visibleRows(state).map(
    (r) => `${'  '.repeat(r.depth)}${r.kind === 'item' ? '[item]' : r.key}:${r.type}`,
  )

const nested = () =>
  fromSchema(
    env(
      obj(
        ['id', leaf('uuid')],
        ['address', obj(['city', leaf('string')], ['geo', obj(['lat', leaf('number')])])],
        ['tags', { type: 'array', count: 2, items: leaf('string') }],
        ['orders', { type: 'array', items: obj(['total', leaf('number')]) }],
      ),
    ),
  )

describe('visibleRows', () => {
  it('lists every node in document order with its depth (the root itself is not a row)', () => {
    expect(summary(nested())).toEqual([
      'id:uuid',
      'address:object',
      '  city:string',
      '  geo:object',
      '    lat:number',
      'tags:array',
      '  [item]:string',
      'orders:array',
      '  [item]:object',
      '    total:number',
    ])
  })

  it('hides the descendants of a collapsed node', () => {
    const state = nested()
    const address = state.nodes[state.rootId]!.childIds[1]!
    const collapsed = toggleExpanded(state, address)
    expect(summary(collapsed)).toEqual([
      'id:uuid',
      'address:object',
      'tags:array',
      '  [item]:string',
      'orders:array',
      '  [item]:object',
      '    total:number',
    ])
    expect(visibleRows(collapsed).find((r) => r.id === address)).toMatchObject({
      isContainer: true,
      expanded: false,
    })
  })

  it("renders an array's single item as a row of kind `item`, one level deeper than the array", () => {
    const rows = visibleRows(nested())
    const tags = rows.find((r) => r.key === 'tags')!
    const item = rows[rows.indexOf(tags) + 1]!
    expect(item).toMatchObject({
      kind: 'item',
      key: null,
      depth: tags.depth + 1,
      parentId: tags.id,
    })
    expect(tags.kind).toBe('field')
  })

  it('collapsing a nested container only hides its own subtree', () => {
    const state = nested()
    const geo = visibleRows(state).find((r) => r.key === 'geo')!.id
    expect(summary(setExpanded(state, geo, false))).not.toContain('    lat:number')
    expect(summary(setExpanded(state, geo, false))).toContain('  city:string')
  })

  it('a root array shows its item at depth 0; a primitive root has no rows', () => {
    const arr = fromSchema(env({ type: 'array', items: obj(['id', leaf('uuid')]) }))
    expect(summary(arr)).toEqual(['[item]:object', '  id:uuid'])
    expect(visibleRows(fromSchema(env(leaf('string'))))).toEqual([])
  })

  it('marks both siblings that share a key, only within the same object', () => {
    const state = fromSchema(
      env(obj(['a', leaf('string')], ['a', leaf('number')], ['b', obj(['a', leaf('string')])])),
    )
    const rows = visibleRows(state)
    expect(rows.map((r) => `${r.key}:${r.duplicateKey}`)).toEqual([
      'a:true',
      'a:true',
      'b:false',
      'a:false',
    ])
  })
})
