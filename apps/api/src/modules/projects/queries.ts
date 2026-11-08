// Read model for the Project resource (API-CONTRACT 2): one SQL statement per read, with the route and
// case counts and the active version computed in the same query (no N+1), plus opaque cursors.
import type { Project } from '@mockbench/api-contract'
import { DEFAULT_PROJECT_SETTINGS } from '@mockbench/api-contract'
import { and, asc, eq, gt, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { deployments, projects, responseCases, routes, versions } from '../../db/schema'
import { HttpError } from '../../http/errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Microsecond-precision UTC timestamp as produced by `cursorTs` below. */
const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

/** What one project read selects. Counts and the active version are scalar subqueries / a join. */
const view = {
  id: projects.id,
  workspaceId: projects.workspaceId,
  name: projects.name,
  slug: projects.slug,
  description: projects.description,
  settings: projects.settings,
  components: projects.components,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
  activeVersionId: versions.id,
  activeVersionLabel: versions.label,
  // When the active version went live: its latest deployment, else the version's own creation time.
  deployedAt: sql<Date | string | null>`coalesce(
    (select max(${deployments.createdAt}) from ${deployments}
      where ${deployments.projectId} = ${projects.id} and ${deployments.versionId} = ${projects.activeVersionId}),
    ${versions.createdAt})`,
  routeCount: sql<number>`(select count(*)::int from ${routes} where ${routes.projectId} = ${projects.id})`,
  caseCount: sql<number>`(select count(*)::int from ${responseCases}
    inner join ${routes} on ${routes.id} = ${responseCases.routeId}
    where ${routes.projectId} = ${projects.id})`,
  // Full-precision (microsecond) creation time for keyset cursors; JS Dates would truncate to ms.
  cursorTs: sql<string>`to_char(${projects.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
}

type Row = Awaited<ReturnType<typeof selectRows>>[number]

function selectRows(db: Db, where: SQL | undefined, limit?: number) {
  const q = db
    .select(view)
    .from(projects)
    .leftJoin(versions, eq(versions.id, projects.activeVersionId))
    .where(where)
    .orderBy(asc(projects.createdAt), asc(projects.id))
  return limit === undefined ? q : q.limit(limit)
}

const iso = (value: Date | string): string => new Date(value).toISOString()

export function toProject(row: Row): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...(row.settings as Partial<Project['settings']>) },
    components: row.components as Project['components'],
    activeVersion:
      row.activeVersionId && row.activeVersionLabel && row.deployedAt
        ? {
            id: row.activeVersionId,
            label: row.activeVersionLabel,
            deployedAt: iso(row.deployedAt),
          }
        : null,
    routeCount: row.routeCount,
    caseCount: row.caseCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

/** One project by id, in the Project response shape. */
export async function findProjectById(db: Db, id: string): Promise<Project | null> {
  const [row] = await selectRows(db, eq(projects.id, id), 1)
  return row ? toProject(row) : null
}

/** Same as `findProjectById` but for the by-slug lookup. */
export async function findProjectBySlug(db: Db, slug: string): Promise<Project | null> {
  const [row] = await selectRows(db, eq(projects.slug, slug), 1)
  return row ? toProject(row) : null
}

// ---------- cursors ----------

interface Cursor {
  t: string
  i: string
}

export function encodeCursor(row: Pick<Row, 'cursorTs' | 'id'>): string {
  const c: Cursor = { t: row.cursorTs, i: row.id }
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

/** Cursors are opaque to clients; anything we did not issue is `400 invalid_cursor`. */
export function decodeCursor(raw: string): Cursor {
  const bad = () => new HttpError(400, 'invalid_cursor', 'The cursor is not valid.')
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw bad()
  }
  const c = parsed as Partial<Cursor> | null
  if (
    !c ||
    typeof c !== 'object' ||
    typeof c.t !== 'string' ||
    typeof c.i !== 'string' ||
    !CURSOR_TS.test(c.t) ||
    !UUID.test(c.i)
  ) {
    throw bad()
  }
  return { t: c.t, i: c.i }
}

/** A workspace's projects, oldest first, keyset-paginated on (created_at, id). */
export async function listProjects(
  db: Db,
  workspaceId: string,
  limit: number,
  cursor: string | undefined,
): Promise<{ items: Project[]; nextCursor: string | null }> {
  const after = cursor ? decodeCursor(cursor) : undefined
  const keyset = after
    ? or(
        gt(projects.createdAt, sql`${after.t}::timestamptz`),
        and(eq(projects.createdAt, sql`${after.t}::timestamptz`), gt(projects.id, after.i)),
      )
    : undefined
  const rows = await selectRows(db, and(eq(projects.workspaceId, workspaceId), keyset), limit + 1)
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    items: page.map(toProject),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  }
}
