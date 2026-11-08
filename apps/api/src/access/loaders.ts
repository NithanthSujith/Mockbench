// Authorisation loaders (FND-11). Every module resolves "the entity this user is asking about" through
// one of these, and gets either the entity plus the caller's role, or a uniform error:
//
//   entity missing                 -> 404 not_found
//   caller not in the owning ws    -> 404 not_found   (existence is never leaked)
//   member below the required role -> 403 forbidden
//
// Each loader issues exactly ONE query: the entity is joined through to the owning workspace and the
// caller's membership row (left join, so a missing membership still returns the row and we can tell
// "not a member" from "does not exist" - both are 404 on purpose).
import { and, eq, getTableColumns } from 'drizzle-orm'
import type { Db } from '../db/client'
import {
  dataPresets,
  deployments,
  projects,
  responseCases,
  routes,
  versions,
  workspaceMembers,
  workspaces,
} from '../db/schema'
import { HttpError } from '../http/errors'
import { roleAtLeast } from './permissions'
import type { Role } from './permissions'

export interface Loaded<T> {
  entity: T
  /** The caller's role in the workspace that owns the entity. */
  role: Role
  workspaceId: string
}

/** Entities that live inside a project also report it, so callers can scope follow-up queries. */
export interface LoadedInProject<T> extends Loaded<T> {
  projectId: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found.')
}

export function forbidden(): HttpError {
  return new HttpError(403, 'forbidden', 'You do not have permission to do that.')
}

/**
 * The single enforcement point: no membership -> 404, role too low -> 403. Returns the role.
 * Use directly when the workspace id comes from a request body (e.g. `projects.create`).
 */
export function requireRole(role: Role | null | undefined, min: Role): Role {
  if (!role) throw notFound()
  if (!roleAtLeast(role, min)) throw forbidden()
  return role
}

/** The caller's role in a workspace, or null when they are not a member (or it does not exist). */
export async function getMembership(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<Role | null> {
  if (!UUID.test(userId) || !UUID.test(workspaceId)) return null
  const rows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1)
  return rows[0]?.role ?? null
}

/** `getMembership` + `requireRole`: for endpoints addressed by a workspace id in the body or query. */
export async function requireWorkspaceRole(
  db: Db,
  userId: string,
  workspaceId: string,
  min: Role,
): Promise<Role> {
  return requireRole(await getMembership(db, userId, workspaceId), min)
}

type Row<T> = { entity: T; role: Role | null; workspaceId: string; projectId?: string }

function finish<T>(row: Row<T> | undefined, min: Role): Loaded<T> {
  if (!row) throw notFound()
  const role = requireRole(row.role, min)
  return { entity: row.entity, role, workspaceId: row.workspaceId }
}

function finishInProject<T>(row: Row<T> | undefined, min: Role): LoadedInProject<T> {
  const loaded = finish(row, min)
  return { ...loaded, projectId: (row as Row<T>).projectId as string }
}

function isId(...ids: string[]): boolean {
  return ids.every((id) => typeof id === 'string' && UUID.test(id))
}

export async function loadWorkspaceForUser(db: Db, userId: string, id: string, min: Role) {
  if (!isId(userId, id)) throw notFound()
  const [row] = await db
    .select({
      entity: getTableColumns(workspaces),
      role: workspaceMembers.role,
      workspaceId: workspaces.id,
    })
    .from(workspaces)
    .leftJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)),
    )
    .where(eq(workspaces.id, id))
    .limit(1)
  return finish(row, min)
}

export async function loadProjectForUser(db: Db, userId: string, id: string, min: Role) {
  if (!isId(userId, id)) throw notFound()
  const [row] = await db
    .select({
      entity: getTableColumns(projects),
      role: workspaceMembers.role,
      workspaceId: projects.workspaceId,
      projectId: projects.id,
    })
    .from(projects)
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(projects.id, id))
    .limit(1)
  return finishInProject(row, min)
}

