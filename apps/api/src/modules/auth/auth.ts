// Auth handlers (AUTH-02): register, login, logout, me, changePassword.
import { asc, count, eq, like, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { users, workspaceMembers, workspaces } from '../../db/schema'
import { authOf } from '../../http/auth'
import { HttpError } from '../../http/errors'
import type { ApiContext } from '../../http/types'
import { clearSessionCookie, setSessionCookie } from './cookies'
import { hashPassword, verifyDummy, verifyPassword } from './passwords'
import { createSessionService } from './sessions'

type UserRow = typeof users.$inferSelect

/** Serialises registrations so the first-user decision cannot race (transaction-scoped lock). */
const REGISTER_LOCK = 7_301_042

const invalidCredentials = () =>
  new HttpError(401, 'invalid_credentials', 'The email or password is incorrect.')
const emailTaken = () => new HttpError(409, 'email_taken', 'That email is already registered.')

function toUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt.toISOString() }
}

async function loadWorkspaces(db: Db, userId: string) {
  const rows = await db
    .select({ ws: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(sql`lower(${workspaces.name})`), asc(workspaces.id))
  return rows.map(({ ws, role }) => ({
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    role,
    createdAt: ws.createdAt.toISOString(),
    updatedAt: ws.updatedAt.toISOString(),
  }))
}

async function authState(db: Db, user: UserRow) {
  return { user: toUser(user), workspaces: await loadWorkspaces(db, user.id) }
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err
  for (let i = 0; i < 4 && e && typeof e === 'object'; i++) {
    const o = e as { code?: unknown; cause?: unknown }
    if (o.code === '23505') return true
    e = o.cause
  }
  return false
}

function sessions(ctx: ApiContext) {
  return createSessionService({ db: ctx.db, config: ctx.config })
}

async function startSession(ctx: ApiContext, userId: string) {
  const issued = await sessions(ctx).issue(userId, ctx.req)
  setSessionCookie(ctx.res, issued.token, ctx.config)
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** D3: the first user owns workspace `default`, joining it when the seed left it without members. */
async function bootstrapWorkspace(tx: Tx, userId: string) {
  const [existing] = await tx.select().from(workspaces).where(eq(workspaces.slug, 'default'))
  if (existing) {
    const [m] = await tx
      .select({ n: count() })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, existing.id))
    if ((m?.n ?? 0) === 0) {
      await tx.insert(workspaceMembers).values({ workspaceId: existing.id, userId, role: 'owner' })
      return
    }
  }
  let slug = 'default'
  if (existing) {
    const taken = new Set(
      (
        await tx
          .select({ slug: workspaces.slug })
          .from(workspaces)
          .where(like(workspaces.slug, 'default-%'))
      ).map((r) => r.slug),
    )
    for (let n = 2; ; n++) {
      slug = `default-${n}`
      if (!taken.has(slug)) break
    }
  }
  const [ws] = await tx.insert(workspaces).values({ name: 'Default', slug }).returning()
  await tx.insert(workspaceMembers).values({ workspaceId: ws!.id, userId, role: 'owner' })
}

export async function register(
  ctx: ApiContext,
  input: { body: { email: string; password: string; name: string } },
) {
  const { email, password, name } = input.body
  const passwordHash = await hashPassword(password)
  let user: UserRow
  try {
    user = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${REGISTER_LOCK})`)
      const [c] = await tx.select({ n: count() }).from(users)
      const first = (c?.n ?? 0) === 0
      if (!first && !ctx.config.allowSignup) {
        throw new HttpError(403, 'signup_disabled', 'Sign-up is disabled on this server.')
      }
      const [dup] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email))
      if (dup) throw emailTaken()
      const [row] = await tx.insert(users).values({ email, name, passwordHash }).returning()
      if (first) await bootstrapWorkspace(tx, row!.id)
      return row!
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw emailTaken()
    throw err
  }
  await startSession(ctx, user.id)
  return { status: 201 as const, body: await authState(ctx.db, user) }
}

export async function login(ctx: ApiContext, input: { body: { email: string; password: string } }) {
  const { email, password } = input.body
  const [user] = await ctx.db.select().from(users).where(eq(users.email, email))
  const ok = user ? await verifyPassword(user.passwordHash, password) : await verifyDummy(password)
  if (!user || !ok || !user.isActive) throw invalidCredentials()

  if (ctx.auth) await sessions(ctx).revoke(ctx.auth.sessionId)
  await startSession(ctx, user.id)
  return { status: 200 as const, body: await authState(ctx.db, user) }
}

export async function logout(ctx: ApiContext) {
  if (ctx.auth) await sessions(ctx).revoke(ctx.auth.sessionId)
  // A cookie that did not resolve was already cleared by the session step; do not clear twice.
  if (!ctx.req.sessionCookieRejected) clearSessionCookie(ctx.res, ctx.config)
  return { status: 204 as const }
}

export async function me(ctx: ApiContext) {
  const { userId } = authOf(ctx)
  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId))
  if (!user) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.')
  return { status: 200 as const, body: await authState(ctx.db, user) }
}

export async function changePassword(
  ctx: ApiContext,
  input: { body: { currentPassword: string; newPassword: string } },
) {
  const { userId, sessionId } = authOf(ctx)
  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId))
  if (!user) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.')
  if (!(await verifyPassword(user.passwordHash, input.body.currentPassword))) {
    throw new HttpError(403, 'wrong_password', 'The current password is incorrect.')
  }
  const passwordHash = await hashPassword(input.body.newPassword)
  await ctx.db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId))
  await sessions(ctx).revokeOthers(userId, sessionId)
  return { status: 204 as const }
}
