import type { MockNode, MockSchema } from '@mockbench/schema-core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planDrop, planKeyMove, zoneAt } from './drag'
import { SchemaBuilder } from './SchemaBuilder'
import { createBuilderStore, type BuilderState, type NodeId } from './store'

const str: MockNode = { type: 'string' }
const obj = (...fields: [string, MockNode][]): MockNode => ({
  type: 'object',
  fields: fields.map(([key, node]) => ({ key, node })),
})
const env = (root: MockNode): MockSchema => ({ version: 1, components: {}, root })

const abc = env(obj(['a', str], ['b', str], ['c', str]))
const nested = env(
  obj(
    ['a', str],
    ['address', obj(['city', str], ['pincode', str])],
    ['tags', { type: 'array', item: obj(['name', str]) } as MockNode],
  ),
)

function idOf(state: BuilderState, ...path: string[]): NodeId {
  let cur = state.nodes[state.rootId]!
  for (const key of path) {
    const id = cur.childIds.find((c) => state.nodes[c]!.key === key)
    if (!id) throw new Error(`no field ${key}`)
    cur = state.nodes[id]!
  }
  return cur.id
}
const keys = (state: BuilderState, id: NodeId) =>
  state.nodes[id]!.childIds.map((c) => state.nodes[c]!.key)

describe('planDrop', () => {
  it('c above a in {a,b,c} gives c,a,b', () => {
    const store = createBuilderStore(abc)
    const s = store.getState().state
    const plan = planDrop(s, idOf(s, 'c'), idOf(s, 'a'), 'before')!
    expect(plan.ok).toBe(true)
    store.getState().moveNode(idOf(s, 'c'), plan.parentId, plan.index)
    const next = store.getState().state
    expect(keys(next, next.rootId)).toEqual(['c', 'a', 'b'])
  })

  it('accounts for the dragged node leaving a lower slot (a after b)', () => {
    const s = createBuilderStore(abc).getState().state
    const plan = planDrop(s, idOf(s, 'a'), idOf(s, 'b'), 'after')!
    expect(plan).toMatchObject({ parentId: s.rootId, index: 1 })
  })

  it('drops into a sibling object, appending it', () => {
    const store = createBuilderStore(nested)
    const s = store.getState().state
    const address = idOf(s, 'address')
    const plan = planDrop(s, idOf(s, 'a'), address, 'inside')!
    expect(plan).toMatchObject({ parentId: address, ok: true })
    store.getState().moveNode(idOf(s, 'a'), plan.parentId, plan.index)
    const next = store.getState().state
    expect(keys(next, address)).toEqual(['city', 'pincode', 'a'])
    expect(next.nodes[idOf(next, 'address', 'a')]!.parentId).toBe(address)
  })

  it('below an open object means its first child', () => {
    const s = createBuilderStore(nested).getState().state
    const address = idOf(s, 'address')
    expect(planDrop(s, idOf(s, 'a'), address, 'after')).toMatchObject({
      parentId: address,
      index: 0,
      ok: true,
    })
  })

  it('refuses a drop onto the node itself or its descendant', () => {
    const s = createBuilderStore(nested).getState().state
    const address = idOf(s, 'address')
    const city = idOf(s, 'address', 'city')
    expect(planDrop(s, address, address, 'inside')).toBeNull()
    expect(planDrop(s, address, city, 'before')!.ok).toBe(false)
    expect(planDrop(s, address, city, 'after')!.ok).toBe(false)
    expect(planDrop(s, address, address, 'after')).toBeNull()
  })

  it('refuses to put a field beside an array item or detach it', () => {
    const s = createBuilderStore(nested).getState().state
    const tags = idOf(s, 'tags')
    const item = s.nodes[tags]!.childIds[0]!
    expect(planDrop(s, idOf(s, 'a'), item, 'before')!.ok).toBe(false)
    expect(planDrop(s, item, idOf(s, 'address'), 'inside')!.ok).toBe(false)
  })

  it('maps pointer position to a zone', () => {
    expect(zoneAt(100, 40, 105, false)).toBe('before')
    expect(zoneAt(100, 40, 130, false)).toBe('after')
    expect(zoneAt(100, 40, 105, true)).toBe('before')
    expect(zoneAt(100, 40, 120, true)).toBe('inside')
    expect(zoneAt(100, 40, 138, true)).toBe('after')
  })
})