export async function loadRouteForUser(db: Db, userId: string, id: string, min: Role) {
  if (!isId(userId, id)) throw notFound()
  const [row] = await db
    .select({
      entity: getTableColumns(routes),
      role: workspaceMembers.role,
      workspaceId: projects.workspaceId,
      projectId: projects.id,
    })
    .from(routes)
    .innerJoin(projects, eq(projects.id, routes.projectId))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(routes.id, id))
    .limit(1)
  return finishInProject(row, min)
}

export async function loadCaseForUser(db: Db, userId: string, id: string, min: Role) {
  if (!isId(userId, id)) throw notFound()
  const [row] = await db
    .select({
      entity: getTableColumns(responseCases),
      role: workspaceMembers.role,
      workspaceId: projects.workspaceId,
      projectId: projects.id,
    })
    .from(responseCases)
    .innerJoin(routes, eq(routes.id, responseCases.routeId))
    .innerJoin(projects, eq(projects.id, routes.projectId))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(responseCases.id, id))
    .limit(1)
  return finishInProject(row, min)
}

export async function loadPresetForUser(db: Db, userId: string, id: string, min: Role) {
  if (!isId(userId, id)) throw notFound()
  const [row] = await db
    .select({
      entity: getTableColumns(dataPresets),
      role: workspaceMembers.role,
      workspaceId: projects.workspaceId,
      projectId: projects.id,
    })
    .from(dataPresets)
    .innerJoin(projects, eq(projects.id, dataPresets.projectId))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(dataPresets.id, id))
    .limit(1)
  return finishInProject(row, min)
}

const versionColumns = getTableColumns(versions)
/** Every versions column except the (potentially huge) `snapshot` and `baked`. */
const VERSION_META_COLUMNS = Object.fromEntries(
  Object.entries(versionColumns).filter(([name]) => name !== 'snapshot' && name !== 'baked'),
) as Omit<typeof versionColumns, 'snapshot' | 'baked'>

/**
 * Loads a version's METADATA (never `snapshot`/`baked`, which can be hundreds of KB): handlers that
 * need the snapshot read it with a second, explicit query after authorisation.
 */
export async function loadVersionForUser(db: Db, userId: string, id: string, min: Role) {
  if (!isId(userId, id)) throw notFound()
  const [row] = await db
    .select({
      entity: VERSION_META_COLUMNS,
      role: workspaceMembers.role,
      workspaceId: projects.workspaceId,
      projectId: projects.id,
    })
    .from(versions)
    .innerJoin(projects, eq(projects.id, versions.projectId))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(versions.id, id))
    .limit(1)
  return finishInProject(row, min)
}

export async function loadDeploymentForUser(db: Db, userId: string, id: string, min: Role) {
  if (!isId(userId, id)) throw notFound()
  const [row] = await db
    .select({
      entity: getTableColumns(deployments),
      role: workspaceMembers.role,
      workspaceId: projects.workspaceId,
      projectId: projects.id,
    })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(deployments.id, id))
    .limit(1)
  return finishInProject(row, min)
}

/** The loaders bound to one Db, for modules that receive `db` once at init. */
export function createAccess(db: Db) {
  return {
    getMembership: (userId: string, workspaceId: string) => getMembership(db, userId, workspaceId),
    requireWorkspaceRole: (userId: string, workspaceId: string, min: Role) =>
      requireWorkspaceRole(db, userId, workspaceId, min),
    loadWorkspaceForUser: (userId: string, id: string, min: Role) =>
      loadWorkspaceForUser(db, userId, id, min),
    loadProjectForUser: (userId: string, id: string, min: Role) =>
      loadProjectForUser(db, userId, id, min),
    loadRouteForUser: (userId: string, id: string, min: Role) =>
      loadRouteForUser(db, userId, id, min),
    loadCaseForUser: (userId: string, id: string, min: Role) =>
      loadCaseForUser(db, userId, id, min),
    loadPresetForUser: (userId: string, id: string, min: Role) =>
      loadPresetForUser(db, userId, id, min),
    loadVersionForUser: (userId: string, id: string, min: Role) =>
      loadVersionForUser(db, userId, id, min),
    loadDeploymentForUser: (userId: string, id: string, min: Role) =>
      loadDeploymentForUser(db, userId, id, min),
  }
}
export type Access = ReturnType<typeof createAccess>
