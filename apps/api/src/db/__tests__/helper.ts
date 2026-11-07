// Row factories + SQLSTATE helpers for the FND-08 constraint tests, built on the official FND-09
// harness (withTestDb). FND-11 will supersede the factories with the shared ones.
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'
import { withTestDb } from '../testing'

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))

export type TestDb = Awaited<ReturnType<typeof testDb>>

export async function testDb(opts: { migrate?: boolean } = {}) {
  const base = await withTestDb(opts)
  const { name, url, db, pool } = base

  let n = 0
  const uniq = (p: string) => `${p}${++n}${randomBytes(2).toString('hex')}`
  const q = pool.query.bind(pool) as pg.Pool['query']

  async function one<T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T> {
    const r = await pool.query(text, params)
    return r.rows[0] as T
  }

  const make = {
    async user(over: { email?: string; name?: string } = {}) {
      const r = await one<{ id: string }>(
        `INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', $2) RETURNING id`,
        [over.email ?? `${uniq('u')}@example.com`, over.name ?? 'User'],
      )
      return r.id
    },
    async workspace(slug?: string) {
      const r = await one<{ id: string }>(
        `INSERT INTO workspaces (name, slug) VALUES ('W', $1) RETURNING id`,
        [slug ?? uniq('ws')],
      )
      return r.id
    },
    async project(over: { workspaceId?: string; slug?: string } = {}) {
      const workspaceId = over.workspaceId ?? (await make.workspace())
      const r = await one<{ id: string }>(
        `INSERT INTO projects (workspace_id, name, slug) VALUES ($1, 'P', $2) RETURNING id`,
        [workspaceId, over.slug ?? uniq('proj')],
      )
      return r.id
    },
    async route(over: { projectId?: string; method?: string; path?: string } = {}) {
      const projectId = over.projectId ?? (await make.project())
      const r = await one<{ id: string }>(
        `INSERT INTO routes (project_id, method, path) VALUES ($1, $2, $3) RETURNING id`,
        [projectId, over.method ?? 'GET', over.path ?? `/${uniq('r')}`],
      )
      return r.id
    },
    async kase(
      over: {
        routeId?: string
        name?: string
        statusCode?: number
        delayMs?: number | null
        isDefault?: boolean
      } = {},
    ) {
      const routeId = over.routeId ?? (await make.route())
      const r = await one<{ id: string }>(
        `INSERT INTO response_cases (route_id, name, status_code, schema, delay_ms, is_default)
         VALUES ($1, $2, $3, '{"version":1,"components":{},"root":{"type":"object","fields":[]}}', $4, $5)
         RETURNING id`,
        [
          routeId,
          over.name ?? uniq('case'),
          over.statusCode ?? 200,
          over.delayMs ?? null,
          over.isDefault ?? false,
        ],
      )
      return r.id
    },
    async version(
      over: { projectId?: string; seq?: number; label?: string; createdBy?: string } = {},
    ) {
      const projectId = over.projectId ?? (await make.project())
      const seq = over.seq ?? 1
      const r = await one<{ id: string }>(
        `INSERT INTO versions (project_id, seq, label, snapshot, route_count, case_count, snapshot_bytes, created_by)
         VALUES ($1, $2, $3, '{}', 0, 0, 2, $4) RETURNING id`,
        [projectId, seq, over.label ?? `v${seq}`, over.createdBy ?? null],
      )
      return r.id
    },
  }

  return { name, url, db, pool, q, one, make, uniq, drop: base.drop }
}

/** Resolves with the Postgres error code (SQLSTATE) the promise rejects with; fails if it resolves. */
export async function pgErrorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } }
    const code = err.code ?? err.cause?.code
    if (code) return code
    throw e
  }
  throw new Error('expected a Postgres error but the statement succeeded')
}

export const UNIQUE_VIOLATION = '23505'
export const FK_VIOLATION = '23503'
export const CHECK_VIOLATION = '23514'
export const RESTRICT_VIOLATION = '23001'
