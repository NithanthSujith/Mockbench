// FND-11: test sessions, factories, testApp and the contract assertion.
import { exampleAuthState, exampleProject } from '@mockbench/api-contract'
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashSessionToken } from '../access/session-token'
import { loadProjectForUser } from '../access/loaders'
import { responseCases, sessions } from '../db/schema'
import type { ApiContext } from '../http/types'
import type { ModuleMap } from '../modules'
import { modules } from '../modules'
import {
  TEST_SESSION_SECRET,
  assertContract,
  createCase,
  createDeployment,
  createMember,
  createPreset,
  createProject,
  createRoute,
  createTestSession,
  createUser,
  createVersion,
  createWorkspace,
  pathFor,
  testApp,
} from './index'
import type { TestApp } from './index'

let seen: { userId: string; sessionId: string } | null | 'unset' = 'unset'

// A test-only module: one session endpoint that reports who the middleware saw, and two handlers that
// authorise through the FND-11 loaders, exactly as a real module will.
const probe = {
  system: modules.system,
  probe: {
    areas: ['auth', 'projects'],
    handlers: {
      'auth.me': async (ctx: ApiContext) => {
        seen = ctx.auth
        return { status: 200, body: exampleAuthState }
      },
      'projects.get': async (ctx: ApiContext, input: { params: { projectId: string } }) => {
        await loadProjectForUser(ctx.db, ctx.auth!.userId, input.params.projectId, 'viewer')
        return { status: 200, body: exampleProject }
      },
      'projects.delete': async (ctx: ApiContext, input: { params: { projectId: string } }) => {
        await loadProjectForUser(ctx.db, ctx.auth!.userId, input.params.projectId, 'owner')
        return { status: 204 }
      },
    },
  },
} as unknown as ModuleMap

let t: TestApp

beforeAll(async () => {
  t = await testApp({ modules: probe })
})
afterAll(() => t?.drop())

