// Cases service (BLD-02): the database logic behind the cases.* endpoints. No HTTP in here.
// Invariants: exactly one default case per route (partial unique index + a route row lock so switches
// are serialised and a reader never sees zero or two defaults), case names unique per route
// case-insensitively (unique index on lower(name), pre-check for the friendly 409).
import type { ResponseCase } from '@mockbench/api-contract'
import { validateCaseHeaders } from '@mockbench/api-contract'
import { emptySchema, validateSchema } from '@mockbench/schema-core'
import type { MockNode } from '@mockbench/schema-core'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { projects, responseCases } from '../../db/schema'
import { HttpError } from '../../http/errors'

type CaseRow = typeof responseCases.$inferSelect

export function toCase(row: CaseRow): ResponseCase {
  return {
    id: row.id,
    routeId: row.routeId,
    name: row.name,
    statusCode: row.statusCode,
    schema: row.schema as ResponseCase['schema'],
    headers: row.headers as Record<string, string>,
    delayMs: row.delayMs,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const notFound = () => new HttpError(404, 'not_found', 'Not found.')

export async function fetchCase(db: Db, caseId: string): Promise<ResponseCase> {
  const [row] = await db.select().from(responseCases).where(eq(responseCases.id, caseId)).limit(1)
  if (!row) throw notFound()
  return toCase(row)
}

export async function listCases(db: Db, routeId: string): Promise<ResponseCase[]> {
  const rows = await db
    .select()
    .from(responseCases)
    .where(eq(responseCases.routeId, routeId))
    .orderBy(asc(responseCases.sortOrder), asc(responseCases.createdAt), asc(responseCases.id))
  return rows.map(toCase)
}

// ---------- validation ----------

interface DetailIssue {
  path: (string | number)[]
  code: string
  message: string
}

/** Headers (reserved names, formats) and schema (limits, refs resolved against the project's components). */
async function assertContentValid(
  db: Db,
  projectId: string,
  content: { headers?: Record<string, string> | undefined; schema?: unknown },
): Promise<void> {
  const issues: DetailIssue[] = []
  if (content.headers !== undefined) {
    for (const i of validateCaseHeaders(content.headers)) {
      issues.push({ path: ['headers', ...i.path], code: i.code, message: i.message })
    }
  }
  if (content.schema !== undefined) {
    const [project] = await db
      .select({ components: projects.components })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    const components = (project?.components ?? {}) as Record<string, MockNode>
    const result = validateSchema(content.schema, { components })
    if (!result.ok) {
      for (const i of result.issues) {
        issues.push({ path: ['schema', ...i.path], code: i.code, message: i.message })
      }
    }
  }
  if (issues.length > 0) {
    throw new HttpError(422, 'validation_failed', 'The case is not valid.', issues)
  }
}

// ---------- helpers ----------

const NAME_CONSTRAINT = 'response_cases_route_name_unique'

function isNameViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 5; depth++) {
    const o = e as { code?: unknown; constraint?: unknown; cause?: unknown }
    if (o.code === '23505' && o.constraint === NAME_CONSTRAINT) return true
    e = o.cause
  }
  return false
}

const nameTaken = () =>
  new HttpError(409, 'case_name_taken', 'This route already has a case with that name.')

async function nameExists(
  db: Pick<Db, 'select'>,
  routeId: string,
  name: string,
  exceptCaseId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: responseCases.id })
    .from(responseCases)
    .where(
      and(
        eq(responseCases.routeId, routeId),
        sql`lower(${responseCases.name}) = lower(${name})`,
        exceptCaseId ? ne(responseCases.id, exceptCaseId) : undefined,
      ),
    )
    .limit(1)
  return Boolean(row)
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Serialises every create / default switch / delete on one route. */
async function lockRoute(tx: Tx, routeId: string): Promise<void> {
  await tx.execute(sql`select 1 from routes where id = ${routeId} for update`)
}

// ---------- create ----------

export interface CreateCaseInput {
  name: string
  statusCode: number
  schema?: unknown
  headers?: Record<string, string> | undefined
  delayMs?: number | null | undefined
  isDefault?: boolean | undefined
}

