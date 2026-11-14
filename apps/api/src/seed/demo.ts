// RUN-11: the demo seed. On an empty database (no users, no workspaces) it builds workspace
// `Default` (no members), project `demo` with three routes, then publishes v1 and deploys it through
// the same services the endpoints use (no special-casing). One transaction under an advisory lock:
// two replicas starting together seed once, and a failure leaves nothing half-built.
// The first person to register adopts the workspace as owner (AUTH-02, D3).
import { DEFAULT_PROJECT_SETTINGS } from '@mockbench/api-contract'
import { count, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { projects, users, workspaces } from '../db/schema'
import type { Hooks } from '../http/hooks'
import type { Logger } from '../http/logger'
import { createCase, updateCase } from '../modules/cases/service'
import { createRoute } from '../modules/routes/service'
import { deployVersion } from '../modules/versions/deploy'
import { publishVersion } from '../modules/versions/service'

/** Arbitrary constant for pg_advisory_xact_lock; distinct from the register lock (7_301_042). */
export const SEED_LOCK = 7_301_043

export const DEMO_SLUG = 'demo'

const userNode = {
  type: 'object',
  fields: [
    { key: 'id', node: { type: 'integer' } },
    { key: 'name', node: { type: 'string' } },
    { key: 'email', node: { type: 'email' } },
    { key: 'role', node: { type: 'string' } },
    { key: 'isActive', node: { type: 'boolean', fixed: true } },
  ],
}

const schema = (root: unknown) => ({ version: 1, components: {}, root })

const errorBody = (message: string) =>
  schema({ type: 'object', fields: [{ key: 'message', node: { type: 'string', fixed: message } }] })

export type SeedResult = { seeded: true; projectId: string } | { seeded: false }

/**
 * Seeds the demo project when the database is empty. Returns `{ seeded: false }` when it is not.
 * Emits `onVersionDeployed` after the commit so a warm cache never serves a stale "no such slug".
 */
export async function seedDemo(db: Db, hooks: Hooks): Promise<SeedResult> {
  const projectId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK})`)
    const [u] = await tx.select({ n: count() }).from(users)
    const [w] = await tx.select({ n: count() }).from(workspaces)
    if ((u?.n ?? 0) > 0 || (w?.n ?? 0) > 0) return null

    // The services take the Db type; a transaction is the same query surface, and their own
    // transactions become savepoints inside it.
    const t = tx as unknown as Db

    const [ws] = await tx
      .insert(workspaces)
      .values({ name: 'Default', slug: 'default' })
      .returning()
    const [project] = await tx
      .insert(projects)
      .values({
        workspaceId: ws!.id,
        name: 'Demo',
        slug: DEMO_SLUG,
        description: 'A sample API to try out. Delete it whenever you like.',
        settings: { ...DEFAULT_PROJECT_SETTINGS },
      })
      .returning({ id: projects.id })
    const pid = project!.id

    // createRoute makes the default case "OK" (200); each route renames and fills it.
    const list = await createRoute(t, pid, {
      method: 'GET',
      path: '/users',
      description: 'List users',
    })
    await updateCase(t, { id: list.cases[0]!.id, routeId: list.id }, pid, {
      name: 'List',
      schema: schema({ type: 'array', count: 3, items: userNode }),
    })

    const detail = await createRoute(t, pid, {
      method: 'GET',
      path: '/users/:id',
      description: 'Get one user',
    })
    await updateCase(t, { id: detail.cases[0]!.id, routeId: detail.id }, pid, {
      name: 'Found',
      schema: schema(userNode),
    })
    await createCase(t, detail, {
      name: 'Not found',
      statusCode: 404,
      schema: errorBody('User not found'),
    })

    const create = await createRoute(t, pid, {
      method: 'POST',
      path: '/users',
      description: 'Create a user',
    })
    await updateCase(t, { id: create.cases[0]!.id, routeId: create.id }, pid, {
      name: 'Created',
      statusCode: 201,
      schema: schema(userNode),
    })
    await createCase(t, create, {
      name: 'Validation failed',
      statusCode: 422,
      schema: errorBody('Validation failed'),
    })

    const version = await publishVersion(t, pid, null, { label: 'v1', notes: 'Demo seed' })
    await deployVersion(t, pid, null, version.id)
    return pid
  })

  if (projectId === null) return { seeded: false }
  await hooks.onVersionDeployed.emit(projectId)
  return { seeded: true, projectId }
}

/** Start-up wrapper: never throws, logs one error on failure so the server still starts. */
export async function seedDemoOnStart(db: Db, hooks: Hooks, logger: Logger): Promise<void> {
  try {
    const result = await seedDemo(db, hooks)
    if (result.seeded) logger.info({ slug: DEMO_SLUG }, 'demo project seeded')
  } catch (err) {
    logger.error({ err }, 'demo seed failed; continuing without it')
  }
}
