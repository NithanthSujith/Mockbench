// RUN-03: deploy / rollback and the deployment history (API-CONTRACT 3.9). A deploy is one
// transaction under a row lock on the project; the cache hook runs only after it commits.
import type { Deployment } from '@mockbench/api-contract'
import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { deployments, projects, users, versions } from '../../db/schema'
import { HttpError } from '../../http/errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

const view = {
  id: deployments.id,
  projectId: deployments.projectId,
  versionId: deployments.versionId,
  versionLabel: deployments.versionLabel,
  createdAt: deployments.createdAt,
  userId: users.id,
  userName: users.name,
  cursorTs: sql<string>`to_char(${deployments.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
}

type Row = {
  id: string
  projectId: string
  versionId: string | null
  versionLabel: string
  createdAt: Date | string
  userId: string | null
  userName: string | null
}

function toDeployment(row: Row): Deployment {
  return {
    id: row.id,
    projectId: row.projectId,
    versionId: row.versionId,
    versionLabel: row.versionLabel,
    deployedAt: new Date(row.createdAt).toISOString(),
    deployedBy: row.userId ? { id: row.userId, name: row.userName ?? '' } : null,
  }
}

function select(db: Pick<Db, 'select'>, where: SQL | undefined) {
  return db
    .select(view)
    .from(deployments)
    .leftJoin(users, eq(users.id, deployments.deployedBy))
    .where(where)
}

const newestFirst = [desc(deployments.createdAt), desc(deployments.id)] as const

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

/** A project's deployments, newest first, keyset-paginated on (created_at, id) descending. */
export async function listDeployments(
  db: Db,
  projectId: string,
  limit: number,
  cursor: string | undefined,
): Promise<{ items: Deployment[]; nextCursor: string | null }> {
  const after = cursor ? decodeCursor(cursor) : undefined
  const keyset = after
    ? or(
        lt(deployments.createdAt, sql`${after.t}::timestamptz`),
        and(eq(deployments.createdAt, sql`${after.t}::timestamptz`), lt(deployments.id, after.i)),
      )
    : undefined
  const rows = await select(db, and(eq(deployments.projectId, projectId), keyset))
    .orderBy(...newestFirst)
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor =
    rows.length > limit && last
      ? Buffer.from(JSON.stringify({ t: last.cursorTs, i: last.id }), 'utf8').toString('base64url')
      : null
  return { items: page.map(toDeployment), nextCursor }
}

const versionNotFound = () =>
  new HttpError(404, 'version_not_found', 'That version does not exist in this project.')

/**
 * Makes `versionId` the project's live version. Returns the deployment and whether state changed
 * (false for the already-active no-op, which must not fire the cache hook).
 */
export async function deployVersion(
  db: Db,
  projectId: string,
  userId: string | null,
  versionId: string,
): Promise<{ deployment: Deployment; changed: boolean }> {
  const result = await db.transaction(async (tx) => {
    // Serialises concurrent deploys (and the active-version check) for this project.
    const [project] = await tx
      .select({ active: projects.activeVersionId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update')
    if (!project) throw versionNotFound()
    const [version] = await tx
      .select({ id: versions.id, label: versions.label })
      .from(versions)
      .where(and(eq(versions.id, versionId), eq(versions.projectId, projectId)))
    if (!version) throw versionNotFound()

    if (project.active === version.id) {
      const [latest] = await select(tx, eq(deployments.projectId, projectId))
        .orderBy(...newestFirst)
        .limit(1)
      if (latest) return { id: latest.id, changed: false }
    }
    await tx.update(projects).set({ activeVersionId: version.id }).where(eq(projects.id, projectId))
    const [row] = await tx
      .insert(deployments)
      .values({
        projectId,
        versionId: version.id,
        versionLabel: version.label,
        deployedBy: userId,
        // now() is the transaction start; the lock may have made this one wait, so stamp the
        // moment the history entry is written to keep history order equal to commit order.
        createdAt: sql`clock_timestamp()`,
      })
      .returning({ id: deployments.id })
    return { id: row!.id, changed: true }
  })
  const [row] = await select(db, eq(deployments.id, result.id)).limit(1)
  return { deployment: toDeployment(row!), changed: result.changed }
}
