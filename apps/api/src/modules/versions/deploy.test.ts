// RUN-03: one test per acceptance criterion in docs/specs/RUN-03-deploy-deployments-api.md.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deployments, projects, versions } from '../../db/schema'
import { createHooks } from '../../http/hooks'
import { testApp } from '../../testing'
import type { TestApp, TestSession } from '../../testing'

type Role = 'owner' | 'editor' | 'viewer'

const hooks = createHooks()
let t: TestApp
beforeAll(async () => {
  t = await testApp({ deps: { hooks } })
})
afterAll(() => t.drop())

async function world() {
  const ws = await t.f.createWorkspace()
  const people = {} as Record<Role | 'outsider', TestSession & { userId: string }>
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    const m = await t.f.createMember({ workspaceId: ws.id, role })
    people[role] = { ...(await t.session(m.userId)), userId: m.userId }
  }
  people.outsider = { ...(await t.session()), userId: '' }
  const project = await t.f.createProject({ workspaceId: ws.id })
  const v1 = await t.f.createVersion({ projectId: project.id })
  const v2 = await t.f.createVersion({ projectId: project.id })
  return { ws, project, v1, v2, ...people }
}
type World = Awaited<ReturnType<typeof world>>

const deploy = (w: World, versionId: string, who: TestSession = w.editor) =>
  t.as(who).post(`/api/v1/projects/${w.project.id}/deploy`).send({ versionId })
const history = (w: World, query = '', who: TestSession = w.viewer) =>
  t.as(who).get(`/api/v1/projects/${w.project.id}/deployments${query}`)
const rows = (projectId: string) =>
  t.db.select().from(deployments).where(eq(deployments.projectId, projectId))
const activeOf = async (projectId: string) =>
  (await t.db.select().from(projects).where(eq(projects.id, projectId)))[0]!.activeVersionId

function listen(fn: (id: string) => void | Promise<void>) {
  const calls: string[] = []
  const off = hooks.onVersionDeployed.on(async (id) => {
    calls.push(id)
    await fn(id)
  })
  return { calls, off }
}

describe('deploy.create', () => {
  it('deploys: 200 Deployment, active_version_id set, one row', async () => {
    const w = await world()
    const res = await deploy(w, w.v1.id)
    expect(res.status).toBe(200)
    t.assertContract('deploy.create', res)
    expect(res.body).toMatchObject({
      projectId: w.project.id,
      versionId: w.v1.id,
      versionLabel: w.v1.label,
      deployedBy: { id: w.editor.userId },
    })
    expect(await activeOf(w.project.id)).toBe(w.v1.id)
    expect(await rows(w.project.id)).toHaveLength(1)
  })

  it('rollback appends another row; history is newest first', async () => {
    const w = await world()
    const a = await deploy(w, w.v2.id)
    const b = await deploy(w, w.v1.id)
    expect(b.status).toBe(200)
    expect(await activeOf(w.project.id)).toBe(w.v1.id)
    const res = await history(w)
    expect(res.status).toBe(200)
    t.assertContract('deployments.list', res)
    expect(res.body.items.map((d: { id: string }) => d.id)).toEqual([b.body.id, a.body.id])
  })

  it('deploying the already-active version returns the latest deployment and adds no row', async () => {
    const w = await world()
    await deploy(w, w.v1.id)
    const second = await deploy(w, w.v2.id)
    const again = await deploy(w, w.v2.id)
    expect(again.status).toBe(200)
    expect(again.body.id).toBe(second.body.id)
    expect(await rows(w.project.id)).toHaveLength(2)
  })

  it('another project version or a random id is 404 version_not_found and changes nothing', async () => {
    const w = await world()
    const other = await world()
    const foreign = await deploy(w, other.v1.id)
    expect(foreign.status).toBe(404)
    expect(foreign.body.error).toBe('version_not_found')
    t.assertContract('deploy.create', foreign)
    const random = await deploy(w, '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b')
    expect(random.status).toBe(404)
    expect(random.body.error).toBe('version_not_found')
    expect(await rows(w.project.id)).toHaveLength(0)
    expect(await activeOf(w.project.id)).toBeNull()
  })

  it('role matrix: viewer 403, non-member 404, editor and owner 200; the list is open to viewers', async () => {
    const w = await world()
    expect((await deploy(w, w.v1.id, w.viewer)).status).toBe(403)
    expect((await deploy(w, w.v1.id, w.outsider)).status).toBe(404)
    expect(await rows(w.project.id)).toHaveLength(0)
    expect((await deploy(w, w.v1.id, w.owner)).status).toBe(200)
    expect((await deploy(w, w.v2.id, w.editor)).status).toBe(200)
    expect((await history(w, '', w.viewer)).status).toBe(200)
    expect((await history(w, '', w.outsider)).status).toBe(404)
  })
})

