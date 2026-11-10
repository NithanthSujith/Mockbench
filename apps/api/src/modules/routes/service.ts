// Routes service (BLD-01): the database logic behind the routes.* endpoints. No HTTP in here, so it
// can be tested directly (including with a query counter) and reused by the Builder's other units.
import { normalizePath, parseRoutePath } from '@mockbench/api-contract'
import type { CaseSummary, Route } from '@mockbench/api-contract'
import { emptySchema } from '@mockbench/schema-core'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { responseCases, routes } from '../../db/schema'
import { HttpError } from '../../http/errors'

type Method = Route['method']

/**
 * The cases summaries of a route as ONE correlated subquery (the outer id is qualified by hand: Drizzle renders
 * a bare column in a single-table select as an unqualified "id", which would bind to the inner table), so a route (or a whole project's routes)
 * is a single statement with no N+1. Ordered like the editor's case tabs: sortOrder, then creation.
 */
const CASES_JSON = sql<CaseSummary[]>`coalesce((
  select json_agg(
    json_build_object('id', c.id, 'name', c.name, 'statusCode', c.status_code, 'isDefault', c.is_default)
    order by c.sort_order, c.created_at, c.id)
  from response_cases c where c.route_id = ${sql.identifier('routes')}.${sql.identifier('id')}
), '[]'::json)`

const routeColumns = {
  id: routes.id,
  projectId: routes.projectId,
  method: routes.method,
  path: routes.path,
  description: routes.description,
  createdAt: routes.createdAt,
  updatedAt: routes.updatedAt,
  cases: CASES_JSON,
}

type RouteRow = {
  id: string
  projectId: string
  method: string
  path: string
  description: string | null
  createdAt: Date
  updatedAt: Date
  cases: CaseSummary[]
}

function toRoute(row: RouteRow): Route {
  return {
    id: row.id,
    projectId: row.projectId,
    method: row.method as Method,
    path: row.path,
    description: row.description,
    cases: row.cases,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** One route with its case summaries, or 404. */
export async function fetchRoute(db: Db, routeId: string): Promise<Route> {
  const [row] = await db.select(routeColumns).from(routes).where(eq(routes.id, routeId)).limit(1)
  if (!row) throw new HttpError(404, 'not_found', 'Not found.')
  return toRoute(row)
}

/** Every route of a project in creation order, each with its case summaries. One statement. */
export async function listRoutes(db: Db, projectId: string): Promise<Route[]> {
  const rows = await db
    .select(routeColumns)
    .from(routes)
    .where(eq(routes.projectId, projectId))
    .orderBy(asc(routes.sortOrder), asc(routes.createdAt), asc(routes.id))
  return rows.map(toRoute)
}

// ---------- collisions ----------

const UNIQUE_CONSTRAINT = 'routes_project_method_normalized_unique'

/** Walks the `cause` chain: Drizzle wraps the driver error, and the driver error carries the code. */
function isRouteUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === 'object' && depth < 5; depth++) {
    const o = e as { code?: unknown; constraint?: unknown; cause?: unknown }
    if (o.code === '23505' && o.constraint === UNIQUE_CONSTRAINT) return true
    e = o.cause
  }
  return false
}

async function findCollision(
  db: Db,
  projectId: string,
  method: string,
  path: string,
  exceptRouteId?: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: routes.id })
    .from(routes)
    .where(
      and(
        eq(routes.projectId, projectId),
        eq(routes.method, method),
        eq(routes.normalizedPath, normalizePath(path)),
        exceptRouteId ? ne(routes.id, exceptRouteId) : undefined,
      ),
    )
    .limit(1)
  return row?.id
}

function conflict(method: string, existingRouteId: string | undefined): HttpError {
  return new HttpError(
    409,
    'route_conflict',
    `A ${method} route with this path already exists in the project.`,
    existingRouteId ? [{ routeId: existingRouteId }] : [],
  )
}

