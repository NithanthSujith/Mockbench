// RUN-07: one test (or table) per acceptance criterion in docs/specs/RUN-07-request-log-writer.md.
import { randomUUID } from 'node:crypto'
import { DEFAULT_PROJECT_SETTINGS } from '@mockbench/api-contract'
import type { ProjectSettings, Snapshot } from '@mockbench/api-contract'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { Db } from '../../db/client'
import { projects, requestLogs, versions } from '../../db/schema'
import { testApp } from '../../testing'
import type { TestApp } from '../../testing'
import {
  createRequestLogWriter,
  redactHeaders,
  redactQuery,
  startRequestLogPruner,
} from './request-log'
import type { RequestLogInput, RequestLogWriter } from './request-log'

// ---------------------------------------------------------------------------------------------------
// Unit tests: a fake Db and fake timers (no real waiting).

const entry = (over: Partial<RequestLogInput> = {}): RequestLogInput => ({
  projectId: randomUUID(),
  method: 'GET',
  path: '/users',
  query: {},
  statusCode: 200,
  durationMs: 2,
  routePattern: 'GET /users',
  caseName: 'OK',
  versionId: randomUUID(),
  versionLabel: 'v1',
  mockError: null,
  requestHeaders: {},
  ip: '10.0.0.5',
  ...over,
})

type Row = typeof requestLogs.$inferInsert
function fakeDb() {
  const state = { down: false, statements: 0, rows: [] as Row[] }
  const db = {
    insert: () => ({
      values: async (v: Row | Row[]) => {
        state.statements++
        if (state.down) throw new Error('connection refused')
        state.rows.push(...(Array.isArray(v) ? v : [v]))
      },
    }),
  } as unknown as Db
  return { db, state }
}

function logger() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
}

describe('redaction and truncation', () => {
  it.each([
    ['Authorization', 'Bearer abc'],
    ['authorization', 'x'],
    ['Proxy-Authorization', 'x'],
    ['Cookie', 's=1'],
    ['Set-Cookie', 's=1'],
    ['X-Api-Key', 'k'],
    ['X-Auth-Token', 't'],
  ])('redacts %s', (name, value) => {
    expect(redactHeaders({ [name]: value, accept: 'application/json' })).toEqual({
      [name]: '[redacted]',
      accept: 'application/json',
    })
  })

  it('truncates header values to 1,000 chars, keeps at most 50 headers', () => {
    const out = redactHeaders({ 'x-big': 'a'.repeat(5000) })
    expect(out['x-big']).toHaveLength(1000)
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`h${i}`, 'v']))
    expect(Object.keys(redactHeaders(many))).toHaveLength(50)
  })

  it('redacts query values named token/key/password and strips NUL', () => {
    expect(
      redactQuery({ Token: 'abc', key: ['a', 'b'], password: 'p', q: 'a\u0000b', n: 'ok' }),
    ).toEqual({
      Token: '[redacted]',
      key: ['[redacted]', '[redacted]'],
      password: '[redacted]',
      q: 'ab',
      n: 'ok',
    })
  })

  it('truncates the stored path to 2,000 chars', async () => {
    const { db, state } = fakeDb()
    const w = createRequestLogWriter({ db })
    w.record(entry({ path: '/' + 'p'.repeat(5000) }))
    await w.flush()
    expect(state.rows[0]!.path).toHaveLength(2000)
  })
})

