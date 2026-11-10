import type { MockNode, MockSchema } from '@mockbench/schema-core'
import { describe, expect, it } from 'vitest'
import {
  addField,
  canMoveNode,
  fromSchema,
  moveNode,
  previewTypeChange,
  removeNode,
  setAttr,
  setExpanded,
  setKey,
  setType,
  toSchema,
  toggleExpanded,
  visibleRows,
  type BuilderState,
  type NodeId,
} from './index'

const leaf = (type: string, extra: Record<string, unknown> = {}): MockNode =>
  ({ type, ...extra }) as MockNode
const obj = (...fields: [string, MockNode][]): MockNode => ({
  type: 'object',
  fields: fields.map(([key, node]) => ({ key, node })),
})
const env = (root: MockNode): MockSchema => ({ version: 1, components: {}, root })

const idOf = (state: BuilderState, ...path: string[]): NodeId => {
  let cur = state.nodes[state.rootId]!
  for (const key of path) {
    const id = cur.childIds.find((c) => state.nodes[c]!.key === key)
    if (!id) throw new Error(`no field ${key} under ${cur.id}`)
    cur = state.nodes[id]!
  }
  return cur.id
}
const keysUnder = (state: BuilderState, id: NodeId) =>
  state.nodes[id]!.childIds.map((c) => state.nodes[c]!.key)

/** Every node is reachable from the root and every parent/child link agrees: no orphans, no dangling ids. */
function expectConsistent(state: BuilderState) {
  const seen = new Set<NodeId>()
  const walk = (id: NodeId, parent: NodeId | null) => {
    const n = state.nodes[id]
    expect(n, `node ${id} exists`).toBeDefined()
    expect(n!.parentId).toBe(parent)
    expect(seen.has(id), `node ${id} reached twice`).toBe(false)
    seen.add(id)
    if (n!.type === 'array') expect(n!.childIds).toHaveLength(1)
    if (n!.type !== 'array' && n!.type !== 'object') expect(n!.childIds).toHaveLength(0)
    for (const c of n!.childIds) walk(c, id)
  }
  walk(state.rootId, null)
  expect([...seen].sort()).toEqual(Object.keys(state.nodes).sort())
  for (const id of state.expanded) expect(state.nodes[id], `expanded ${id} exists`).toBeDefined()
}

const sample = () =>
  fromSchema(
    env(
      obj(
        ['id', leaf('uuid')],
        [
          'address',
          obj(
            ['city', leaf('string')],
            ['pincode', leaf('integer')],
            ['geo', obj(['lat', leaf('number')])],
          ),
        ],
        ['tags', { type: 'array', count: 2, items: leaf('string') }],
        ['role', leaf('enum', { values: ['a', 'b'] })],
      ),
    ),
  )