describe('hashSessionToken', () => {
  it('is deterministic for a secret and differs when the secret differs', () => {
    expect(hashSessionToken('tok', 's1')).toBe(hashSessionToken('tok', 's1'))
    expect(hashSessionToken('tok', 's1')).not.toBe(hashSessionToken('tok', 's2'))
    expect(hashSessionToken('tok', 's1')).not.toBe(hashSessionToken('tok2', 's1'))
    expect(hashSessionToken('tok', 's1')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('createTestSession', () => {
  it('returns the cookie header value and stores only the HMAC, never the raw token', async () => {
    const s = await createTestSession(t.db)
    expect(s.cookie).toBe(`mockbench_session=${s.token}`)
    expect(s.token.length).toBeGreaterThanOrEqual(43) // 32 bytes, base64url
    const [row] = await t.db.select().from(sessions).where(eq(sessions.id, s.sessionId))
    expect(row?.tokenHash).toBe(hashSessionToken(s.token, TEST_SESSION_SECRET))
    expect(row?.userId).toBe(s.userId)
    // The raw token appears in no column of any session row.
    const hits = await t.pool.query(
      `select count(*)::int as n from sessions s where s::text like '%' || $1 || '%'`,
      [s.token],
    )
    expect(hits.rows[0].n).toBe(0)
  })

  it('uses the given user, or creates one on demand', async () => {
    const u = await createUser(t.db)
    expect((await createTestSession(t.db, u.id)).userId).toBe(u.id)
    const s = await createTestSession(t.db)
    const [row] = await t.pool
      .query('select 1 from users where id = $1', [s.userId])
      .then((r) => r.rows)
    expect(row).toBeDefined()
  })

  it('expired sessions are created already expired', async () => {
    const s = await createTestSession(t.db, undefined, { expired: true })
    const [row] = await t.db.select().from(sessions).where(eq(sessions.id, s.sessionId))
    expect(row!.expiresAt.getTime()).toBeLessThan(Date.now())
  })
})

describe('sessions through the FND-10 session middleware', () => {
  it('a valid test-session cookie reaches the handler as ctx.auth = { userId, sessionId }', async () => {
    const s = await t.session()
    seen = 'unset'
    const res = await t.as(s).get('/api/v1/auth/me')
    expect(res.status).toBe(200)
    expect(seen).toEqual({ userId: s.userId, sessionId: s.sessionId })
  })

  it('a tampered cookie is 401 unauthenticated', async () => {
    const s = await t.session()
    const tampered = { cookie: s.cookie.slice(0, -1) + (s.cookie.endsWith('A') ? 'B' : 'A') }
    const res = await t.as(tampered).get('/api/v1/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthenticated')
  })

  it('an expired session row is 401', async () => {
    const s = await t.session(undefined, { expired: true })
    expect((await t.as(s).get('/api/v1/auth/me')).status).toBe(401)
  })

  it('a session hashed with a different secret is 401 (the secret is a real pepper)', async () => {
    const s = await t.session(undefined, { secret: 'some-other-secret' })
    expect((await t.as(s).get('/api/v1/auth/me')).status).toBe(401)
  })

  it('no cookie is 401', async () => {
    expect((await t.as().get('/api/v1/auth/me')).status).toBe(401)
  })
})

describe('loaders inside a real request (what a module handler does)', () => {
  it('viewer reads (200, contract-valid); outsider gets 404; editor cannot delete (403); owner can (204)', async () => {
    const ws = await t.f.createWorkspace()
    const project = await t.f.createProject({ workspaceId: ws.id })
    const viewer = await t.session()
    const editor = await t.session()
    const owner = await t.session()
    const outsider = await t.session()
    await t.f.createMember({ workspaceId: ws.id, userId: viewer.userId, role: 'viewer' })
    await t.f.createMember({ workspaceId: ws.id, userId: editor.userId, role: 'editor' })
    await t.f.createMember({ workspaceId: ws.id, userId: owner.userId, role: 'owner' })
    const get = t.pathFor('projects.get', { projectId: project.id })

    const ok = await t.as(viewer).get(get)
    expect(ok.status).toBe(200)
    t.assertContract('projects.get', ok)

    const hidden = await t.as(outsider).get(get)
    expect(hidden.status).toBe(404)
    t.assertContract('projects.get', hidden)

    const denied = await t
      .as(editor)
      .delete(t.pathFor('projects.delete', { projectId: project.id }))
    expect(denied.status).toBe(403)
    expect(denied.body.error).toBe('forbidden')
    t.assertContract('projects.delete', denied)

    const deleted = await t
      .as(owner)
      .delete(t.pathFor('projects.delete', { projectId: project.id }))
    expect(deleted.status).toBe(204)
    t.assertContract('projects.delete', deleted)
  })

  it('non-GET requests from t.as() carry the CSRF header; without it the guard answers 403 csrf_rejected', async () => {
    const s = await t.session()
    const project = await t.f.createProject()
    const path = t.pathFor('projects.delete', { projectId: project.id })
    const raw = await (
      await import('supertest')
    )
      .default(t.app)
      .delete(path)
      .set('Cookie', s.cookie)
    expect(raw.status).toBe(403)
    expect(raw.body.error).toBe('csrf_rejected')
    expect((await t.as(s).delete(path)).status).not.toBe(403) // 404: not a member, but past the CSRF guard
  })
})

describe('factories', () => {
  it('createRoute leaves the route with exactly ONE default case', async () => {
    const route = await createRoute(t.db)
    const cases = await t.db.select().from(responseCases).where(eq(responseCases.routeId, route.id))
    expect(cases).toHaveLength(1)
    expect(cases[0]).toMatchObject({ name: 'OK', statusCode: 200, isDefault: true })
  })

  it('createRoute({ withDefaultCase: false }) leaves it with none', async () => {
    const route = await createRoute(t.db, { withDefaultCase: false })
    const [row] = await t.db
      .select({ n: count() })
      .from(responseCases)
      .where(eq(responseCases.routeId, route.id))
    expect(row?.n).toBe(0)
  })

  it('createCase: on-demand route => this case is the default; given route => non-default; isDefault demotes', async () => {
    const first = await createCase(t.db)
    expect(first.isDefault).toBe(true)
    const second = await createCase(t.db, {
      routeId: first.routeId,
      statusCode: 404,
      name: 'Not found',
    })
    expect(second.isDefault).toBe(false)
    const third = await createCase(t.db, {
      routeId: first.routeId,
      name: 'New default',
      isDefault: true,
    })
    expect(third.isDefault).toBe(true)
    const all = await t.db
      .select()
      .from(responseCases)
      .where(eq(responseCases.routeId, first.routeId))
    expect(all.filter((c) => c.isDefault).map((c) => c.id)).toEqual([third.id])
    expect(all.map((c) => c.sortOrder).sort()).toEqual([0, 1, 2])
  })

  it('createProject works with no arguments; a second call in the same workspace gets a distinct slug', async () => {
    const a = await createProject(t.db)
    const b = await createProject(t.db, { workspaceId: a.workspaceId })
    expect(a.workspaceId).toBe(b.workspaceId)
    expect(a.slug).not.toBe(b.slug)
    expect(a.settings).toEqual({
      indexing: 'local',
      mode: 'deterministic',
      cors: '*',
      defaultDelayMs: 0,
    })
    expect(a.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('unique emails and slugs under parallel calls', async () => {
    const [users, workspaces, projects] = await Promise.all([
      Promise.all(Array.from({ length: 25 }, () => createUser(t.db))),
      Promise.all(Array.from({ length: 25 }, () => createWorkspace(t.db))),
      Promise.all(Array.from({ length: 25 }, () => createProject(t.db))),
    ])
    expect(new Set(users.map((u) => u.email)).size).toBe(25)
    expect(new Set(workspaces.map((w) => w.slug)).size).toBe(25)
    expect(new Set(projects.map((p) => p.slug)).size).toBe(25)
  })

  it('overrides win, and parents are created on demand', async () => {
    const preset = await createPreset(t.db, { name: 'Mine', priority: 7, isEnabled: false })
    expect(preset).toMatchObject({ name: 'Mine', priority: 7, isEnabled: false })
    const member = await createMember(t.db, { role: 'owner' })
    expect(member.role).toBe('owner')
    const route = await createRoute(t.db, { method: 'POST', path: '/x/:id' })
    expect(route).toMatchObject({ method: 'POST', path: '/x/:id', normalizedPath: '/x/{}' })
  })

  it('createVersion continues the project counter; createDeployment can make it live', async () => {
    const project = await createProject(t.db)
    const v1 = await createVersion(t.db, { projectId: project.id })
    const v2 = await createVersion(t.db, { projectId: project.id })
    expect([v1.seq, v2.seq]).toEqual([1, 2])
    expect([v1.label, v2.label]).toEqual(['v1', 'v2'])
    expect((v1.snapshot as { schemaVersion: number }).schemaVersion).toBe(1)

    const dep = await createDeployment(t.db, { projectId: project.id, versionId: v2.id })
    expect(dep).toMatchObject({ projectId: project.id, versionId: v2.id, versionLabel: 'v2' })
    const [live] = await t.pool
      .query('select active_version_id from projects where id = $1', [project.id])
      .then((r) => r.rows)
    expect(live.active_version_id).toBe(v2.id)

    const quiet = await createDeployment(t.db, {
      projectId: project.id,
      versionId: v1.id,
      activate: false,
    })
    expect(quiet.versionLabel).toBe('v1')
    const [still] = await t.pool
      .query('select active_version_id from projects where id = $1', [project.id])
      .then((r) => r.rows)
    expect(still.active_version_id).toBe(v2.id)

    const onDemand = await createDeployment(t.db)
    expect(onDemand.versionId).toBeTruthy()
  })
})

describe('assertContract and pathFor', () => {
  it('accepts a real contract-valid response and returns the parsed body', async () => {
    const res = await t.as().get('/api/v1/instance')
    expect(res.status).toBe(200)
    expect(assertContract('system.instance', res)).toMatchObject({ name: 'Mockbench' })
  })

  it('accepts documented errors: an auth 401, a global 501 and an endpoint 404', () => {
    expect(() =>
      assertContract('projects.get', {
        status: 401,
        body: { error: 'unauthenticated', message: 'x', details: [] },
      }),
    ).not.toThrow()
    expect(() =>
      assertContract('projects.get', {
        status: 501,
        body: { error: 'not_implemented', message: 'x', details: [] },
      }),
    ).not.toThrow()
    expect(() =>
      assertContract('versions.publish', {
        status: 409,
        body: { error: 'label_taken', message: 'x', details: [] },
      }),
    ).not.toThrow()
  })

  it('rejects a body that does not match the success schema', () => {
    expect(() => assertContract('system.instance', { status: 200, body: { nope: true } })).toThrow(
      /does not match the contract schema/,
    )
  })

  it('rejects an undocumented error code, an undocumented status and a non-envelope error body', () => {
    expect(() =>
      assertContract('projects.get', {
        status: 404,
        body: { error: 'made_up_code', message: 'x', details: [] },
      }),
    ).toThrow(/not documented/)
    expect(() =>
      assertContract('versions.publish', {
        status: 409,
        body: { error: 'not_a_conflict_code', message: 'x', details: [] },
      }),
    ).toThrow(/not documented/)
    expect(() =>
      assertContract('projects.get', { status: 418, body: { hello: 'teapot' } }),
    ).toThrow(/not the error envelope/)
    // viewer-level endpoints never produce 403 forbidden by the legend
    expect(() =>
      assertContract('projects.get', {
        status: 403,
        body: { error: 'forbidden', message: 'x', details: [] },
      }),
    ).toThrow(/not documented/)
  })

  it('a 204 must have an empty body', () => {
    expect(() =>
      assertContract('projects.delete', { status: 204, body: {}, text: '' }),
    ).not.toThrow()
    expect(() =>
      assertContract('projects.delete', { status: 204, body: {}, text: 'oops' }),
    ).toThrow(/empty body/)
  })

  it('pathFor fills params and refuses a missing one', () => {
    expect(pathFor('projects.get', { projectId: 'abc' })).toBe('/api/v1/projects/abc')
    expect(pathFor('system.instance')).toBe('/api/v1/instance')
    expect(() => pathFor('projects.get')).toThrow(/missing param "projectId"/)
  })
})