describe('writer', () => {
  afterEach(() => vi.useRealTimers())

  it('writes 250 ms after the first entry, not before', async () => {
    vi.useFakeTimers()
    const { db, state } = fakeDb()
    const w = createRequestLogWriter({ db })
    w.record(entry())
    await vi.advanceTimersByTimeAsync(249)
    expect(state.statements).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]).toMatchObject({
      method: 'GET',
      path: '/users',
      statusCode: 200,
      ip: '10.0.0.5',
    })
  })

  it('1,000 requests in a second produce <= 20 insert statements and every row', async () => {
    vi.useFakeTimers()
    const { db, state } = fakeDb()
    const w = createRequestLogWriter({ db })
    for (let s = 0; s < 10; s++) {
      for (let i = 0; i < 100; i++) w.record(entry())
      await vi.advanceTimersByTimeAsync(100)
    }
    await vi.advanceTimersByTimeAsync(300)
    expect(state.rows).toHaveLength(1000)
    expect(state.statements).toBeLessThanOrEqual(20)
    expect(w.size()).toBe(0)
  })

  it('with the database down: bounded at 10,000, drops the oldest, warns once, writes on recovery', async () => {
    vi.useFakeTimers()
    const { db, state } = fakeDb()
    const log = logger()
    const w = createRequestLogWriter({ db, logger: log })
    state.down = true
    for (let i = 0; i < 10_001; i++) w.record(entry({ path: `/p${i}` }))
    expect(() => w.record(entry({ path: '/p10001' }))).not.toThrow()
    await vi.advanceTimersByTimeAsync(3000)
    expect(w.size()).toBe(10_000)
    expect(w.dropped()).toBe(2) // 10,002 recorded, 10,000 kept
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]![0]).toMatchObject({ maxQueue: 10_000 })

    state.down = false
    await vi.advanceTimersByTimeAsync(2000)
    expect(w.size()).toBe(0)
    expect(state.rows).toHaveLength(10_000)
    expect(state.rows[0]!.path).toBe('/p2') // /p0 and /p1 were the oldest, dropped
    expect(state.rows.at(-1)!.path).toBe('/p10001')
  })

  it('flushes pending entries on stop (SIGTERM shutdown)', async () => {
    vi.useFakeTimers()
    const { db, state } = fakeDb()
    const w = createRequestLogWriter({ db })
    for (let i = 0; i < 7; i++) w.record(entry())
    await w.stop()
    expect(state.rows).toHaveLength(7)
    w.record(entry())
    expect(w.size()).toBe(0)
  })

  it('record never throws, even for a malformed entry', () => {
    const { db } = fakeDb()
    const w = createRequestLogWriter({ db, logger: logger() })
    expect(() => w.record(null as unknown as RequestLogInput)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------------------------------
// Integration: real Postgres.

let t: TestApp
let writer: RequestLogWriter
let stalled = false
beforeAll(async () => {
  // The app is built before the writer (it needs t.db), so the router calls through this proxy.
  t = await testApp({
    deps: {
      requestLog: {
        record: (e) => {
          if (stalled) stalledWriter.record(e)
          else writer.record(e)
        },
      },
    },
  })
  writer = createRequestLogWriter({ db: t.db, logger: logger() })
})
afterAll(async () => {
  await writer.stop()
  await t.drop()
})

// A writer whose database never answers (the "DB paused" case).
const stalledWriter = createRequestLogWriter({
  db: { insert: () => ({ values: () => new Promise(() => {}) }) } as unknown as Db,
})

const UUID_ROUTE = randomUUID()
const UUID_CASE = randomUUID()

async function publish() {
  const ws = await t.f.createWorkspace()
  const project = await t.f.createProject({ workspaceId: ws.id })
  const settings = { ...DEFAULT_PROJECT_SETTINGS } as ProjectSettings
  const snapshot: Snapshot = {
    schemaVersion: 1,
    generatorVersion: 1,
    project: { id: project.id, slug: project.slug, settings, components: {} },
    routes: [
      {
        id: UUID_ROUTE,
        method: 'GET',
        path: '/users',
        description: null,
        cases: [
          {
            id: UUID_CASE,
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
  const baked = JSON.stringify({ [`${UUID_ROUTE}:${UUID_CASE}`]: '{}' })
  const v = await t.f.createVersion({
    projectId: project.id,
    snapshot,
    baked,
    bakedBytes: baked.length,
  })
  await t.f.createDeployment({ projectId: project.id, versionId: v.id })
  return { project, slug: project.slug, version: v }
}

const rowsOf = (projectId: string) =>
  t.db.select().from(requestLogs).where(eq(requestLogs.projectId, projectId))

describe('integration', () => {
  it('a mock request produces exactly one row with every field, redacted headers, after the response', async () => {
    const { project, slug, version } = await publish()
    const res = await request(t.app)
      .get(`/mock/${slug}/users?token=abc&n=1`)
      .set('Authorization', 'Bearer abc')
      .set('Cookie', 's=1')
      .set('X-Api-Key', 'k')
      .set('X-Big', 'z'.repeat(5000))
      .set('X-Other', 'kept')
    expect(res.status).toBe(200)
    await writer.flush()
    const rows = await rowsOf(project.id)
    expect(rows).toHaveLength(1)
    const r = rows[0]!
    expect(r).toMatchObject({
      method: 'GET',
      path: '/users',
      statusCode: 200,
      routePattern: 'GET /users',
      caseName: 'OK',
      versionId: version.id,
      matchedRouteId: UUID_ROUTE,
      matchedCaseId: UUID_CASE,
      mockError: null,
      query: { token: '[redacted]', n: '1' },
    })
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
    expect(r.ip).toBeTruthy()
    const h = r.requestHeaders as Record<string, string>
    expect(h.authorization).toBe('[redacted]')
    expect(h.cookie).toBe('[redacted]')
    expect(h['x-api-key']).toBe('[redacted]')
    expect(h['x-other']).toBe('kept')
    expect(h['x-big']).toHaveLength(1000)
  })

  it('mock errors store mock_error and null matched ids', async () => {
    const { project, slug } = await publish()
    await request(t.app).get(`/mock/${slug}/nope`)
    await request(t.app).get(`/mock/${slug}/users`).set('X-Mock-Case', 'missing')
    const unpublished = await t.f.createProject({ workspaceId: project.workspaceId })
    await request(t.app).get(`/mock/${unpublished.slug}/users`)
    await writer.flush()
    const rows = [...(await rowsOf(project.id)), ...(await rowsOf(unpublished.id))]
    expect(rows.map((r) => r.mockError).sort()).toEqual([
      'case_not_found',
      'project_not_published',
      'route_not_found',
    ])
    for (const r of rows) {
      expect(r.matchedRouteId).toBeNull()
      expect(r.matchedCaseId).toBeNull()
    }
  })

  it('unknown-slug requests create no row and no error', async () => {
    const before = (await t.db.select().from(requestLogs)).length
    const res = await request(t.app).get('/mock/no-such-slug-zz/users')
    expect(res.status).toBe(404)
    await writer.flush()
    expect((await t.db.select().from(requestLogs)).length).toBe(before)
  })

  it('responses do not wait for the database', async () => {
    const { slug } = await publish()
    stalled = true
    try {
      const res = await request(t.app).get(`/mock/${slug}/users`)
      expect(res.status).toBe(200)
      expect(stalledWriter.size()).toBeGreaterThan(0)
    } finally {
      stalled = false
    }
  })
})

describe('pruner', () => {
  const DAY = 86_400_000
  const seed = async (projectId: string, n: number, ageMs: (i: number) => number) => {
    const base = Date.now()
    await t.db.insert(requestLogs).values(
      Array.from({ length: n }, (_, i) => ({
        projectId,
        method: 'GET',
        path: `/r${i}`,
        statusCode: 200,
        durationMs: 1,
        createdAt: new Date(base - ageMs(i)),
      })),
    )
  }

  it('deletes rows older than LOG_RETENTION_DAYS and keeps newer ones', async () => {
    const p = await t.f.createProject()
    await seed(p.id, 3, () => 8 * DAY)
    await seed(p.id, 2, () => 6 * DAY)
    const pruner = startRequestLogPruner({
      db: t.db,
      retentionDays: 7,
      retentionRows: 1000,
      intervalMs: 1e9,
    })
    pruner.stop()
    await pruner.ready
    expect(await rowsOf(p.id)).toHaveLength(2)
  })

  it('keeps the newest LOG_RETENTION_ROWS per project, independently', async () => {
    const a = await t.f.createProject()
    const b = await t.f.createProject()
    await seed(a.id, 1500, (i) => (1500 - i) * 1000) // path /r1499 is the newest
    await seed(b.id, 10, (i) => i * 1000)
    const pruner = startRequestLogPruner({
      db: t.db,
      retentionDays: 7,
      retentionRows: 1000,
      intervalMs: 1e9,
    })
    pruner.stop()
    await pruner.ready
    const ra = await rowsOf(a.id)
    expect(ra).toHaveLength(1000)
    expect(ra.some((r) => r.path === '/r1499')).toBe(true)
    expect(ra.some((r) => r.path === '/r0')).toBe(false)
    expect(await rowsOf(b.id)).toHaveLength(10)
  })

  it('runs once at startup, every 10 minutes, and skips an overlapping run', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      const db = {
        delete: () => ({
          where: () => ({
            returning: async () => {
              calls++
              await gate
              return []
            },
          }),
        }),
        execute: async () => ({ rowCount: 0 }),
      } as unknown as Db
      const pruner = startRequestLogPruner({ db, retentionDays: 7, retentionRows: 10 })
      expect(calls).toBe(1) // at startup
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      expect(calls).toBe(1) // still running: the 10-minute tick was skipped
      expect(await pruner.run()).toBeNull()
      release()
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      expect(calls).toBe(2)
      pruner.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a version referenced by retained rows cannot be deleted; once pruned it can', async () => {
    const ws = await t.f.createWorkspace()
    const member = await t.f.createMember({ workspaceId: ws.id, role: 'editor' })
    const session = await t.session(member.userId)
    const project = await t.f.createProject({ workspaceId: ws.id })
    const v1 = await t.f.createVersion({ projectId: project.id })
    const v2 = await t.f.createVersion({ projectId: project.id })
    await t.f.createDeployment({ projectId: project.id, versionId: v2.id })
    await t.db.insert(requestLogs).values({
      projectId: project.id,
      versionId: v1.id,
      method: 'GET',
      path: '/x',
      statusCode: 200,
      durationMs: 1,
      createdAt: new Date(Date.now() - 8 * DAY),
    })
    const blocked = await t.as(session).delete(`/api/v1/versions/${v1.id}`)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error).toBe('version_referenced')

    const pruner = startRequestLogPruner({
      db: t.db,
      retentionDays: 7,
      retentionRows: 1000,
      intervalMs: 1e9,
    })
    pruner.stop()
    await pruner.ready
    expect((await t.as(session).delete(`/api/v1/versions/${v1.id}`)).status).toBe(204)
    expect(await t.db.select().from(versions).where(eq(versions.id, v1.id))).toHaveLength(0)
    expect(await t.db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(1)
  })
})