describe('setType', () => {
  it('object -> string on a node with 3 children: the preview reports 3 discarded and applying removes all three', () => {
    const state = fromSchema(
      env(obj(['box', obj(['a', leaf('string')], ['b', leaf('string')], ['c', leaf('string')])])),
    )
    const box = idOf(state, 'box')
    const before = Object.keys(state.nodes).length
    expect(previewTypeChange(state, box, 'string')).toEqual({
      changed: true,
      discardedNodes: 3,
      discardedAttrs: [],
      createdNodes: 0,
    })
    const next = setType(state, box, 'string')
    expect(next.nodes[box]!.type).toBe('string')
    expect(next.nodes[box]!.childIds).toEqual([])
    expect(Object.keys(next.nodes)).toHaveLength(before - 3)
    expectConsistent(next)
    expect(toSchema(next).root).toEqual(obj(['box', leaf('string')]))
  })

  it('counts every descendant, not only direct children', () => {
    const state = sample()
    expect(previewTypeChange(state, idOf(state, 'address'), 'string').discardedNodes).toBe(4)
    const next = setType(state, idOf(state, 'address'), 'string')
    expectConsistent(next)
  })

  it('to array creates exactly one item node of type string', () => {
    const state = fromSchema(env(obj(['x', leaf('string')])))
    const x = idOf(state, 'x')
    expect(previewTypeChange(state, x, 'array').createdNodes).toBe(1)
    const next = setType(state, x, 'array')
    const n = next.nodes[x]!
    expect(n.type).toBe('array')
    expect(n.childIds).toHaveLength(1)
    const item = next.nodes[n.childIds[0]!]!
    expect(item).toMatchObject({ type: 'string', key: null, parentId: x })
    expect(toSchema(next).root.fields![0]!.node).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
    expectConsistent(next)
  })

  it('to object creates one default field `field_a` (a string)', () => {
    const state = fromSchema(env(obj(['x', leaf('string')])))
    const x = idOf(state, 'x')
    const next = setType(state, x, 'object')
    expect(keysUnder(next, x)).toEqual(['field_a'])
    expect(toSchema(next).root.fields![0]!.node).toEqual(obj(['field_a', leaf('string')]))
    expectConsistent(next)
  })

  it('to enum sets values one/two/three when there are none, and keeps existing values', () => {
    const state = fromSchema(
      env(obj(['x', leaf('string')], ['y', leaf('string', { values: ['k'] })])),
    )
    const a = setType(state, idOf(state, 'x'), 'enum')
    expect(a.nodes[idOf(a, 'x')]!.attrs.values).toEqual(['one', 'two', 'three'])
    const b = setType(state, idOf(state, 'y'), 'enum')
    expect(b.nodes[idOf(b, 'y')]!.attrs.values).toEqual(['k'])
  })

  it('switching back preserves nothing it cannot represent, and says so', () => {
    const state = fromSchema(
      env(
        obj(
          ['e', leaf('enum', { values: ['a'], description: 'keep me', fixed: 'a' })],
          ['arr', { type: 'array', count: 5, items: obj(['k', leaf('string')]) }],
          ['n', leaf('integer', { min: 1, max: 4 })],
        ),
      ),
    )
    const e = idOf(state, 'e')
    expect(previewTypeChange(state, e, 'string').discardedAttrs).toEqual(['values'])
    const s = setType(state, e, 'string')
    expect(s.nodes[e]!.attrs).toEqual({ description: 'keep me', fixed: 'a' }) // universal attrs survive
    const arr = idOf(state, 'arr')
    const p = previewTypeChange(state, arr, 'string')
    expect(p.discardedAttrs).toEqual(['count'])
    expect(p.discardedNodes).toBe(2) // the item object and its `k` field
    const n = idOf(state, 'n')
    expect(previewTypeChange(state, n, 'string').discardedAttrs.sort()).toEqual(['max', 'min'])
    expect(previewTypeChange(state, n, 'number').discardedAttrs).toEqual([]) // min/max still apply
  })

  it('object -> array replaces the fields with a single string item', () => {
    const state = sample()
    const address = idOf(state, 'address')
    const next = setType(state, address, 'array')
    expect(next.nodes[address]!.childIds).toHaveLength(1)
    expectConsistent(next)
  })

  it('a no-op, an unknown node or an unknown type returns the very same state', () => {
    const state = sample()
    expect(setType(state, idOf(state, 'id'), 'uuid')).toBe(state)
    expect(setType(state, 'nope', 'string')).toBe(state)
    expect(setType(state, idOf(state, 'id'), 'banana')).toBe(state)
    expect(previewTypeChange(state, idOf(state, 'id'), 'uuid').changed).toBe(false)
  })

  it('the root can change type; becoming a container keeps it expanded', () => {
    const state = fromSchema(env(leaf('string')))
    const next = setType(state, state.rootId, 'object')
    expect(next.expanded.has(state.rootId)).toBe(true)
    expect(keysUnder(next, state.rootId)).toEqual(['field_a'])
    expectConsistent(next)
  })
})

