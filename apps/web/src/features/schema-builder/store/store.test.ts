import type { MockNode, MockSchema } from '@mockbench/schema-core'
import { describe, expect, it } from 'vitest'
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  createBuilderStore,
  fromSchema,
  type BuilderStore,
  type NodeId,
} from './index'

const leaf = (type: string, extra: Record<string, unknown> = {}): MockNode =>
  ({ type, ...extra }) as MockNode
const obj = (...fields: [string, MockNode][]): MockNode => ({
  type: 'object',
  fields: fields.map(([key, node]) => ({ key, node })),
})
const env = (root: MockNode): MockSchema => ({ version: 1, components: {}, root })

const schema = () =>
  env(
    obj(
      ['id', leaf('uuid')],
      ['address', obj(['city', leaf('string')], ['pincode', leaf('integer')])],
      ['tags', { type: 'array', count: 2, items: leaf('string') }],
      ['role', leaf('enum', { values: ['a', 'b'] })],
    ),
  )

/** A controllable clock; every `tick(ms)` moves time forward. */
function clock(start = 1_000) {
  let t = start
  return { now: () => t, tick: (ms: number) => (t += ms) }
}
const idOf = (s: BuilderStore, ...path: string[]): NodeId => {
  const st = s.getState().state
  let cur = st.nodes[st.rootId]!
  for (const key of path) cur = st.nodes[cur.childIds.find((c) => st.nodes[c]!.key === key)!]!
  return cur.id
}
const keys = (s: BuilderStore, id: NodeId) =>
  s.getState().state.nodes[id]!.childIds.map((c) => s.getState().state.nodes[c]!.key)

describe('undo / redo', () => {
  it('after 5 mixed operations, 5 undos restore a state deeply equal to the initial', () => {
    const c = clock()
    const store = createBuilderStore(schema(), { clock: c.now })
    const initial = store.getState().state
    const s = store.getState()

    s.setKey(idOf(store, 'id'), 'identifier')
    c.tick(1_000)
    s.setType(idOf(store, 'address'), 'string') // discards two fields
    c.tick(1_000)
    const added = s.addField(store.getState().state.rootId)
    expect(added).not.toBeNull()
    s.moveNode(idOf(store, 'role'), store.getState().state.rootId, 0)
    s.setAttr(idOf(store, 'role'), 'description', 'who')
    const afterFive = store.getState().state
    expect(store.getState().past).toHaveLength(5)

    for (let i = 0; i < 5; i++) expect(store.getState().undo()).toBe(true)
    expect(store.getState().undo()).toBe(false)
    expect(store.getState().state).toEqual(initial)
    expect(store.getState().state).toBe(initial) // same object: nothing was rebuilt
    expect(store.getState().toSchema()).toEqual(schema())
    expect(store.getState().canUndo).toBe(false)
    expect(store.getState().canRedo).toBe(true)

    for (let i = 0; i < 5; i++) expect(store.getState().redo()).toBe(true)
    expect(store.getState().redo()).toBe(false)
    expect(store.getState().state).toEqual(afterFive)
    expect(store.getState().canRedo).toBe(false)
  })

  it('a new operation after an undo clears the redo stack', () => {
    const c = clock()
    const store = createBuilderStore(schema(), { clock: c.now })
    store.getState().setAttr(idOf(store, 'id'), 'description', 'one')
    store.getState().setAttr(idOf(store, 'id'), 'description', 'two')
    store.getState().undo()
    expect(store.getState().future).toHaveLength(1)
    expect(store.getState().canRedo).toBe(true)
    store.getState().setAttr(idOf(store, 'id'), 'description', 'three')
    expect(store.getState().future).toHaveLength(0)
    expect(store.getState().canRedo).toBe(false)
    expect(store.getState().redo()).toBe(false)
  })

  it('the history never exceeds 100 entries and drops the oldest first', () => {
    expect(HISTORY_LIMIT).toBe(100)
    const store = createBuilderStore(schema())
    const id = idOf(store, 'id')
    for (let i = 1; i <= 150; i++) store.getState().setAttr(id, 'description', `v${i}`)
    expect(store.getState().past).toHaveLength(100)
    let undone = 0
    while (store.getState().undo()) undone++
    expect(undone).toBe(100)
    // 150 edits, 100 steps back: the oldest 50 were dropped, so we land on the state after edit 50.
    expect(store.getState().state.nodes[id]!.attrs.description).toBe('v50')
  })

  it('a rejected or no-op edit adds no history entry', () => {
    const store = createBuilderStore(schema())
    const s = store.getState()
    expect(s.removeNode(store.getState().state.rootId)).toBe(false)
    expect(s.setKey(idOf(store, 'id'), 'id')).toBe(false)
    expect(s.setType(idOf(store, 'id'), 'uuid')).toBeNull()
    expect(s.moveNode(idOf(store, 'address'), idOf(store, 'address', 'city'), 0)).toBe(false)
    expect(s.setAttr(idOf(store, 'id'), 'source', 1)).toBe(false)
    expect(s.addField(idOf(store, 'id'))).toBeNull()
    expect(store.getState().past).toHaveLength(0)
    expect(store.getState().canUndo).toBe(false)
  })

  it('replaceAll is an undoable step', () => {
    const store = createBuilderStore(schema())
    const next = env(obj(['only', leaf('string')]))
    store.getState().replaceAll(next)
    expect(store.getState().toSchema()).toEqual(next)
    store.getState().undo()
    expect(store.getState().toSchema()).toEqual(schema())
  })

  it('setType reports what it discarded, addField returns the new id', () => {
    const store = createBuilderStore(schema())
    const report = store.getState().setType(idOf(store, 'address'), 'string')
    expect(report).toMatchObject({ changed: true, discardedNodes: 2 })
    const id = store.getState().addField(store.getState().state.rootId, { key: 'z' })
    expect(store.getState().state.nodes[id!]!.key).toBe('z')
  })
})