describe('onVersionDeployed hook', () => {
  it('fires once per state-changing deploy, after commit, and not for the no-op', async () => {
    const w = await world()
    let seenActive: string | null = null
    let seenRows = 0
    const { calls, off } = listen(async (id) => {
      seenActive = await activeOf(id)
      seenRows = (await rows(id)).length
    })
    try {
      await deploy(w, w.v1.id)
      expect(calls).toEqual([w.project.id])
      expect(seenActive).toBe(w.v1.id)
      expect(seenRows).toBe(1)
      await deploy(w, w.v1.id) // no-op
      expect(calls).toHaveLength(1)
      await deploy(w, w.v2.id)
      expect(calls).toHaveLength(2)
      await deploy(w, '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b') // refused
      expect(calls).toHaveLength(2)
    } finally {
      off()
    }
  })

  it('a throwing hook does not fail the request or undo the deploy', async () => {
    const w = await world()
    const { calls, off } = listen(() => {
      throw new Error('cache exploded')
    })
    try {
      const res = await deploy(w, w.v1.id)
      expect(res.status).toBe(200)
      expect(calls).toHaveLength(1)
      expect(await activeOf(w.project.id)).toBe(w.v1.id)
      expect(await rows(w.project.id)).toHaveLength(1)
    } finally {
      off()
    }
  })
})

describe('deployments.list', () => {
  it('keeps rows after their version is deleted, with versionId null and the label intact', async () => {
    const w = await world()
    await deploy(w, w.v1.id)
    await deploy(w, w.v2.id)
    await t.db.delete(versions).where(eq(versions.id, w.v1.id))
    const res = await history(w)
    expect(res.status).toBe(200)
    t.assertContract('deployments.list', res)
    expect(res.body.items).toHaveLength(2)
    expect(res.body.items[1]).toMatchObject({ versionId: null, versionLabel: w.v1.label })
    expect(res.body.items[0]).toMatchObject({ versionId: w.v2.id })
  })

  it('paginates newest first with limit and nextCursor; a bad cursor is 400', async () => {
    const w = await world()
    const ids: string[] = []
    for (const v of [w.v1, w.v2, w.v1, w.v2, w.v1]) ids.push((await deploy(w, v.id)).body.id)
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const q: string = `?limit=2${cursor ? `&cursor=${cursor}` : ''}`
      const res = await history(w, q)
      expect(res.status).toBe(200)
      seen.push(...res.body.items.map((d: { id: string }) => d.id))
      cursor = res.body.nextCursor
      pages++
    } while (cursor)
    expect(pages).toBe(3)
    expect(seen).toEqual([...ids].reverse())
    const bad = await history(w, '?cursor=garbage')
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('invalid_cursor')
  })

  it('two simultaneous deploys of different versions: one active version, two rows, no error', async () => {
    const w = await world()
    const [a, b] = await Promise.all([deploy(w, w.v1.id), deploy(w, w.v2.id)])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    const all = await rows(w.project.id)
    expect(all).toHaveLength(2)
    const active = await activeOf(w.project.id)
    expect([w.v1.id, w.v2.id]).toContain(active)
    // Last committed wins: the newest history entry is the active version.
    const res = await history(w)
    expect(res.body.items[0].versionId).toBe(active)
  })
})
