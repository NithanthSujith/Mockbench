// Row factories (FND-11). Each one accepts overrides, returns the inserted row, and creates whatever
// parents it needs on demand, so a test can write `await createRoute(db)` and nothing else.
// Unique values (emails, slugs, labels) come from a random suffix, safe under parallel calls.
import { randomBytes } from 'node:crypto'
import { GENERATOR_VERSION, emptySchema } from '@mockbench/schema-core'
import { and, eq, sql } from 'drizzle-orm'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { Db } from '../db/client'
import {
  dataPresets,
  deployments,
  projects,
  responseCases,
  routes,
  users,
  versions,
  workspaceMembers,
  workspaces,
} from '../db/schema'

export type User = InferSelectModel<typeof users>
export type Workspace = InferSelectModel<typeof workspaces>
export type Member = InferSelectModel<typeof workspaceMembers>
export type Project = InferSelectModel<typeof projects>
export type Route = InferSelectModel<typeof routes>
export type ResponseCase = InferSelectModel<typeof responseCases>
export type Preset = InferSelectModel<typeof dataPresets>
export type Version = InferSelectModel<typeof versions>
export type Deployment = InferSelectModel<typeof deployments>

const suffix = () => randomBytes(5).toString('hex')

export const DEFAULT_PROJECT_SETTINGS = {
  indexing: 'local',
  mode: 'deterministic',
  cors: '*',
  defaultDelayMs: 0,
} as const

export async function createUser(
  db: Db,
  o: Partial<InferInsertModel<typeof users>> = {},
): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      email: `user-${suffix()}@example.test`,
      passwordHash: 'not-a-real-hash',
      name: 'Test User',
      ...o,
    })
    .returning()
  return row!
}

export async function createWorkspace(
  db: Db,
  o: Partial<InferInsertModel<typeof workspaces>> = {},
): Promise<Workspace> {
  const [row] = await db
    .insert(workspaces)
    .values({ name: 'Test Workspace', slug: `ws-${suffix()}`, ...o })
    .returning()
  return row!
}

/** Adds a user to a workspace. Creates the user and/or workspace when not given. */
export async function createMember(
  db: Db,
  o: Partial<InferInsertModel<typeof workspaceMembers>> = {},
): Promise<Member> {
  const workspaceId = o.workspaceId ?? (await createWorkspace(db)).id
  const userId = o.userId ?? (await createUser(db)).id
  const [row] = await db
    .insert(workspaceMembers)
    .values({ role: 'editor', ...o, workspaceId, userId })
    .returning()
  return row!
}

export async function createProject(
  db: Db,
  o: Partial<InferInsertModel<typeof projects>> = {},
): Promise<Project> {
  const workspaceId = o.workspaceId ?? (await createWorkspace(db)).id
  const [row] = await db
    .insert(projects)
    .values({
      name: 'Test Project',
      slug: `proj-${suffix()}`,
      settings: { ...DEFAULT_PROJECT_SETTINGS },
      ...o,
      workspaceId,
    })
    .returning()
  return row!
}

async function nextSort(db: Db, table: 'routes' | 'cases', parentId: string): Promise<number> {
  const result =
    table === 'routes'
      ? await db
          .select({ n: sql<number>`coalesce(max(${routes.sortOrder}), -1) + 1` })
          .from(routes)
          .where(eq(routes.projectId, parentId))
      : await db
          .select({ n: sql<number>`coalesce(max(${responseCases.sortOrder}), -1) + 1` })
          .from(responseCases)
          .where(eq(responseCases.routeId, parentId))
  return Number(result[0]?.n ?? 0)
}

export interface CreateRouteOptions extends Partial<InferInsertModel<typeof routes>> {
  /** Create the route's default case "OK / 200" in the same transaction (default true). */
  withDefaultCase?: boolean
}

/**
 * Creates a route and, by default, its single default case, exactly as `routes.create` does
 * (API-CONTRACT 3.6), so the "exactly one default case per route" invariant holds from the start.
 */
export async function createRoute(db: Db, o: CreateRouteOptions = {}): Promise<Route> {
  const { withDefaultCase = true, ...values } = o
  const projectId = values.projectId ?? (await createProject(db)).id
  const sortOrder = values.sortOrder ?? (await nextSort(db, 'routes', projectId))
  return db.transaction(async (tx) => {
    const [route] = await tx
      .insert(routes)
      .values({ method: 'GET', path: `/items-${suffix()}`, ...values, projectId, sortOrder })
      .returning()
    if (withDefaultCase) {
      await tx.insert(responseCases).values({
        routeId: route!.id,
        name: 'OK',
        statusCode: 200,
        schema: emptySchema(),
        isDefault: true,
        sortOrder: 0,
      })
    }
    return route!
  })
}

