// RUN-02: database logic for the version resource (API-CONTRACT 3.9). Publish is one transaction;
// the read model never selects `baked`, and selects `snapshot` only for a single-version read.
import type { Version, VersionSummary } from '@mockbench/api-contract'
import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { projects, requestLogs, users, versions } from '../../db/schema'
import { HttpError } from '../../http/errors'
import {
  buildVersionPayload,
  EmptyProjectError,
  ProjectNotFoundError,
  PublishInvalidError,
} from './snapshot'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

const summaryView = {
  id: versions.id,
  projectId: versions.projectId,
  seq: versions.seq,
  label: versions.label,
  notes: versions.notes,
  createdAt: versions.createdAt,
  routeCount: versions.routeCount,
  caseCount: versions.caseCount,
  bakedBytes: versions.bakedBytes,
  creatorId: users.id,
  creatorName: users.name,
  isActive: sql<boolean | null>`(${projects.activeVersionId} = ${versions.id})`,
  // Full-precision (microsecond) creation time for keyset cursors; JS Dates would truncate to ms.
  cursorTs: sql<string>`to_char(${versions.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
}

type SummaryRow = {
  id: string
  projectId: string
  seq: number
  label: string
  notes: string | null
  createdAt: Date | string
  routeCount: number
  caseCount: number
  bakedBytes: number
  creatorId: string | null
  creatorName: string | null
  isActive: boolean | null
}

const iso = (v: Date | string) => new Date(v).toISOString()

function toSummary(row: SummaryRow): VersionSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    seq: row.seq,
    label: row.label,
    notes: row.notes,
    createdBy: row.creatorId ? { id: row.creatorId, name: row.creatorName ?? '' } : null,
    createdAt: iso(row.createdAt),
    routeCount: row.routeCount,
    caseCount: row.caseCount,
    bakedBytes: row.bakedBytes,
    isActive: row.isActive === true,
  }
}

function selectSummaries(db: Db, where: SQL | undefined) {
  return db
    .select(summaryView)
    .from(versions)
    .innerJoin(projects, eq(projects.id, versions.projectId))
    .leftJoin(users, eq(users.id, versions.createdBy))
    .where(where)
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

/** A project's versions, newest first, keyset-paginated on (created_at, id) descending. */
export async function listVersions(
  db: Db,
  projectId: string,
  limit: number,
  cursor: string | undefined,
): Promise<{ items: VersionSummary[]; nextCursor: string | null }> {
  const after = cursor ? decodeCursor(cursor) : undefined
  const keyset = after
    ? or(
        lt(versions.createdAt, sql`${after.t}::timestamptz`),
        and(eq(versions.createdAt, sql`${after.t}::timestamptz`), lt(versions.id, after.i)),
      )
    : undefined
  const rows = await selectSummaries(db, and(eq(versions.projectId, projectId), keyset))
    .orderBy(desc(versions.createdAt), desc(versions.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor =
    rows.length > limit && last
      ? Buffer.from(JSON.stringify({ t: last.cursorTs, i: last.id }), 'utf8').toString('base64url')
      : null
  return { items: page.map(toSummary), nextCursor }
}

/** One version with its snapshot (never `baked`). */
export async function fetchVersion(db: Db, id: string): Promise<Version> {
  const [row] = await selectSummaries(db, eq(versions.id, id)).limit(1)
  const [snap] = await db
    .select({ snapshot: versions.snapshot })
    .from(versions)
    .where(eq(versions.id, id))
    .limit(1)
  if (!row || !snap) throw new HttpError(404, 'not_found', 'Not found.')
  return { ...toSummary(row), snapshot: snap.snapshot as Version['snapshot'] }
}

function pgError(err: unknown): { code?: string; constraint?: string } {
  let e = err as { code?: string; constraint?: string; cause?: unknown } | null | undefined
  while (e) {
    if (e.code) return { code: e.code, constraint: e.constraint }
    e = e.cause as typeof e
  }
  return {}
}

const MAX_ATTEMPTS = 8

/**
 * Publishes the draft as a new version, all or nothing. The transaction runs at REPEATABLE READ
 * (RUN-01 note) so the snapshot has one stable view; a concurrent publish then loses the row lock
 * with SQLSTATE 40001, and the whole transaction is retried.
 */
export async function publishVersion(
  db: Db,
  projectId: string,
  userId: string,
  input: { label?: string; notes?: string },
): Promise<Version> {
  for (let attempt = 1; ; attempt++) {
    try {
      const id = await db.transaction(
        async (tx) => {
          const [locked] = await tx
            .select({ seq: projects.versionSeq })
            .from(projects)
            .where(eq(projects.id, projectId))
            .for('update')
          if (!locked) throw new ProjectNotFoundError(projectId)
          const payload = await buildVersionPayload(tx, projectId)
          const seq = locked.seq + 1
          const [row] = await tx
            .insert(versions)
            .values({
              projectId,
              seq,
              label: input.label ?? `v${seq}`,
              notes: input.notes ?? null,
              snapshot: payload.snapshot,
              baked: payload.baked,
              routeCount: payload.routeCount,
              caseCount: payload.caseCount,
              snapshotBytes: payload.snapshotBytes,
              bakedBytes: payload.bakedBytes,
              createdBy: userId,
            })
            .returning({ id: versions.id })
          await tx.update(projects).set({ versionSeq: seq }).where(eq(projects.id, projectId))
          return row!.id
        },
        { isolationLevel: 'repeatable read' },
      )
      return await fetchVersion(db, id)
    } catch (err) {
      if (err instanceof EmptyProjectError) {
        throw new HttpError(422, 'empty_project', 'The project has no routes to publish.')
      }
      if (err instanceof PublishInvalidError) {
        throw new HttpError(
          422,
          'publish_invalid',
          'Some response cases are invalid; nothing was published.',
          err.details,
        )
      }
      if (err instanceof ProjectNotFoundError) throw new HttpError(404, 'not_found', 'Not found.')
      const pg = pgError(err)
      if (pg.code === '23505' && pg.constraint === 'versions_project_label_unique') {
        throw new HttpError(409, 'label_taken', 'A version with that label already exists.')
      }
      if (pg.code === '40001' && attempt < MAX_ATTEMPTS) continue
      throw err
    }
  }
}

/** Deletes an inactive, unreferenced version. */
export async function deleteVersion(db: Db, id: string): Promise<void> {
  const referenced = () =>
    new HttpError(409, 'version_referenced', 'Retained request logs still reference this version.')
  const [active] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.activeVersionId, id))
    .limit(1)
  if (active) throw new HttpError(409, 'version_active', 'The active version cannot be deleted.')
  const [ref] = await db
    .select({ id: requestLogs.id })
    .from(requestLogs)
    .where(eq(requestLogs.versionId, id))
    .limit(1)
  if (ref) throw referenced()
  try {
    await db.delete(versions).where(eq(versions.id, id))
  } catch (err) {
    // A log row landed between the check and the delete: the FK (RESTRICT) refuses.
    if (pgError(err).code === '23503') throw referenced()
    throw err
  }
}
