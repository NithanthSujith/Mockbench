// Module "projects" (PRJ-01, PRJ-06): the Project resource of API-CONTRACT 3.4 and export/import (3.11);
// presets live in the sibling "presets" module (PRJ-02).
import { DEFAULT_PROJECT_SETTINGS, isReservedSlug } from '@mockbench/api-contract'
import { and, eq } from 'drizzle-orm'
import { loadProjectForUser, notFound, requireRole, requireWorkspaceRole } from '../../access'
import { projects, workspaceMembers } from '../../db/schema'
import { HttpError } from '../../http/errors'
import type { ApiContext, ModuleHandlers } from '../../http/types'
import { assertComponentsAcceptable } from './components'
import { buildExport, validateImport, writeImport } from './portability'
import { findProjectById, findProjectBySlug, listProjects } from './queries'

export const areas = ['projects'] as const

/** The authenticated caller's id. Session-level endpoints are guarded upstream; this is the type guard. */
function callerId(ctx: ApiContext): string {
  if (!ctx.auth) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.')
  return ctx.auth.userId
}

/** True for a Postgres unique violation on the given constraint (drizzle wraps the driver error). */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint?: string; cause?: unknown } | null
  if (!e) return false
  if (e.code === '23505' && e.constraint === constraint) return true
  return e.cause ? isUniqueViolation(e.cause, constraint) : false
}

const SLUG_CONSTRAINT = 'projects_slug_unique'

const slugTaken = () =>
  new HttpError(
    409,
    'slug_taken',
    'That URL slug is already used by another project on this server.',
  )

/** The response for a project that was just written; it must exist. */
async function respond(ctx: ApiContext, id: string) {
  const project = await findProjectById(ctx.db, id)
  if (!project) throw notFound()
  return project
}

export const handlers: ModuleHandlers<'projects'> = {
  'projects.list': async (ctx, { query }) => {
    await requireWorkspaceRole(ctx.db, callerId(ctx), query.workspaceId, 'viewer')
    const page = await listProjects(ctx.db, query.workspaceId, query.limit, query.cursor)
    return { status: 200, body: page }
  },

  'projects.create': async (ctx, { body }) => {
    await requireWorkspaceRole(ctx.db, callerId(ctx), body.workspaceId, 'editor')
    if (isReservedSlug(body.slug)) {
      throw new HttpError(
        422,
        'slug_reserved',
        `"${body.slug}" is reserved and cannot be used as a project slug.`,
      )
    }
    let id: string
    try {
      const [row] = await ctx.db
        .insert(projects)
        .values({
          workspaceId: body.workspaceId,
          name: body.name,
          slug: body.slug,
          description: body.description ?? null,
          settings: { ...DEFAULT_PROJECT_SETTINGS, ...body.settings },
        })
        .returning({ id: projects.id })
      id = row!.id
    } catch (err) {
      if (isUniqueViolation(err, SLUG_CONSTRAINT)) throw slugTaken()
      throw err
    }
    return { status: 201, body: await respond(ctx, id) }
  },

  'projects.getBySlug': async (ctx, { params }) => {
    const userId = callerId(ctx)
    // Unknown slug and "not a member" are the same 404 on purpose: existence is never leaked.
    const [row] = await ctx.db
      .select({ id: projects.id, role: workspaceMembers.role })
      .from(projects)
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, projects.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .where(eq(projects.slug, params.slug))
      .limit(1)
    if (!row) throw notFound()
    requireRole(row.role, 'viewer')
    const project = await findProjectBySlug(ctx.db, params.slug)
    if (!project) throw notFound()
    return { status: 200, body: project }
  },

  'projects.get': async (ctx, { params }) => {
    const { entity } = await loadProjectForUser(ctx.db, callerId(ctx), params.projectId, 'viewer')
    return { status: 200, body: await respond(ctx, entity.id) }
  },

  'projects.update': async (ctx, { params, body }) => {
    const { entity } = await loadProjectForUser(ctx.db, callerId(ctx), params.projectId, 'editor')

    const set: Partial<typeof projects.$inferInsert> = {}
    if (body.name !== undefined) set.name = body.name
    if (body.description !== undefined) set.description = body.description
    if (body.settings !== undefined) {
      // One level of merge: only the keys sent change; everything else is untouched.
      set.settings = {
        ...DEFAULT_PROJECT_SETTINGS,
        ...(entity.settings as object),
        ...body.settings,
      }
    }
    if (body.components !== undefined) {
      await assertComponentsAcceptable(ctx.db, entity.id, body.components)
      set.components = body.components
    }

    // `{}` is a valid no-op: nothing is written, so `updatedAt` does not move.
    if (Object.keys(set).length > 0) {
      await ctx.db.update(projects).set(set).where(eq(projects.id, entity.id))
    }
    return { status: 200, body: await respond(ctx, entity.id) }
  },

  'projects.delete': async (ctx, { params }) => {
    const { entity } = await loadProjectForUser(ctx.db, callerId(ctx), params.projectId, 'owner')
    // Routes, cases, presets, versions, deployments and request logs go with it (ON DELETE CASCADE).
    await ctx.db.delete(projects).where(eq(projects.id, entity.id))
    // Tell the data-plane cache (a no-op until the Runtime team registers its listener).
    await ctx.hooks.onProjectDeleted.emit(entity.id)
    return { status: 204 }
  },

  'projects.export': async (ctx, { params }) => {
    const { entity } = await loadProjectForUser(ctx.db, callerId(ctx), params.projectId, 'viewer')
    const doc = await buildExport(ctx.db, entity)
    // Written here (pretty, trailing newline) so the file diffs well; the dispatcher skips a sent response.
    ctx.res
      .status(200)
      .setHeader('Content-Disposition', `attachment; filename="${entity.slug}.mockbench.json"`)
    ctx.res.type('application/json').send(`${JSON.stringify(doc, null, 2)}
`)
    return { status: 200, body: doc }
  },

  'projects.import': async (ctx, { body }) => {
    await requireWorkspaceRole(ctx.db, callerId(ctx), body.workspaceId, 'editor')
    const doc = body.document
    const effective = {
      slug: body.slug ?? doc.project.slug,
      name: body.name ?? doc.project.name,
    }
    if (isReservedSlug(effective.slug)) {
      throw new HttpError(
        422,
        'slug_reserved',
        `"${effective.slug}" is reserved and cannot be used as a project slug.`,
      )
    }
    const issues = validateImport(doc, effective)
    if (issues.length > 0) {
      throw new HttpError(
        422,
        'import_invalid',
        `The file cannot be imported: ${issues.length} problem${issues.length === 1 ? '' : 's'} found.`,
        issues,
      )
    }
    const [taken] = await ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, effective.slug))
      .limit(1)
    if (taken) throw slugTaken()

    let id: string
    try {
      id = await ctx.db.transaction((tx) => writeImport(tx, body.workspaceId, doc, effective))
    } catch (err) {
      if (isUniqueViolation(err, SLUG_CONSTRAINT)) throw slugTaken()
      throw err
    }
    return { status: 201, body: await respond(ctx, id) }
  },
}
