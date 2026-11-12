// RUN-06: one test per acceptance criterion in docs/specs/RUN-06-version-cache.md.
import type { Snapshot } from '@mockbench/api-contract'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { projects } from '../../db/schema'
import { createHooks } from '../../http/hooks'
import { testApp } from '../../testing'
import type { TestApp } from '../../testing'
import { VersionCache, VersionLoadError } from './version-cache'

const hooks = createHooks()
let t: TestApp
beforeAll(async () => {
  t = await testApp({ deps: { hooks } })
})
afterAll(() => t.drop())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const MB = 1024 * 1024

function queryCounter() {
  const spy = vi.spyOn(t.pool, 'query')
  return { count: () => spy.mock.calls.length, reset: () => spy.mockClear(), spy }
}

/** A project with one route/case; `bodyChars` controls the baked size. */
async function makeVersion(projectId: string, o: { bodyChars?: number; label?: string } = {}) {
  const project = (await t.db.select().from(projects).where(eq(projects.id, projectId)))[0]!
  const snapshot: Snapshot = {
    schemaVersion: 1,
    generatorVersion: 1,
    project: {
      id: project.id,
      slug: project.slug,
      settings: project.settings as Snapshot['project']['settings'],
      components: {},
    },
    routes: [
      {
        id: 'r1',
        method: 'GET',
        path: '/ping',
        description: null,
        cases: [
          {
            id: 'c1',
            name: 'OK',
            statusCode: 200,
            headers: {},
            delayMs: null,
            isDefault: true,
            schema: { version: 1, components: {}, root: { type: 'object', fields: [] } },
          },
        ],
      },
    ],
    presets: [],
  }
  const baked = JSON.stringify({ 'r1:c1': 'x'.repeat(o.bodyChars ?? 10) })
  return t.f.createVersion({
    projectId,
    snapshot,
    baked,
    bakedBytes: baked.length,
    ...(o.label ? { label: o.label } : {}),
  })
}

async function liveProject(o: { bodyChars?: number } = {}) {
  const ws = await t.f.createWorkspace()
  const project = await t.f.createProject({ workspaceId: ws.id })
  const v = await makeVersion(project.id, o)
  await t.f.createDeployment({ projectId: project.id, versionId: v.id })
  return { ws, project, v }
}

const newCache = (o: Partial<ConstructorParameters<typeof VersionCache>[0]> = {}) =>
  new VersionCache({ db: t.db, maxBytes: 256 * MB, ...o })

