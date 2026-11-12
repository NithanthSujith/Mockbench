// RUN-08: the request-log read side (API-CONTRACT 3.10). Reads `request_logs` only; never imports
// the data plane (the writer lives in modules/dataplane).
import type { RequestLogEntry } from '@mockbench/api-contract'
import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { requestLogs, versions } from '../../db/schema'
import { HttpError } from '../../http/errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

export interface LogFilters {
  status?: string
  method?: string
  path?: string
  since?: string
  mockError?: 'true' | 'false'
}

const view = {
  id: requestLogs.id,
  projectId: requestLogs.projectId,
  createdAt: requestLogs.createdAt,
  method: requestLogs.method,
  path: requestLogs.path,
  query: requestLogs.query,
  statusCode: requestLogs.statusCode,
  durationMs: requestLogs.durationMs,
  routePattern: requestLogs.routePattern,
  caseName: requestLogs.caseName,
  versionId: requestLogs.versionId,
  versionLabel: versions.label,
  mockError: requestLogs.mockError,
  requestHeaders: requestLogs.requestHeaders,
  ip: requestLogs.ip,
  cursorTs: sql<string>`to_char(${requestLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
}

const invalidCursor = () => new HttpError(400, 'invalid_cursor', 'The cursor is not valid.')

function decodeCursor(raw: string): { t: string; i: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw invalidCursor()
  }
  const c = parsed as { t?: unknown; i?: unknown } | null
  if (
    !c ||
    typeof c !== 'object' ||
    typeof c.t !== 'string' ||
    typeof c.i !== 'string' ||
    !CURSOR_TS.test(c.t) ||
    !UUID.test(c.i)
  ) {
    throw invalidCursor()
  }
  return { t: c.t, i: c.i }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`)

function statusCondition(status: string): SQL {
  if (status.toLowerCase().endsWith('xx')) {
    const lo = Number(status[0]) * 100
    return and(gte(requestLogs.statusCode, lo), lt(requestLogs.statusCode, lo + 100))!
  }
  return eq(requestLogs.statusCode, Number(status))
}

/** A project's request log, newest first, keyset-paginated on (created_at, id) descending. */
export async function listRequests(
  db: Db,
  projectId: string,
  filters: LogFilters,
  limit: number,
  cursor: string | undefined,
): Promise<{ items: RequestLogEntry[]; nextCursor: string | null }> {
  const after = cursor ? decodeCursor(cursor) : undefined
  const conditions: (SQL | undefined)[] = [eq(requestLogs.projectId, projectId)]
  if (filters.status) conditions.push(statusCondition(filters.status))
  if (filters.method) conditions.push(eq(requestLogs.method, filters.method.toUpperCase()))
  if (filters.path) conditions.push(ilike(requestLogs.path, `%${escapeLike(filters.path)}%`))
  if (filters.since) conditions.push(gte(requestLogs.createdAt, new Date(filters.since)))
  if (filters.mockError === 'true') conditions.push(isNotNull(requestLogs.mockError))
  if (filters.mockError === 'false') conditions.push(isNull(requestLogs.mockError))
  if (after) {
    conditions.push(
      or(
        lt(requestLogs.createdAt, sql`${after.t}::timestamptz`),
        and(eq(requestLogs.createdAt, sql`${after.t}::timestamptz`), lt(requestLogs.id, after.i)),
      ),
    )
  }
  const rows = await db
    .select(view)
    .from(requestLogs)
    .leftJoin(versions, eq(versions.id, requestLogs.versionId))
    .where(and(...conditions))
    .orderBy(desc(requestLogs.createdAt), desc(requestLogs.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor =
    rows.length > limit && last
      ? Buffer.from(JSON.stringify({ t: last.cursorTs, i: last.id }), 'utf8').toString('base64url')
      : null
  return {
    items: page.map((row) => {
      const { cursorTs, ...r } = row
      void cursorTs // only used to build the cursor
      return {
        ...r,
        createdAt: new Date(r.createdAt).toISOString(),
        query: r.query as RequestLogEntry['query'],
        requestHeaders: r.requestHeaders as RequestLogEntry['requestHeaders'],
      }
    }),
    nextCursor,
  }
}
