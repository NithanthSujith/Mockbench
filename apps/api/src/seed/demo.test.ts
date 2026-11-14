// RUN-11: one test per acceptance criterion in docs/specs/RUN-11-demo-seed.md.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { count, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTestDb } from '../db/testing'
import { logSink } from '../__tests__/helpers'
import { start } from '../server'
import { deployments, projects, versions, workspaceMembers, workspaces } from '../db/schema'
import { createHooks } from '../http/hooks'
import { testApp } from '../testing'
import type { TestApp } from '../testing'
import { seedDemo, seedDemoOnStart } from './demo'

const apps: TestApp[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(apps.splice(0).map((a) => a.drop()))
})
async function fresh(): Promise<TestApp & { hooks: ReturnType<typeof createHooks> }> {
  const hooks = createHooks()
  const t = await testApp({ deps: { hooks } })
  apps.push(t)
  return Object.assign(t, { hooks })
}
const tableCounts = async (t: TestApp) => ({
  projects: (await t.db.select({ n: count() }).from(projects))[0]!.n,
  versions: (await t.db.select({ n: count() }).from(versions))[0]!.n,
  deployments: (await t.db.select({ n: count() }).from(deployments))[0]!.n,
  workspaces: (await t.db.select({ n: count() }).from(workspaces))[0]!.n,
})
const register = (t: TestApp, email: string) =>
  t.as().post('/api/v1/auth/register').send({ email, password: 'correct horse battery', name: 'N' })