/**
 * Creates a response case. With no `routeId` it creates a route WITHOUT a default case and makes this
 * case the default; with a `routeId` it is non-default unless `isDefault: true` (which, like
 * `cases.setDefault`, demotes the current default first).
 */
export async function createCase(
  db: Db,
  o: Partial<InferInsertModel<typeof responseCases>> = {},
): Promise<ResponseCase> {
  const onDemand = !o.routeId
  const routeId = o.routeId ?? (await createRoute(db, { withDefaultCase: false })).id
  const isDefault = o.isDefault ?? onDemand
  const sortOrder = o.sortOrder ?? (await nextSort(db, 'cases', routeId))
  return db.transaction(async (tx) => {
    if (isDefault) {
      await tx
        .update(responseCases)
        .set({ isDefault: false })
        .where(and(eq(responseCases.routeId, routeId), eq(responseCases.isDefault, true)))
    }
    const [row] = await tx
      .insert(responseCases)
      .values({
        name: `Case ${suffix()}`,
        statusCode: 200,
        schema: emptySchema(),
        ...o,
        routeId,
        isDefault,
        sortOrder,
      })
      .returning()
    return row!
  })
}

export async function createPreset(
  db: Db,
  o: Partial<InferInsertModel<typeof dataPresets>> = {},
): Promise<Preset> {
  const projectId = o.projectId ?? (await createProject(db)).id
  const [row] = await db
    .insert(dataPresets)
    .values({ name: `Preset ${suffix()}`, rules: [], ...o, projectId })
    .returning()
  return row!
}

/**
 * Inserts an immutable version with a minimal valid snapshot (no routes). `seq` continues the
 * project's counter, which is advanced to match, as `versions.publish` does.
 */
export async function createVersion(
  db: Db,
  o: Partial<InferInsertModel<typeof versions>> = {},
): Promise<Version> {
  const project = o.projectId
    ? (await db.select().from(projects).where(eq(projects.id, o.projectId)))[0]!
    : await createProject(db)
  const seq = o.seq ?? project.versionSeq + 1
  const snapshot = o.snapshot ?? {
    schemaVersion: 1,
    generatorVersion: GENERATOR_VERSION,
    project: {
      id: project.id,
      slug: project.slug,
      settings: project.settings,
      components: project.components,
    },
    routes: [],
    presets: [],
  }
  const [row] = await db
    .insert(versions)
    .values({
      label: `v${seq}`,
      routeCount: 0,
      caseCount: 0,
      snapshotBytes: JSON.stringify(snapshot).length,
      ...o,
      projectId: project.id,
      seq,
      snapshot,
    })
    .returning()
  await db
    .update(projects)
    .set({ versionSeq: sql`greatest(${projects.versionSeq}, ${seq})` })
    .where(eq(projects.id, project.id))
  return row!
}

export interface CreateDeploymentOptions extends Partial<InferInsertModel<typeof deployments>> {
  /** Also point the project's `active_version_id` at the version, as `deploy.create` does (default true). */
  activate?: boolean
}

/** Records a deployment (creating the project and version on demand) and, by default, makes it live. */
export async function createDeployment(
  db: Db,
  o: CreateDeploymentOptions = {},
): Promise<Deployment> {
  const { activate = true, ...values } = o
  const version = values.versionId
    ? (await db.select().from(versions).where(eq(versions.id, values.versionId)))[0]!
    : await createVersion(db, values.projectId ? { projectId: values.projectId } : {})
  const [row] = await db
    .insert(deployments)
    .values({
      versionLabel: version.label,
      ...values,
      projectId: version.projectId,
      versionId: version.id,
    })
    .returning()
  if (activate) {
    await db
      .update(projects)
      .set({ activeVersionId: version.id })
      .where(eq(projects.id, version.projectId))
  }
  return row!
}

/** The factories bound to one Db: `const f = factories(db); await f.createRoute()`. */
export function factories(db: Db) {
  return {
    createUser: (o?: Parameters<typeof createUser>[1]) => createUser(db, o),
    createWorkspace: (o?: Parameters<typeof createWorkspace>[1]) => createWorkspace(db, o),
    createMember: (o?: Parameters<typeof createMember>[1]) => createMember(db, o),
    createProject: (o?: Parameters<typeof createProject>[1]) => createProject(db, o),
    createRoute: (o?: CreateRouteOptions) => createRoute(db, o),
    createCase: (o?: Parameters<typeof createCase>[1]) => createCase(db, o),
    createPreset: (o?: Parameters<typeof createPreset>[1]) => createPreset(db, o),
    createVersion: (o?: Parameters<typeof createVersion>[1]) => createVersion(db, o),
    createDeployment: (o?: CreateDeploymentOptions) => createDeployment(db, o),
  }
}
export type Factories = ReturnType<typeof factories>
