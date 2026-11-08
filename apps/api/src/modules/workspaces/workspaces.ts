// Workspace handlers (WS-01): list, create, get, update, delete. Authorisation goes through the
// shared access loaders; nothing here decides roles on its own.
import { and, asc, eq, like, or, sql } from 'drizzle-orm'
import { loadWorkspaceForUser } from '../../access'
import type { Role } from '../../access'
import type { Db } from '../../db/client'
import { projects, workspaceMembers, workspaces } from '../../db/schema'
import { HttpError } from '../../http/errors'
import type { ApiContext } from '../../http/types'
import { baseSlug, freeSlugs } from './slug'

type WorkspaceRow = typeof workspaces.$inferSelect

/** The `Workspace` resource of API-CONTRACT 2, with the caller's own role. */
function toResource(row: WorkspaceRow, role: Role) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function callerId(ctx: ApiContext): string {
  if (!ctx.auth) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.')
  return ctx.auth.userId
}

/** The pg error code behind a (possibly drizzle-wrapped) error, with the violated constraint name. */
function pgError(err: unknown): { code?: string; constraint?: string } {
  let e: unknown = err
  for (let i = 0; i < 4 && e && typeof e === 'object'; i++) {
    const o = e as { code?: unknown; constraint?: unknown; cause?: unknown }
    if (typeof o.code === 'string') {
      return {
        code: o.code,
        constraint: typeof o.constraint === 'string' ? o.constraint : undefined,
      }
    }
    e = o.cause
  }
  return {}
}

const SLUG_CONSTRAINT = 'workspaces_slug_unique'
const slugTaken = () =>
  new HttpError(409, 'slug_taken', 'That workspace slug is already used on this server.')

/** Escapes `%`, `_` and `\` so a slug can be used as a LIKE prefix (slugs hold neither, but be exact). */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, '\\$&')

async function insertWorkspace(db: Db, userId: string, name: string, slug: string) {
  return db.transaction(async (tx) => {
    const [ws] = await tx.insert(workspaces).values({ name, slug }).returning()
    await tx.insert(workspaceMembers).values({ workspaceId: ws!.id, userId, role: 'owner' })
    return ws!
  })
}

/**
 * Derived slugs never conflict from the caller's point of view: a lost race (another create took the
 * slug we chose between our read and our insert) re-reads and tries again. The first try takes the
 * first free slug (so a lone request is deterministic); retries pick at random among the next few
 * free ones so concurrent requests stop colliding on the same candidate.
 */
const DERIVE_ATTEMPTS = 30

export async function listWorkspaces(ctx: ApiContext) {
  const userId = callerId(ctx)
  const rows = await ctx.db
    .select({ ws: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(sql`lower(${workspaces.name})`), asc(workspaces.id))
  return {
    status: 200 as const,
    body: { items: rows.map((r) => toResource(r.ws, r.role)), nextCursor: null },
  }
}

export async function createWorkspace(
  ctx: ApiContext,
  input: { body: { name: string; slug?: string } },
) {
  const userId = callerId(ctx)
  const { name, slug } = input.body

  if (slug !== undefined) {
    try {
      const ws = await insertWorkspace(ctx.db, userId, name, slug)
      return { status: 201 as const, body: toResource(ws, 'owner') }
    } catch (err) {
      const pg = pgError(err)
      if (pg.code === '23505' && pg.constraint === SLUG_CONSTRAINT) throw slugTaken()
      throw err
    }
  }

  const base = baseSlug(name)
  for (let attempt = 0; attempt < DERIVE_ATTEMPTS; attempt++) {
    const existing = await ctx.db
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(or(eq(workspaces.slug, base), like(workspaces.slug, `${likeEscape(base)}-%`)))
    const free = freeSlugs(base, new Set(existing.map((r) => r.slug)), attempt + 1)
    const chosen = attempt === 0 ? free[0]! : free[Math.floor(Math.random() * free.length)]!
    try {
      const ws = await insertWorkspace(ctx.db, userId, name, chosen)
      return { status: 201 as const, body: toResource(ws, 'owner') }
    } catch (err) {
      const pg = pgError(err)
      // Someone took the same free slug between our read and our insert: look again.
      if (pg.code === '23505' && pg.constraint === SLUG_CONSTRAINT) continue
      throw err
    }
  }
  throw slugTaken()
}

export async function getWorkspace(ctx: ApiContext, input: { params: { workspaceId: string } }) {
  const { entity, role } = await loadWorkspaceForUser(
    ctx.db,
    callerId(ctx),
    input.params.workspaceId,
    'viewer',
  )
  return { status: 200 as const, body: toResource(entity, role) }
}

export async function updateWorkspace(
  ctx: ApiContext,
  input: { params: { workspaceId: string }; body: { name?: string } },
) {
  const { entity, role } = await loadWorkspaceForUser(
    ctx.db,
    callerId(ctx),
    input.params.workspaceId,
    'owner',
  )
  const name = input.body.name
  // `{}` (and a rename to the same name) is a no-op: the row, and its updatedAt, stay untouched.
  if (name === undefined || name === entity.name) {
    return { status: 200 as const, body: toResource(entity, role) }
  }
  const [row] = await ctx.db
    .update(workspaces)
    .set({ name })
    .where(eq(workspaces.id, entity.id))
    .returning()
  return { status: 200 as const, body: toResource(row!, role) }
}

export async function deleteWorkspace(ctx: ApiContext, input: { params: { workspaceId: string } }) {
  const { entity } = await loadWorkspaceForUser(
    ctx.db,
    callerId(ctx),
    input.params.workspaceId,
    'owner',
  )
  const notEmpty = () =>
    new HttpError(
      409,
      'workspace_not_empty',
      "Delete or move this workspace's projects before deleting the workspace.",
    )
  const [count] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.workspaceId, entity.id))
  if ((count?.n ?? 0) > 0) throw notEmpty()
  try {
    // Memberships go with the workspace (ON DELETE CASCADE); a project created meanwhile blocks it (RESTRICT).
    await ctx.db.delete(workspaces).where(and(eq(workspaces.id, entity.id)))
  } catch (err) {
    if (pgError(err).code === '23503') throw notEmpty()
    throw err
  }
  return { status: 204 as const }
}
