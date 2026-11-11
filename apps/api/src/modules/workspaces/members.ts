// Member handlers (WS-02): list, add by email, change role, remove. Mutations that can affect the
// "a workspace always has an owner" invariant run in one transaction that first locks every
// membership row of the workspace (FOR UPDATE), so concurrent requests are serialised per workspace.
import { and, asc, eq } from 'drizzle-orm'
import { getMembership, notFound, requireRole } from '../../access'
import type { Role } from '../../access'
import type { Db } from '../../db/client'
import { users, workspaceMembers } from '../../db/schema'
import { HttpError } from '../../http/errors'
import type { ApiContext } from '../../http/types'

function callerId(ctx: ApiContext): string {
  if (!ctx.auth) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.')
  return ctx.auth.userId
}

const lastOwner = () =>
  new HttpError(409, 'last_owner', 'A workspace must keep at least one owner.')

const memberColumns = {
  id: workspaceMembers.id,
  userId: workspaceMembers.userId,
  email: users.email,
  name: users.name,
  role: workspaceMembers.role,
  createdAt: workspaceMembers.createdAt,
}

type MemberRow = {
  id: string
  userId: string
  email: string
  name: string
  role: Role
  createdAt: Date
}

const toResource = (r: MemberRow) => ({
  id: r.id,
  userId: r.userId,
  email: r.email,
  name: r.name,
  role: r.role,
  createdAt: r.createdAt.toISOString(),
})

async function loadMember(db: Db, workspaceId: string, memberId: string) {
  const [row] = await db
    .select(memberColumns)
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, workspaceId)))
  return row
}

/** Locks all membership rows of a workspace and returns them (id, userId, role). */
async function lockMembers(tx: Db, workspaceId: string) {
  return tx
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.id))
    .for('update')
}

export async function listMembers(ctx: ApiContext, input: { params: { workspaceId: string } }) {
  const { workspaceId } = input.params
  requireRole(await getMembership(ctx.db, callerId(ctx), workspaceId), 'viewer')
  const rows = await ctx.db
    .select(memberColumns)
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.id))
  return { status: 200 as const, body: { items: rows.map(toResource), nextCursor: null } }
}

export async function addMember(
  ctx: ApiContext,
  input: { params: { workspaceId: string }; body: { email: string; role: Role } },
) {
  const { workspaceId } = input.params
  requireRole(await getMembership(ctx.db, callerId(ctx), workspaceId), 'owner')
  // users.email is citext, so this match is case-insensitive.
  const [user] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.body.email))
  if (!user) throw new HttpError(404, 'user_not_found', 'No user with that email exists.')
  const inserted = await ctx.db
    .insert(workspaceMembers)
    .values({ workspaceId, userId: user.id, role: input.body.role })
    .onConflictDoNothing({ target: [workspaceMembers.workspaceId, workspaceMembers.userId] })
    .returning({ id: workspaceMembers.id })
  if (!inserted[0]) throw new HttpError(409, 'already_member', 'That user is already a member.')
  const row = await loadMember(ctx.db, workspaceId, inserted[0].id)
  return { status: 201 as const, body: toResource(row!) }
}

export async function updateMember(
  ctx: ApiContext,
  input: { params: { workspaceId: string; memberId: string }; body: { role?: Role } },
) {
  const { workspaceId, memberId } = input.params
  const userId = callerId(ctx)
  await ctx.db.transaction(async (tx) => {
    const members = await lockMembers(tx as unknown as Db, workspaceId)
    const me = members.find((m) => m.userId === userId)
    requireRole(me?.role, 'owner')
    const target = members.find((m) => m.id === memberId)
    if (!target) throw notFound()
    const role = input.body.role
    if (role === undefined || role === target.role) return
    if (target.role === 'owner' && members.filter((m) => m.role === 'owner').length <= 1) {
      throw lastOwner()
    }
    await tx.update(workspaceMembers).set({ role }).where(eq(workspaceMembers.id, memberId))
  })
  const row = await loadMember(ctx.db, workspaceId, memberId)
  return { status: 200 as const, body: toResource(row!) }
}

export async function removeMember(
  ctx: ApiContext,
  input: { params: { workspaceId: string; memberId: string } },
) {
  const { workspaceId, memberId } = input.params
  const userId = callerId(ctx)
  await ctx.db.transaction(async (tx) => {
    const members = await lockMembers(tx as unknown as Db, workspaceId)
    const me = members.find((m) => m.userId === userId)
    requireRole(me?.role, 'viewer') // not a member -> 404
    const target = members.find((m) => m.id === memberId)
    if (!target) throw notFound()
    if (target.userId !== userId) requireRole(me!.role, 'owner') // others: owners only -> 403
    if (target.role === 'owner' && members.filter((m) => m.role === 'owner').length <= 1) {
      throw lastOwner()
    }
    await tx.delete(workspaceMembers).where(eq(workspaceMembers.id, memberId))
  })
  return { status: 204 as const }
}