describe('moveNode', () => {
  const abc = () =>
    fromSchema(env(obj(['a', leaf('string')], ['b', leaf('string')], ['c', leaf('string')])))

  it('within one parent it is a splice of childIds: the six-case table', () => {
    const table: [string, number, string[]][] = [
      ['a', 1, ['b', 'a', 'c']],
      ['a', 2, ['b', 'c', 'a']],
      ['c', 0, ['c', 'a', 'b']],
      ['b', 2, ['a', 'c', 'b']],
      ['b', 0, ['b', 'a', 'c']],
      ['c', 1, ['a', 'c', 'b']],
    ]
    for (const [key, index, expected] of table) {
      const state = abc()
      const next = moveNode(state, idOf(state, key), state.rootId, index)
      expect(keysUnder(next, state.rootId), `${key} -> ${index}`).toEqual(expected)
      expectConsistent(next)
    }
  })

  it('clamps an out-of-range index and treats a move to where it already is as a no-op', () => {
    const state = abc()
    const a = idOf(state, 'a')
    expect(keysUnder(moveNode(state, a, state.rootId, 99), state.rootId)).toEqual(['b', 'c', 'a'])
    expect(keysUnder(moveNode(state, idOf(state, 'c'), state.rootId, -5), state.rootId)).toEqual([
      'c',
      'a',
      'b',
    ])
    expect(moveNode(state, a, state.rootId, 0)).toBe(state)
    expect(moveNode(state, idOf(state, 'c'), state.rootId, 2)).toBe(state)
  })

  it('across parents updates both childIds lists and the moved node parentId', () => {
    const state = sample()
    const id = idOf(state, 'id')
    const address = idOf(state, 'address')
    const next = moveNode(state, id, address, 1)
    expect(keysUnder(next, address)).toEqual(['city', 'id', 'pincode', 'geo'])
    expect(keysUnder(next, state.rootId)).toEqual(['address', 'tags', 'role'])
    expect(next.nodes[id]!.parentId).toBe(address)
    expect(next.expanded.has(address)).toBe(true)
    expectConsistent(next)
    expect(toSchema(next).root.fields![0]!.node.fields![1]!.key).toBe('id')
  })

  it('into its own descendant (or itself) is rejected and leaves the state unchanged', () => {
    const state = sample()
    const address = idOf(state, 'address')
    const geo = idOf(state, 'address', 'geo')
    expect(moveNode(state, address, geo, 0)).toBe(state)
    expect(moveNode(state, address, address, 0)).toBe(state)
    expect(canMoveNode(state, address, geo)).toBe(false)
    expect(canMoveNode(state, geo, address)).toBe(true)
  })

  it('rejects the root, an array item, a missing node, and any non-object target', () => {
    const state = sample()
    const tags = idOf(state, 'tags')
    const item = state.nodes[tags]!.childIds[0]!
    const address = idOf(state, 'address')
    expect(moveNode(state, state.rootId, address, 0)).toBe(state)
    expect(moveNode(state, item, address, 0)).toBe(state)
    expect(moveNode(state, 'nope', address, 0)).toBe(state)
    expect(moveNode(state, address, tags, 0)).toBe(state) // an array holds only its item
    expect(moveNode(state, address, idOf(state, 'id'), 0)).toBe(state) // a leaf holds nothing
  })
})

describe('removeNode', () => {
  it('on an object removes the entire subtree and nothing else', () => {
    const state = sample()
    const address = idOf(state, 'address')
    const before = Object.keys(state.nodes).length
    const next = removeNode(state, address)
    expect(Object.keys(next.nodes)).toHaveLength(before - 5) // address + city, pincode, geo, lat
    expect(keysUnder(next, state.rootId)).toEqual(['id', 'tags', 'role'])
    expect(next.expanded.has(address)).toBe(false)
    expectConsistent(next)
  })

  it('the root cannot be removed', () => {
    const state = sample()
    expect(removeNode(state, state.rootId)).toBe(state)
  })

  it("an array's item cannot be removed (an array always has exactly one)", () => {
    const state = sample()
    const item = state.nodes[idOf(state, 'tags')]!.childIds[0]!
    expect(removeNode(state, item)).toBe(state)
  })

  it('a missing node is a no-op', () => {
    const state = sample()
    expect(removeNode(state, 'n999')).toBe(state)
  })
})

describe('setKey', () => {
  it('renames a field and keeps its position', () => {
    const state = sample()
    const next = setKey(state, idOf(state, 'id'), 'identifier')
    expect(keysUnder(next, state.rootId)).toEqual(['identifier', 'address', 'tags', 'role'])
  })

  it('applies a duplicate key (rows flag it; toSchema still returns the structure)', () => {
    const state = sample()
    const next = setKey(state, idOf(state, 'role'), 'id')
    expect(keysUnder(next, state.rootId)).toEqual(['id', 'address', 'tags', 'id'])
    expect(toSchema(next).root.fields!.map((f) => f.key)).toEqual(['id', 'address', 'tags', 'id'])
    const dups = visibleRows(next).filter((r) => r.duplicateKey)
    expect(dups.map((r) => r.key)).toEqual(['id', 'id'])
    expect(dups.map((r) => r.id).sort()).toEqual([idOf(state, 'id'), idOf(state, 'role')].sort())
  })

  it('does nothing for the root, an array item, the same key, or a missing node', () => {
    const state = sample()
    expect(setKey(state, state.rootId, 'x')).toBe(state)
    expect(setKey(state, state.nodes[idOf(state, 'tags')]!.childIds[0]!, 'x')).toBe(state)
    expect(setKey(state, idOf(state, 'id'), 'id')).toBe(state)
    expect(setKey(state, 'n999', 'x')).toBe(state)
  })
})

