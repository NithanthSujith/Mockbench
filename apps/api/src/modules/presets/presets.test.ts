// PRJ-02 acceptance tests: the presets.* endpoints against the real app and a real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testApp } from '../../testing'
import type { TestApp, TestSession } from '../../testing'

let app: TestApp
let editor: TestSession
let viewer: TestSession
let outsider: TestSession
let workspaceId: string

beforeAll(async () => {
  app = await testApp()
  workspaceId = (await app.f.createWorkspace()).id
  const member = async (role: 'owner' | 'editor' | 'viewer') => {
    const s = await app.session()
    await app.f.createMember({ workspaceId, userId: s.userId, role })
    return s
  }
  editor = await member('editor')
  viewer = await member('viewer')
  outsider = await app.session()
})

afterAll(async () => {
  await app?.drop()
})

const rule = { match: { key: 'email' }, value: 'a@b.test' }

async function create(projectId: string, body: unknown, who: TestSession = editor) {
  const res = await app
    .as(who)
    .post(app.pathFor('presets.create', { projectId }))
    .send(body as object)
  app.assertContract('presets.create', res)
  return res
}

describe('presets.create', () => {
  it('role matrix: editor 201 with defaults, viewer 403, non-member 404', async () => {
    const p = await app.f.createProject({ workspaceId })
    const ok = await create(p.id, { name: 'A', rules: [rule] })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ isEnabled: true, priority: 0, projectId: p.id, name: 'A' })
    expect((await create(p.id, { name: 'A', rules: [] }, viewer)).status).toBe(403)
    expect((await create(p.id, { name: 'A', rules: [] }, outsider)).status).toBe(404)
  })

  const bad: [string, unknown][] = [
    ['value and values', { match: { key: 'k' }, value: 1, values: [1] }],
    ['value and pattern', { match: { key: 'k' }, value: 1, pattern: 'x{n}' }],
    ['values and pattern', { match: { key: 'k' }, values: [1], pattern: 'x{n}' }],
    ['none of value|values|pattern', { match: { key: 'k' } }],
    ['empty match', { match: {}, value: 1 }],
  ]
  it.each(bad)('rule with %s is 422 with a path into rules[1]', async (_n, badRule) => {
    const p = await app.f.createProject({ workspaceId })
    const res = await create(p.id, { name: 'A', rules: [rule, badRule] })
    expect(res.status).toBe(422)
    const paths = (res.body.details as { path: (string | number)[] }[]).map((d) => d.path)
    expect(paths.some((x) => x[0] === 'rules' && x[1] === 1)).toBe(true)
  })

  it('more than 500 rules is 422; exactly 500 is accepted', async () => {
    const p = await app.f.createProject({ workspaceId })
    expect((await create(p.id, { name: 'A', rules: Array(501).fill(rule) })).status).toBe(422)
    expect((await create(p.id, { name: 'A', rules: Array(500).fill(rule) })).status).toBe(201)
  })
})

describe('presets.update', () => {
  it('replaces rules wholesale, leaves them alone on other patches, rejects name:null', async () => {
    const p = await app.f.createProject({ workspaceId })
    const made = await create(p.id, { name: 'A', rules: [rule, rule] })
    const patch = async (body: object, who: TestSession = editor) => {
      const res = await app
        .as(who)
        .patch(app.pathFor('presets.update', { presetId: made.body.id }))
        .send(body)
      app.assertContract('presets.update', res)
      return res
    }
    const other = { match: { type: 'string' }, values: ['x', 'y'] }
    const r1 = await patch({ rules: [other] })
    expect(r1.status).toBe(200)
    expect(r1.body.rules).toEqual([other])
    const r2 = await patch({ isEnabled: false })
    expect(r2.body).toMatchObject({ isEnabled: false, rules: [other] })
    expect((await patch({ name: null })).status).toBe(422)
    expect((await patch({ priority: 5 }, viewer)).status).toBe(403)
    expect((await patch({ priority: 5 }, outsider)).status).toBe(404)
  })
})

describe('presets.list', () => {
  it('orders by priority desc then createdAt asc; all items; nextCursor null', async () => {
    const p = await app.f.createProject({ workspaceId })
    const a = await create(p.id, { name: 'a', rules: [], priority: 1 })
    const b = await create(p.id, { name: 'b', rules: [], priority: 5 })
    const c = await create(p.id, { name: 'c', rules: [], priority: 1 })
    const res = await app.as(viewer).get(app.pathFor('presets.list', { projectId: p.id }))
    app.assertContract('presets.list', res)
    expect(res.status).toBe(200)
    expect(res.body.items.map((x: { id: string }) => x.id)).toEqual([
      b.body.id,
      a.body.id,
      c.body.id,
    ])
    expect(res.body.nextCursor).toBeNull()
    const out = await app.as(outsider).get(app.pathFor('presets.list', { projectId: p.id }))
    expect(out.status).toBe(404)
  })
})

describe('presets.delete', () => {
  it('editor 204; viewer 403; other workspace 404', async () => {
    const p = await app.f.createProject({ workspaceId })
    const made = await create(p.id, { name: 'A', rules: [] })
    const del = (who: TestSession) =>
      app.as(who).delete(app.pathFor('presets.delete', { presetId: made.body.id }))
    expect((await del(viewer)).status).toBe(403)
    expect((await del(outsider)).status).toBe(404)
    const ok = await del(editor)
    app.assertContract('presets.delete', ok)
    expect(ok.status).toBe(204)
    expect((await del(editor)).status).toBe(404)
  })
})
