// RUN-10: diffSnapshots table tests (docs/specs/RUN-10-version-diff.md).
import type { Snapshot } from '@mockbench/api-contract'
import { describe, expect, it } from 'vitest'
import { diffSnapshots } from './diff'

type Node = Record<string, unknown>
const obj = (...fields: [string, Node][]): Node => ({
  type: 'object',
  fields: fields.map(([key, node]) => ({ key, node })),
})
const env = (root: Node, components: Record<string, Node> = {}) => ({
  version: 1,
  components,
  root,
})
const kase = (name: string, over: Record<string, unknown> = {}) => ({
  id: `c-${name}`,
  name,
  statusCode: 200,
  headers: {},
  delayMs: null,
  isDefault: false,
  schema: env(obj(['id', { type: 'integer' }])),
  ...over,
})
const route = (method: string, path: string, cases: unknown[] = [kase('Found')]) => ({
  id: `r-${method}${path}`,
  method,
  path,
  description: null,
  cases,
})
const SETTINGS = { indexing: 'local', mode: 'deterministic', cors: '*', defaultDelayMs: 0 }
const project = (over: Record<string, unknown> = {}) => ({
  id: 'p',
  slug: 'p',
  settings: SETTINGS,
  components: {},
  ...over,
})
const snap = (routes: unknown[] = [], over: Record<string, unknown> = {}): Snapshot =>
  ({
    schemaVersion: 1,
    generatorVersion: 1,
    project: project(),
    routes,
    presets: [],
    ...over,
  }) as unknown as Snapshot

const withSchema = (root: Node) =>
  snap([route('GET', '/users', [kase('Found', { schema: env(root) })])])
const schemaChanges = (a: Snapshot, b: Snapshot) =>
  diffSnapshots(a, b).routes.changed[0]!.cases.changed[0]!.schema
const EMPTY = {
  settings: [],
  components: { added: [], removed: [], changed: [] },
  presets: { added: [], removed: [], changed: [] },
  routes: { added: [], removed: [], changed: [] },
}

describe('diffSnapshots', () => {
  it('identical snapshots give an empty diff', () => {
    const s = snap([route('GET', '/a'), route('POST', '/b')])
    expect(diffSnapshots(s, structuredClone(s))).toMatchObject(EMPTY)
  })

  it('reports added and removed routes; a param rename is not a change', () => {
    const a = snap([route('GET', '/old'), route('GET', '/users/:id')])
    const b = snap([route('GET', '/new'), route('GET', '/users/:userId')])
    const d = diffSnapshots(a, b)
    expect(d.routes.added).toEqual([{ method: 'GET', path: '/new' }])
    expect(d.routes.removed).toEqual([{ method: 'GET', path: '/old' }])
    expect(d.routes.changed).toEqual([])
  })

  it('a renamed case is one removed and one added case', () => {
    const a = snap([route('GET', '/x', [kase('Found')])])
    const b = snap([route('GET', '/x', [kase('OK')])])
    const [r] = diffSnapshots(a, b).routes.changed
    expect(r!.cases.removed).toEqual([{ name: 'Found', statusCode: 200 }])
    expect(r!.cases.added).toEqual([{ name: 'OK', statusCode: 200 }])
    expect(r!.cases.changed).toEqual([])
  })

  it('matches case names case-insensitively', () => {
    const a = snap([route('GET', '/x', [kase('Found')])])
    const b = snap([route('GET', '/x', [kase('FOUND')])])
    expect(diffSnapshots(a, b).routes.changed).toEqual([])
  })

  it('a field added to an object', () => {
    const a = withSchema(obj(['address', obj(['city', { type: 'string' }])]))
    const b = withSchema(
      obj(['address', obj(['city', { type: 'string' }], ['zip', { type: 'string' }])]),
    )
    expect(schemaChanges(a, b)).toEqual([
      { path: '$.address.zip', kind: 'added', after: { type: 'string' } },
    ])
  })

  it('a field removed, and a type changed', () => {
    const a = withSchema(obj(['pincode', { type: 'integer' }], ['gone', { type: 'string' }]))
    const b = withSchema(obj(['pincode', { type: 'string' }]))
    expect(schemaChanges(a, b)).toEqual([
      {
        path: '$.pincode',
        kind: 'changed',
        before: { type: 'integer' },
        after: { type: 'string' },
      },
      { path: '$.gone', kind: 'removed', before: { type: 'string' } },
    ])
  })

  it('a change inside an array element uses [*]', () => {
    const orders = (total: string) =>
      obj(['orders', { type: 'array', items: obj(['total', { type: total }]) }])
    expect(schemaChanges(withSchema(orders('integer')), withSchema(orders('number')))).toEqual([
      {
        path: '$.orders[*].total',
        kind: 'changed',
        before: { type: 'integer' },
        after: { type: 'number' },
      },
    ])
  })

  it('status code and isDefault changes are case fields; defaultDelayMs is a setting', () => {
    const a = snap([route('GET', '/x', [kase('Found')])])
    const b = snap([route('GET', '/x', [kase('Found', { statusCode: 201, isDefault: true })])], {
      project: project({ settings: { ...SETTINGS, defaultDelayMs: 50 } }),
    })
    const d = diffSnapshots(a, b)
    expect(d.settings).toEqual([{ field: 'defaultDelayMs', before: 0, after: 50 }])
    expect(d.routes.changed[0]!.cases.changed[0]).toEqual({
      name: 'Found',
      fields: [
        { field: 'statusCode', before: 200, after: 201 },
        { field: 'isDefault', before: false, after: true },
      ],
      schema: [],
    })
  })

  it('presets and components by name', () => {
    const preset = (name: string, v: string, id = 'x') => ({
      id,
      name,
      priority: 1,
      rules: [{ v }],
    })
    const str = { type: 'string' }
    const a = snap([], {
      presets: [preset('keep', 'a'), preset('drop', 'a'), preset('edit', 'a')],
      project: project({ components: { A: str, B: str, C: str } }),
    })
    const b = snap([], {
      presets: [preset('keep', 'a', 'other'), preset('edit', 'b'), preset('new', 'a')],
      project: project({ components: { A: str, C: { type: 'integer' }, D: str } }),
    })
    const d = diffSnapshots(a, b)
    expect(d.presets).toEqual({ added: ['new'], removed: ['drop'], changed: ['edit'] })
    expect(d.components).toEqual({ added: ['D'], removed: ['B'], changed: ['C'] })
  })

  it('is deterministic regardless of input order', () => {
    const rs = [route('POST', '/b'), route('GET', '/a'), route('GET', '/c')]
    const one = diffSnapshots(snap(), snap(rs))
    const two = diffSnapshots(snap(), snap([...rs].reverse()))
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
    expect(one.routes.added.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /a',
      'GET /c',
      'POST /b',
    ])
  })

  it('diffs two 500-route snapshots in under 500 ms', () => {
    const many = (total: string) =>
      snap(
        Array.from({ length: 500 }, (_, i) =>
          route('GET', `/r${i}`, [
            kase('Found', { schema: env(obj(['a', { type: total }], ['b', { type: 'string' }])) }),
            kase('Missing', { statusCode: 404 }),
          ]),
        ),
      )
    const a = many('integer')
    const b = many('string')
    const start = performance.now()
    const d = diffSnapshots(a, b)
    expect(performance.now() - start).toBeLessThan(500)
    expect(d.routes.changed).toHaveLength(500)
  })
})