describe('VersionCache', () => {
  it('a cold lookup runs at most 2 queries; the next 1,000 run zero', async () => {
    const { project, v } = await liveProject()
    const cache = newCache()
    const q = queryCounter()
    const first = await cache.get(project.slug)
    expect(first.status).toBe('live')
    if (first.status === 'live') expect(first.version.label).toBe(v.label)
    expect(q.count()).toBeLessThanOrEqual(2)
    q.reset()
    for (let i = 0; i < 1000; i++) await cache.get(project.slug)
    expect(q.count()).toBe(0)
  })

  it('50 concurrent cold lookups for one slug trigger exactly one load', async () => {
    const { project } = await liveProject()
    const cache = newCache()
    const q = queryCounter()
    const results = await Promise.all(Array.from({ length: 50 }, () => cache.get(project.slug)))
    expect(q.count()).toBe(2)
    expect(new Set(results.map((r) => (r.status === 'live' ? r.version : null))).size).toBe(1)
  })

  it('unknown slug: one query, none within 5 s, again after 5 s; a deploy makes a new slug live', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const cache = newCache()
    const q = queryCounter()
    expect(await cache.get('brand-new-slug')).toEqual({ status: 'unknown' })
    expect(q.count()).toBe(1)
    q.reset()
    vi.advanceTimersByTime(4900)
    expect(await cache.get('brand-new-slug')).toEqual({ status: 'unknown' })
    expect(q.count()).toBe(0)
    vi.advanceTimersByTime(200)
    await cache.get('brand-new-slug')
    expect(q.count()).toBe(1)

    // Create the project, then deploy: the negative entry is dropped by the hook.
    const off = registerListeners(cache)
    const ws = await t.f.createWorkspace()
    const project = await t.f.createProject({ workspaceId: ws.id, slug: 'brand-new-slug' })
    expect(await cache.get('brand-new-slug')).toEqual({ status: 'unknown' }) // still negative
    const v = await makeVersion(project.id)
    await t.f.createDeployment({ projectId: project.id, versionId: v.id })
    await hooks.onVersionDeployed.emit(project.id)
    expect((await cache.get('brand-new-slug')).status).toBe('live')
    off()
  })

  it('deploy.create serves the new version label next lookup; rollback returns the old one', async () => {
    const ws = await t.f.createWorkspace()
    const m = await t.f.createMember({ workspaceId: ws.id, role: 'editor' })
    const s = await t.session(m.userId)
    const project = await t.f.createProject({ workspaceId: ws.id })
    const v1 = await makeVersion(project.id, { label: 'one' })
    const v2 = await makeVersion(project.id, { label: 'two' })
    const cache = await appCache()
    const deploy = (id: string) =>
      t.as(s).post(`/api/v1/projects/${project.id}/deploy`).send({ versionId: id })
    const label = async () => {
      const r = await cache.get(project.slug)
      return r.status === 'live' ? r.version.label : r.status
    }
    expect(await label()).toBe('unpublished')
    expect((await deploy(v1.id)).status).toBe(200)
    expect(await label()).toBe('one')
    expect((await deploy(v2.id)).status).toBe(200)
    expect(await label()).toBe('two')
    expect((await deploy(v1.id)).status).toBe(200)
    expect(await label()).toBe('one')
  })

  it('after project deletion the slug becomes unknown', async () => {
    const ws = await t.f.createWorkspace()
    const m = await t.f.createMember({ workspaceId: ws.id, role: 'owner' })
    const s = await t.session(m.userId)
    const project = await t.f.createProject({ workspaceId: ws.id })
    const v = await makeVersion(project.id)
    await t.f.createDeployment({ projectId: project.id, versionId: v.id })
    const cache = await appCache()
    expect((await cache.get(project.slug)).status).toBe('live')
    const res = await t.as(s).delete(`/api/v1/projects/${project.id}`)
    expect(res.status).toBe(204)
    expect(await cache.get(project.slug)).toEqual({ status: 'unknown' })
  })

  it('cache.flush: 204 and the next lookup reloads; viewer gets 403', async () => {
    const { ws, project } = await liveProject()
    const editor = await t.session(
      (await t.f.createMember({ workspaceId: ws.id, role: 'editor' })).userId,
    )
    const viewer = await t.session(
      (await t.f.createMember({ workspaceId: ws.id, role: 'viewer' })).userId,
    )
    const cache = await appCache()
    await cache.get(project.slug)
    const q = queryCounter()
    await cache.get(project.slug)
    expect(q.count()).toBe(0)
    const url = `/api/v1/projects/${project.id}/cache/flush`
    expect((await t.as(viewer).post(url)).status).toBe(403)
    q.reset()
    await cache.get(project.slug)
    expect(q.count()).toBe(0)
    expect((await t.as(editor).post(url)).status).toBe(204)
    q.reset()
    await cache.get(project.slug)
    expect(q.count()).toBe(2)
  })

  it('byte bound: least recently used is evicted, resident bytes stay bounded, evicted reloads correctly', async () => {
    const a = await liveProject({ bodyChars: 200_000 })
    const b = await liveProject({ bodyChars: 200_000 })
    const c = await liveProject({ bodyChars: 200_000 })
    const cache = newCache({ maxBytes: 1 * MB })
    const q = queryCounter()
    await cache.get(a.project.slug)
    await cache.get(b.project.slug)
    const one = cache.bytes / 2
    expect(cache.size).toBe(2)
    await cache.get(c.project.slug) // evicts a
    expect(cache.size).toBe(2)
    expect(cache.bytes).toBeLessThanOrEqual(1 * MB + one)
    q.reset()
    await cache.get(b.project.slug)
    await cache.get(c.project.slug)
    expect(q.count()).toBe(0)
    const again = await cache.get(a.project.slug) // reloads a
    expect(q.count()).toBe(2)
    expect(again.status).toBe('live')
    if (again.status === 'live') {
      const route = again.version.match('GET', '/ping')!.route
      expect(again.version.body(route.defaultCase)).toBe('x'.repeat(200_000))
    }
  })

  it('a version larger than the bound is served and held as the sole entry', async () => {
    const big = await liveProject({ bodyChars: 700_000 })
    const cache = newCache({ maxBytes: 1 * MB })
    expect((await cache.get(big.project.slug)).status).toBe('live')
    expect(cache.size).toBe(1)
    const q = queryCounter()
    await cache.get(big.project.slug)
    await cache.get(big.project.slug)
    expect(q.count()).toBe(0)
  })

  it('a project with no active version is unpublished and loads no version', async () => {
    const ws = await t.f.createWorkspace()
    const project = await t.f.createProject({ workspaceId: ws.id })
    await makeVersion(project.id)
    const cache = newCache()
    const q = queryCounter()
    expect(await cache.get(project.slug)).toEqual({ status: 'unpublished', projectId: project.id })
    expect(q.count()).toBe(1)
  })

  it('a failed load is not cached, throws VersionLoadError, and recovers', async () => {
    const { project } = await liveProject()
    const cache = newCache()
    const q = queryCounter()
    q.spy.mockRejectedValueOnce(new Error('connection refused'))
    await expect(cache.get(project.slug)).rejects.toBeInstanceOf(VersionLoadError)
    expect(cache.size).toBe(0)
    expect((await cache.get(project.slug)).status).toBe('live')
  })

  it('a load that straddles an invalidation does not store its stale result', async () => {
    const { project } = await liveProject()
    const cache = newCache()
    const pending = cache.get(project.slug)
    cache.flushProject(project.id)
    await pending
    expect(cache.size).toBe(0)
  })
})

/** The cache the app itself created in the versions module's init. */
async function appCache(): Promise<VersionCache> {
  const { versionCacheOf } = await import('./version-cache')
  return versionCacheOf(hooks)
}

function registerListeners(cache: VersionCache): () => void {
  return hooks.onVersionDeployed.on((id) => cache.invalidateProject(id))
}