describe('coalescing a burst of key edits', () => {
  it('edits to one node within 500 ms are one undo step', () => {
    expect(COALESCE_MS).toBe(500)
    const c = clock()
    const store = createBuilderStore(schema(), { clock: c.now })
    const id = idOf(store, 'id')
    for (const k of ['i', 'id_', 'id_x', 'id_xy']) {
      store.getState().setKey(id, k)
      c.tick(200) // each keystroke is within 500 ms of the previous one
    }
    expect(store.getState().past).toHaveLength(1)
    expect(store.getState().state.nodes[id]!.key).toBe('id_xy')
    store.getState().undo()
    expect(store.getState().state.nodes[id]!.key).toBe('id') // one undo goes back to before the burst
    expect(store.getState().canUndo).toBe(false)
  })

  it('a pause longer than 500 ms starts a new step', () => {
    const c = clock()
    const store = createBuilderStore(schema(), { clock: c.now })
    const id = idOf(store, 'id')
    store.getState().setKey(id, 'a')
    c.tick(501)
    store.getState().setKey(id, 'ab')
    expect(store.getState().past).toHaveLength(2)
  })

  it('any other edit, or another node, breaks the burst', () => {
    const c = clock()
    const store = createBuilderStore(schema(), { clock: c.now })
    const id = idOf(store, 'id')
    store.getState().setKey(id, 'a')
    store.getState().setAttr(id, 'description', 'x')
    store.getState().setKey(id, 'ab')
    expect(store.getState().past).toHaveLength(3)
    store.getState().setKey(idOf(store, 'role'), 'r')
    expect(store.getState().past).toHaveLength(4)
  })

  it('undo ends the burst: the next edit is a fresh step', () => {
    const c = clock()
    const store = createBuilderStore(schema(), { clock: c.now })
    const id = idOf(store, 'id')
    store.getState().setKey(id, 'a')
    store.getState().undo()
    store.getState().setKey(id, 'b')
    expect(store.getState().past).toHaveLength(1)
    expect(store.getState().future).toHaveLength(0)
  })
})

describe('expanded state and history', () => {
  it('toggleExpanded is UI state: it adds no undo step', () => {
    const store = createBuilderStore(schema())
    store.getState().toggleExpanded(idOf(store, 'address'))
    expect(store.getState().past).toHaveLength(0)
    expect(store.getState().state.expanded.has(idOf(store, 'address'))).toBe(false)
  })

  it('collapsing a node survives an undo of an unrelated edit', () => {
    const c = clock()
    const store = createBuilderStore(schema(), { clock: c.now })
    store.getState().setAttr(idOf(store, 'id'), 'description', 'x')
    store.getState().toggleExpanded(idOf(store, 'address'))
    store.getState().undo()
    expect(store.getState().state.expanded.has(idOf(store, 'address'))).toBe(false)
    store.getState().redo()
    expect(store.getState().state.expanded.has(idOf(store, 'address'))).toBe(false)
  })

  it('a container brought back by undo starts expanded, and one that no longer exists is dropped', () => {
    const store = createBuilderStore(schema())
    const address = idOf(store, 'address')
    store.getState().removeNode(address)
    expect(store.getState().state.expanded.has(address)).toBe(false)
    store.getState().undo()
    expect(store.getState().state.expanded.has(address)).toBe(true)
    store.getState().setType(idOf(store, 'role'), 'object') // creates field_a, role becomes a container
    const role = idOf(store, 'role')
    expect(store.getState().state.expanded.has(role)).toBe(true)
    store.getState().undo()
    expect(store.getState().state.expanded.has(role)).toBe(false)
  })
})

describe('createBuilderStore', () => {
  it('starts from fromSchema(initial) and round-trips through toSchema', () => {
    const store = createBuilderStore(schema())
    expect(store.getState().state).toEqual(fromSchema(schema()))
    expect(store.getState().toSchema()).toEqual(schema())
    expect(
      store
        .getState()
        .rows()
        .map((r) => r.key),
    ).toEqual(['id', 'address', 'city', 'pincode', 'tags', null, 'role'])
  })

  it('notifies subscribers on change, and not on a rejected edit', () => {
    const store = createBuilderStore(schema())
    let calls = 0
    store.subscribe(() => calls++)
    store.getState().setAttr(idOf(store, 'id'), 'description', 'x')
    expect(calls).toBe(1)
    store.getState().removeNode(store.getState().state.rootId)
    expect(calls).toBe(1)
  })

  it('keeps every state consistent while editing (keys under one parent stay in sync)', () => {
    const store = createBuilderStore(schema())
    store.getState().moveNode(idOf(store, 'role'), idOf(store, 'address'), 1)
    expect(keys(store, idOf(store, 'address'))).toEqual(['city', 'role', 'pincode'])
  })
})