export async function createCase(
  db: Db,
  route: { id: string; projectId: string },
  input: CreateCaseInput,
): Promise<ResponseCase> {
  await assertContentValid(db, route.projectId, input)
  try {
    const id = await db.transaction(async (tx) => {
      await lockRoute(tx, route.id)
      if (await nameExists(tx, route.id, input.name)) throw nameTaken()
      const [next] = await tx
        .select({ n: sql<number>`coalesce(max(${responseCases.sortOrder}), -1) + 1` })
        .from(responseCases)
        .where(eq(responseCases.routeId, route.id))
      // The previous default is demoted in the same transaction as the insert.
      if (input.isDefault) {
        await tx
          .update(responseCases)
          .set({ isDefault: false })
          .where(and(eq(responseCases.routeId, route.id), eq(responseCases.isDefault, true)))
      }
      const [row] = await tx
        .insert(responseCases)
        .values({
          routeId: route.id,
          name: input.name,
          statusCode: input.statusCode,
          schema: input.schema ?? emptySchema(),
          headers: input.headers ?? {},
          delayMs: input.delayMs ?? null,
          isDefault: input.isDefault === true,
          sortOrder: Number(next?.n ?? 0),
        })
        .returning({ id: responseCases.id })
      return row!.id
    })
    return await fetchCase(db, id)
  } catch (err) {
    if (isNameViolation(err)) throw nameTaken()
    throw err
  }
}

// ---------- update ----------

export interface UpdateCaseInput {
  name?: string
  statusCode?: number
  schema?: unknown
  headers?: Record<string, string>
  delayMs?: number | null
}

/** Partial update; `{}` is a no-op that leaves `updatedAt` alone (API-CONTRACT 1.5). */
export async function updateCase(
  db: Db,
  current: { id: string; routeId: string },
  projectId: string,
  input: UpdateCaseInput,
): Promise<ResponseCase> {
  const changes: Partial<typeof responseCases.$inferInsert> = {}
  if (input.name !== undefined) changes.name = input.name
  if (input.statusCode !== undefined) changes.statusCode = input.statusCode
  if (input.schema !== undefined) changes.schema = input.schema
  if (input.headers !== undefined) changes.headers = input.headers
  if (input.delayMs !== undefined) changes.delayMs = input.delayMs
  if (Object.keys(changes).length === 0) return fetchCase(db, current.id)

  await assertContentValid(db, projectId, input)
  try {
    await db.transaction(async (tx) => {
      await lockRoute(tx, current.routeId)
      if (
        input.name !== undefined &&
        (await nameExists(tx, current.routeId, input.name, current.id))
      ) {
        throw nameTaken()
      }
      const updated = await tx
        .update(responseCases)
        .set(changes)
        .where(eq(responseCases.id, current.id))
        .returning({ id: responseCases.id })
      if (updated.length === 0) throw notFound()
    })
  } catch (err) {
    if (isNameViolation(err)) throw nameTaken()
    throw err
  }
  return fetchCase(db, current.id)
}

// ---------- delete / default ----------

export async function deleteCase(db: Db, current: { id: string; routeId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    await lockRoute(tx, current.routeId)
    const [row] = await tx
      .select({ isDefault: responseCases.isDefault })
      .from(responseCases)
      .where(eq(responseCases.id, current.id))
      .limit(1)
    if (!row) return // already gone (concurrent delete)
    if (row.isDefault) {
      throw new HttpError(
        409,
        'case_is_default',
        'The default case cannot be deleted. Make another case the default first.',
      )
    }
    await tx.delete(responseCases).where(eq(responseCases.id, current.id))
  })
}

/** Demote-then-promote in one transaction under the route lock. Idempotent. */
export async function setDefaultCase(
  db: Db,
  current: { id: string; routeId: string },
): Promise<ResponseCase> {
  await db.transaction(async (tx) => {
    await lockRoute(tx, current.routeId)
    const [row] = await tx
      .select({ isDefault: responseCases.isDefault })
      .from(responseCases)
      .where(eq(responseCases.id, current.id))
      .limit(1)
    if (!row) throw notFound()
    if (row.isDefault) return
    await tx
      .update(responseCases)
      .set({ isDefault: false })
      .where(and(eq(responseCases.routeId, current.routeId), eq(responseCases.isDefault, true)))
    await tx.update(responseCases).set({ isDefault: true }).where(eq(responseCases.id, current.id))
  })
  return fetchCase(db, current.id)
}