describe('setAttr', () => {
  it('stores falsy values by key presence and removes with undefined', () => {
    let state = fromSchema(env(obj(['n', leaf('integer')])))
    const n = idOf(state, 'n')
    for (const v of [0, '', false, null]) {
      state = setAttr(state, n, 'fixed', v)
      expect(Object.prototype.hasOwnProperty.call(state.nodes[n]!.attrs, 'fixed')).toBe(true)
      expect(state.nodes[n]!.attrs.fixed).toBe(v)
      expect(toSchema(state).root.fields![0]!.node).toHaveProperty('fixed', v)
    }
    state = setAttr(state, n, 'fixed', undefined)
    expect(state.nodes[n]!.attrs).not.toHaveProperty('fixed')
    expect(toSchema(state).root.fields![0]!.node).not.toHaveProperty('fixed')
  })

  it('rejects unknown keys, structural keys and `source`: extras are never editable', () => {
    const state = fromSchema(
      env(obj(['n', leaf('integer', { source: { from: 'path' }, 'x-v': 1 })])),
    )
    const n = idOf(state, 'n')
    for (const name of ['source', 'x-v', 'type', 'key', 'fields', 'items', 'banana']) {
      expect(setAttr(state, n, name, 'hack'), name).toBe(state)
    }
    expect(state.nodes[n]!.extras).toEqual({ source: { from: 'path' }, 'x-v': 1 })
  })

  it('rejects an attribute that does not apply to the node type, and no-ops an equal value', () => {
    const state = fromSchema(env(obj(['s', leaf('string')], ['n', leaf('integer', { min: 1 })])))
    expect(setAttr(state, idOf(state, 's'), 'min', 3)).toBe(state)
    expect(setAttr(state, idOf(state, 's'), 'values', ['a'])).toBe(state)
    expect(setAttr(state, idOf(state, 'n'), 'min', 1)).toBe(state)
    expect(setAttr(state, idOf(state, 'n'), 'max', undefined)).toBe(state)
    expect(setAttr(state, idOf(state, 'n'), 'min', 2).nodes[idOf(state, 'n')]!.attrs.min).toBe(2)
  })

  it('ref nodes keep `name`, and it can be changed', () => {
    const state = fromSchema(env(obj(['r', { type: 'ref', name: 'Money' }])))
    const r = idOf(state, 'r')
    expect(state.nodes[r]!.attrs).toEqual({ name: 'Money' })
    const next = setAttr(state, r, 'name', 'Price')
    expect(toSchema(next).root.fields![0]!.node).toEqual({ type: 'ref', name: 'Price' })
  })

  it('copies the value in, so later changes to the caller object never reach the state', () => {
    const state = fromSchema(env(obj(['n', leaf('string')])))
    const examples = ['a', 'b']
    const next = setAttr(state, idOf(state, 'n'), 'examples', examples)
    examples.push('c')
    expect(next.nodes[idOf(next, 'n')]!.attrs.examples).toEqual(['a', 'b'])
  })
})

describe('addField', () => {
  it('appends a string field with a unique default key and returns its id', () => {
    const state = sample()
    const a = addField(state, state.rootId)
    expect(a.id).not.toBeNull()
    expect(state.nodes[a.id!]).toBeUndefined()
    expect(a.state.nodes[a.id!]).toMatchObject({ type: 'string', key: 'new_field' })
    const b = addField(a.state, state.rootId)
    expect(b.state.nodes[b.id!]!.key).toBe('new_field_2')
    expectConsistent(b.state)
  })

  it('honours key, type and index, and expands the parent', () => {
    let state = sample()
    state = setExpanded(state, idOf(state, 'address'), false)
    const { state: next, id } = addField(state, idOf(state, 'address'), {
      key: 'zip',
      type: 'array',
      index: 0,
    })
    expect(keysUnder(next, idOf(state, 'address'))).toEqual(['zip', 'city', 'pincode', 'geo'])
    expect(next.nodes[id!]!.type).toBe('array')
    expect(next.nodes[id!]!.childIds).toHaveLength(1)
    expect(next.expanded.has(idOf(state, 'address'))).toBe(true)
    expectConsistent(next)
  })

  it('is rejected on anything that is not an object', () => {
    const state = sample()
    expect(addField(state, idOf(state, 'id'))).toEqual({ state, id: null })
    expect(addField(state, idOf(state, 'tags'))).toEqual({ state, id: null })
    expect(addField(state, 'n999')).toEqual({ state, id: null })
    expect(addField(state, state.rootId, { type: 'banana' as never }).id).toBeNull()
  })
})

describe('expanded', () => {
  it('toggleExpanded flips a container, and ignores leaves and unknown ids', () => {
    const state = sample()
    const address = idOf(state, 'address')
    const collapsed = toggleExpanded(state, address)
    expect(collapsed.expanded.has(address)).toBe(false)
    expect(toggleExpanded(collapsed, address).expanded.has(address)).toBe(true)
    expect(toggleExpanded(state, idOf(state, 'id'))).toBe(state)
    expect(toggleExpanded(state, 'n999')).toBe(state)
  })
})