describe('planKeyMove', () => {
  it('moves down, up, in and out with announcements', () => {
    const s = createBuilderStore(nested).getState().state
    const city = idOf(s, 'address', 'city')
    expect(planKeyMove(s, city, 'down')).toMatchObject({ message: 'moved city after pincode' })
    expect(planKeyMove(s, city, 'up')).toBeNull()
    expect(planKeyMove(s, idOf(s, 'address'), 'indent')).toBeNull() // previous sibling is a leaf
    const tags = idOf(s, 'tags')
    expect(planKeyMove(s, tags, 'indent')).toMatchObject({ message: 'moved tags into address' })
    expect(planKeyMove(s, city, 'outdent')).toMatchObject({
      parentId: s.rootId,
      message: 'moved city after address',
    })
    expect(planKeyMove(s, idOf(s, 'a'), 'outdent')).toBeNull()
  })

  it('never moves an array item', () => {
    const s = createBuilderStore(nested).getState().state
    const item = s.nodes[idOf(s, 'tags')]!.childIds[0]!
    for (const m of ['up', 'down', 'indent', 'outdent'] as const) {
      expect(planKeyMove(s, item, m)).toBeNull()
    }
    const name = s.nodes[item]!.childIds[0]!
    expect(planKeyMove(s, name, 'outdent')).toBeNull() // the grandparent is an array
  })
})

const names = () => screen.getAllByRole('group').map((r) => r.getAttribute('aria-label'))

describe('SchemaBuilder keyboard moves', () => {
  it('Alt+ArrowDown moves the row and announces it', () => {
    render(<SchemaBuilder value={nested} onChange={vi.fn()} />)
    const city = screen.getByRole('group', { name: 'city' })
    fireEvent.keyDown(city.querySelector('input')!, { key: 'ArrowDown', altKey: true })
    expect(names().slice(0, 5)).toEqual(['a', 'address', 'pincode', 'city', 'tags'])
    expect(screen.getByTestId('move-announcer')).toHaveTextContent('moved city after pincode')
  })

  it('Alt+ArrowRight nests into a previous object and Alt+ArrowLeft undoes it', () => {
    const value = env(obj(['address', obj(['city', str])], ['zip', str]))
    render(<SchemaBuilder value={value} onChange={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('group', { name: 'zip' }).querySelector('input')!, {
      key: 'ArrowRight',
      altKey: true,
    })
    expect(screen.getByRole('group', { name: 'zip' })).toHaveAttribute('data-depth', '1')
    fireEvent.keyDown(screen.getByRole('group', { name: 'zip' }).querySelector('input')!, {
      key: 'ArrowLeft',
      altKey: true,
    })
    expect(screen.getByRole('group', { name: 'zip' })).toHaveAttribute('data-depth', '0')
  })

  it('does nothing on the [ item ] row, which has no drag handle', () => {
    render(<SchemaBuilder value={nested} onChange={vi.fn()} />)
    const item = screen.getByRole('group', { name: '[ item ]' })
    expect(item.querySelector('[aria-label^="Drag"]')).toBeNull()
    fireEvent.keyDown(item, { key: 'ArrowDown', altKey: true })
    expect(names()).toContain('[ item ]')
  })

  it('has no drag handle when read only', () => {
    render(<SchemaBuilder value={abc} onChange={vi.fn()} readOnly />)
    expect(
      screen.getByRole('group', { name: 'a' }).querySelector('[aria-label^="Drag"]'),
    ).toBeDisabled()
  })
})

describe('SchemaBuilder virtualisation', () => {
  const manyFields = (n: number) =>
    env(obj(...Array.from({ length: n }, (_, i): [string, MockNode] => [`f${i}`, str])))

  beforeEach(() => {
    // jsdom has no layout: give the viewport a height and every row 36px, as a browser would.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(36)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 36,
      width: 800,
      height: 36,
      toJSON: () => ({}),
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('renders every row at 200 and a window at 201', () => {
    const { unmount } = render(<SchemaBuilder value={manyFields(200)} onChange={vi.fn()} />)
    expect(screen.getAllByRole('group')).toHaveLength(200)
    expect(screen.queryByTestId('builder-scroll')).toBeNull()
    unmount()
    render(<SchemaBuilder value={manyFields(201)} onChange={vi.fn()} />)
    expect(screen.getByTestId('builder-scroll')).toBeInTheDocument()
    const count = screen.getAllByRole('group').length
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(60)
  }, 30_000)

  it('keeps a 2,000 node schema to at most 60 rows in the DOM', () => {
    render(<SchemaBuilder value={manyFields(2000)} onChange={vi.fn()} />)
    expect(screen.getAllByRole('group').length).toBeLessThanOrEqual(60)
  })

  it('collapsing a big node removes its rows at once', () => {
    const big = env(
      obj(
        ['big', obj(...Array.from({ length: 500 }, (_, i): [string, MockNode] => [`k${i}`, str]))],
        ['tail', str],
      ),
    )
    render(<SchemaBuilder value={big} onChange={vi.fn()} />)
    expect(screen.getByTestId('builder-scroll')).toBeInTheDocument()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Collapse big' }))
    })
    expect(screen.queryByTestId('builder-scroll')).toBeNull()
    expect(names()).toEqual(['big', 'tail'])
  })
})

describe('undo after a move', () => {
  it('restores the order in one step', () => {
    const store = createBuilderStore(abc)
    const s = store.getState().state
    store.getState().moveNode(idOf(s, 'c'), s.rootId, 0)
    store.getState().undo()
    const next = store.getState().state
    expect(keys(next, next.rootId)).toEqual(['a', 'b', 'c'])
  })
})