async function nextSortOrder(tx: Pick<Db, 'select'>, projectId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(${routes.sortOrder}), -1) + 1` })
    .from(routes)
    .where(eq(routes.projectId, projectId))
  return Number(row?.n ?? 0)
}

// ---------- create ----------

export interface CreateRouteInput {
  method: Method
  path: string
  description?: string | undefined
}

/**
 * Creates the route and its default case "OK" (200, empty-object schema) in ONE transaction, so a
 * route can never exist without its default case. A collision is reported as 409 whether it was
 * caught by the pre-check or by the unique constraint (two simultaneous creates).
 */
export async function createRoute(
  db: Db,
  projectId: string,
  input: CreateRouteInput,
): Promise<Route> {
  const existing = await findCollision(db, projectId, input.method, input.path)
  if (existing) throw conflict(input.method, existing)

  try {
    const routeId = await db.transaction(async (tx) => {
      const [route] = await tx
        .insert(routes)
        .values({
          projectId,
          method: input.method,
          path: input.path,
          description: input.description ?? null,
          sortOrder: await nextSortOrder(tx, projectId),
        })
        .returning({ id: routes.id })
      await tx.insert(responseCases).values({
        routeId: route!.id,
        name: 'OK',
        statusCode: 200,
        schema: emptySchema(),
        headers: {},
        delayMs: null,
        isDefault: true,
        sortOrder: 0,
      })
      return route!.id
    })
    return await fetchRoute(db, routeId)
  } catch (err) {
    if (isRouteUniqueViolation(err)) {
      throw conflict(input.method, await findCollision(db, projectId, input.method, input.path))
    }
    throw err
  }
}

// ---------- update ----------

export interface UpdateRouteInput {
  method?: Method
  path?: string
  description?: string | null
}

/** Partial update. `{}` is a no-op that leaves `updatedAt` alone (API-CONTRACT 1.5). */
export async function updateRoute(
  db: Db,
  current: { id: string; projectId: string; method: string; path: string },
  input: UpdateRouteInput,
): Promise<Route> {
  const changes: Partial<typeof routes.$inferInsert> = {}
  if (input.method !== undefined) changes.method = input.method
  if (input.path !== undefined) changes.path = input.path
  if (input.description !== undefined) changes.description = input.description
  if (Object.keys(changes).length === 0) return fetchRoute(db, current.id)

  const method = input.method ?? current.method
  const path = input.path ?? current.path
  const existing = await findCollision(db, current.projectId, method, path, current.id)
  if (existing) throw conflict(method, existing)

  try {
    await db.update(routes).set(changes).where(eq(routes.id, current.id))
  } catch (err) {
    if (isRouteUniqueViolation(err)) {
      throw conflict(method, await findCollision(db, current.projectId, method, path, current.id))
    }
    throw err
  }
  return fetchRoute(db, current.id)
}

export async function deleteRoute(db: Db, routeId: string): Promise<void> {
  await db.delete(routes).where(eq(routes.id, routeId))
}

// ---------- duplicate ----------

/**
 * The derived path of a copy: `-copy` appended to a static last segment, `/copy` after a param, then
 * `-copy-2`, `-copy-3`, ... (`/invoices` -> `/invoices-copy`, `/users/:id` -> `/users/:id/copy`).
 */
export function derivedCopyPath(base: string, n: number): string {
  const suffix = n === 1 ? 'copy' : `copy-${n}`
  const segments = base === '/' ? [] : base.slice(1).split('/')
  const last = segments[segments.length - 1]
  if (last === undefined) return `/${suffix}`
  return last.startsWith(':') ? `${base}/${suffix}` : `${base}-${suffix}`
}

const MAX_DERIVED_ATTEMPTS = 1000

export interface DuplicateInput {
  method?: Method | undefined
  path?: string | undefined
}

/** Deep copy of a route (every case, one default). See API-CONTRACT 3.6 for how paths are chosen. */
export async function duplicateRoute(
  db: Db,
  source: {
    id: string
    projectId: string
    method: string
    path: string
    description: string | null
  },
  input: DuplicateInput,
): Promise<Route> {
  const method = input.method ?? source.method
  const explicit = input.path !== undefined

  const taken = new Set(
    (
      await db
        .select({ p: routes.normalizedPath })
        .from(routes)
        .where(and(eq(routes.projectId, source.projectId), eq(routes.method, method)))
    ).map((r) => r.p),
  )

  const cases = await db
    .select()
    .from(responseCases)
    .where(eq(responseCases.routeId, source.id))
    .orderBy(asc(responseCases.sortOrder), asc(responseCases.createdAt), asc(responseCases.id))

  const copyTo = async (path: string): Promise<string> =>
    db.transaction(async (tx) => {
      const [route] = await tx
        .insert(routes)
        .values({
          projectId: source.projectId,
          method,
          path,
          description: source.description,
          sortOrder: await nextSortOrder(tx, source.projectId),
        })
        .returning({ id: routes.id })
      if (cases.length > 0) {
        await tx.insert(responseCases).values(
          cases.map((c) => ({
            routeId: route!.id,
            name: c.name,
            statusCode: c.statusCode,
            schema: c.schema,
            headers: c.headers,
            delayMs: c.delayMs,
            isDefault: c.isDefault,
            sortOrder: c.sortOrder,
          })),
        )
      }
      return route!.id
    })

  if (explicit) {
    const path = input.path as string
    if (taken.has(normalizePath(path))) {
      throw conflict(method, await findCollision(db, source.projectId, method, path))
    }
    try {
      return await fetchRoute(db, await copyTo(path))
    } catch (err) {
      if (isRouteUniqueViolation(err)) {
        throw conflict(method, await findCollision(db, source.projectId, method, path))
      }
      throw err
    }
  }

  // Derived path. When only the METHOD changes, the source path itself is the first candidate.
  const candidates = (function* () {
    if (method !== source.method) yield source.path
    for (let n = 1; n <= MAX_DERIVED_ATTEMPTS; n++) yield derivedCopyPath(source.path, n)
  })()

  for (const path of candidates) {
    if (taken.has(normalizePath(path))) continue
    const parsed = parseRoutePath(path)
    if (!parsed.ok) {
      const issue = parsed.issues[0]
      throw new HttpError(
        422,
        'validation_failed',
        'The derived path for the copy is not a valid route path; give an explicit path.',
        [{ path: ['path'], code: issue?.code ?? 'invalid_path', message: issue?.message ?? '' }],
      )
    }
    try {
      return await fetchRoute(db, await copyTo(path))
    } catch (err) {
      if (!isRouteUniqueViolation(err)) throw err
      taken.add(normalizePath(path)) // lost a race: try the next candidate
    }
  }
  throw conflict(method, undefined)
}