describe('demo seed', () => {
  it('serves /mock/demo/users right after seeding: v1, three users, detail, Not found case', async () => {
    const t = await fresh()
    const emitted: string[] = []
    t.hooks.onVersionDeployed.on((id) => void emitted.push(id))
    const res0 = await t.as().get('/mock/demo/users') // warm a negative slug entry first
    expect(res0.status).toBe(404)
    const result = await seedDemo(t.db, t.hooks)
    expect(result.seeded).toBe(true)
    expect(emitted).toHaveLength(1)

    const list = await t.as().get('/mock/demo/users')
    expect(list.status).toBe(200)
    expect(list.headers['x-mock-version']).toBe('v1')
    expect(list.body).toHaveLength(3)
    expect(list.body[0]).toMatchObject({ id: 1, email: expect.stringContaining('@') })

    expect((await t.as().get('/mock/demo/users/1')).status).toBe(200)
    const nf = await t.as().get('/mock/demo/users/1').set('X-Mock-Case', 'Not found')
    expect(nf.status).toBe(404)
    expect((await t.as().post('/mock/demo/users')).status).toBe(201)
    const bad = await t.as().post('/mock/demo/users').set('X-Mock-Case', 'Validation failed')
    expect(bad.status).toBe(422)
  })

  it('created_by and deployed_by are null; the workspace has no members', async () => {
    const t = await fresh()
    await seedDemo(t.db, t.hooks)
    const [v] = await t.db.select().from(versions)
    const [d] = await t.db.select().from(deployments)
    expect(v!.createdBy).toBeNull()
    expect(d!.deployedBy).toBeNull()
    expect((await t.db.select({ n: count() }).from(workspaceMembers))[0]!.n).toBe(0)
  })

  it('is idempotent across restarts and concurrent starts', async () => {
    const t = await fresh()
    const results = await Promise.all([seedDemo(t.db, t.hooks), seedDemo(t.db, t.hooks)])
    expect(results.filter((r) => r.seeded)).toHaveLength(1)
    expect(await seedDemo(t.db, t.hooks)).toEqual({ seeded: false })
    expect(await tableCounts(t)).toEqual({
      projects: 1,
      versions: 1,
      deployments: 1,
      workspaces: 1,
    })
  })

  async function startOn(seed: 'true' | 'false') {
    const db = await withTestDb()
    const probe = createServer().listen(0, '127.0.0.1')
    await new Promise((r) => probe.once('listening', r))
    const port = (probe.address() as AddressInfo).port
    await new Promise((r) => probe.close(r))
    const started = await start(
      {
        NODE_ENV: 'test',
        DATABASE_URL: db.url,
        SESSION_SECRET: 'a-real-secret',
        HOST: '127.0.0.1',
        API_PORT: String(port),
        SEED_DEMO: seed,
      },
      { logDestination: logSink().stream as never },
    )
    return { started, db, port }
  }

  it('start() with SEED_DEMO=true serves /mock/demo/users at once; a second start adds nothing', async () => {
    const { started, db, port } = await startOn('true')
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mock/demo/users`)
      expect(res.status).toBe(200)
      expect(res.headers.get('x-mock-version')).toBe('v1')
      expect(await res.json()).toHaveLength(3)
      // "Starting again": a second api process on the same database.
      await started.shutdown()
      const again = await start(
        {
          NODE_ENV: 'test',
          DATABASE_URL: db.url,
          SESSION_SECRET: 'a-real-secret',
          HOST: '127.0.0.1',
          API_PORT: String(port),
          SEED_DEMO: 'true',
        },
        { logDestination: logSink().stream as never },
      )
      try {
        const n = await db.db.select({ n: count() }).from(projects)
        expect(n[0]!.n).toBe(1)
        expect((await db.db.select({ n: count() }).from(deployments))[0]!.n).toBe(1)
      } finally {
        await again.shutdown()
      }
    } finally {
      await db.drop()
    }
  })

  it('start() with SEED_DEMO=false seeds nothing', async () => {
    const { started, db, port } = await startOn('false')
    try {
      expect((await fetch(`http://127.0.0.1:${port}/mock/demo/users`)).status).toBe(404)
      expect(await tableCounts({ db: db.db } as TestApp)).toMatchObject({
        projects: 0,
        workspaces: 0,
      })
    } finally {
      await started.shutdown()
      await db.drop()
    }
  })

  it('first registrant owns workspace default and sees demo; a second sees no workspace', async () => {
    const t = await fresh()
    await seedDemo(t.db, t.hooks)
    const first = await register(t, 'a@example.com')
    expect(first.status).toBe(201)
    expect(first.body.workspaces).toEqual([
      expect.objectContaining({ slug: 'default', role: 'owner' }),
    ])
    const cookie = { cookie: first.headers['set-cookie']![0]!.split(';')[0]! }
    const wsId = first.body.workspaces[0].id as string
    const list = await t.as(cookie).get(`/api/v1/projects?workspaceId=${wsId}`)
    expect(list.body.items.map((p: { slug: string }) => p.slug)).toEqual(['demo'])

    const second = await register(t, 'b@example.com')
    expect(second.status).toBe(201)
    expect(second.body.workspaces).toEqual([])
    expect((await tableCounts(t)).workspaces).toBe(1)
  })

  it('does not re-seed after a user registered and deleted the demo project', async () => {
    const t = await fresh()
    await seedDemo(t.db, t.hooks)
    await register(t, 'a@example.com')
    await t.db.delete(projects).where(eq(projects.slug, 'demo'))
    expect(await seedDemo(t.db, t.hooks)).toEqual({ seeded: false })
    expect((await tableCounts(t)).projects).toBe(0)
  })

  it('rolls back completely on failure, logs one error and does not throw', async () => {
    const t = await fresh()
    const failing = createHooks()
    // A deploy-time failure after everything was built: make the version insert impossible by
    // pre-claiming the label with a throwing hook is not enough (hooks run after commit), so break
    // the transaction by dropping a table the publish step needs.
    await t.pool.query('alter table versions rename to versions_gone')
    const error = vi.fn()
    const logger = { info: vi.fn(), error } as unknown as Parameters<typeof seedDemoOnStart>[2]
    await expect(seedDemoOnStart(t.db, failing, logger)).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledTimes(1)
    await t.pool.query('alter table versions_gone rename to versions')
    expect(await tableCounts(t)).toEqual({
      projects: 0,
      versions: 0,
      deployments: 0,
      workspaces: 0,
    })
  })
})
