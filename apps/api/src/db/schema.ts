// Frozen database schema (FND-08). The migrated database and this file must agree exactly;
// db/__tests__/drift.test.ts fails when they do not. Changes come back to the main session.
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

const citext = customType<{ data: string }>({
  dataType() {
    return 'citext'
  },
})

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuid_v7()`)
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

export const workspaceRole = pgEnum('workspace_role', ['owner', 'editor', 'viewer'])

/** The 14 curated status codes (DESIGN Constraints; widen with a migration, never silently). */
export const CASE_STATUS_CODES = [
  200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503,
] as const

export const users = pgTable(
  'users',
  {
    id: id(),
    email: citext('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('users_email_unique').on(t.email)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
)

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('workspaces_slug_unique').on(t.slug),
    check(
      'workspaces_slug_format',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) between 2 and 40`,
    ),
  ],
)

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('workspace_members_workspace_user_unique').on(t.workspaceId, t.userId),
    index('workspace_members_user_id_idx').on(t.userId),
  ],
)

export const projects = pgTable(
  'projects',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    settings: jsonb('settings')
      .notNull()
      .default(sql`'{}'::jsonb`),
    components: jsonb('components')
      .notNull()
      .default(sql`'{}'::jsonb`),
    versionSeq: integer('version_seq').notNull().default(0),
    activeVersionId: uuid('active_version_id').references((): AnyPgColumn => versions.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('projects_slug_unique').on(t.slug),
    check(
      'projects_slug_format',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) between 3 and 40`,
    ),
    index('projects_workspace_created_idx').on(t.workspaceId, t.createdAt, t.id),
  ],
)

export const routes = pgTable(
  'routes',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    normalizedPath: text('normalized_path').generatedAlwaysAs(
      sql`lower(regexp_replace(path, ':[A-Za-z_][A-Za-z0-9_]*', '{}', 'g'))`,
    ),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('routes_method_check', sql`${t.method} in ('GET','POST','PUT','PATCH','DELETE')`),
    unique('routes_project_method_normalized_unique').on(t.projectId, t.method, t.normalizedPath),
    index('routes_project_sort_idx').on(t.projectId, t.sortOrder),
  ],
)

export const responseCases = pgTable(
  'response_cases',
  {
    id: id(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    statusCode: integer('status_code').notNull(),
    schema: jsonb('schema').notNull(),
    headers: jsonb('headers')
      .notNull()
      .default(sql`'{}'::jsonb`),
    delayMs: integer('delay_ms'),
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'response_cases_status_code_check',
      sql`${t.statusCode} in (200,201,202,204,400,401,403,404,409,422,429,500,502,503)`,
    ),
    check(
      'response_cases_delay_ms_check',
      sql`${t.delayMs} is null or ${t.delayMs} between 0 and 10000`,
    ),
    uniqueIndex('response_cases_route_name_unique').on(t.routeId, sql`lower(${t.name})`),
    uniqueIndex('response_cases_one_default_per_route')
      .on(t.routeId)
      .where(sql`${t.isDefault}`),
    index('response_cases_route_sort_idx').on(t.routeId, t.sortOrder),
  ],
)

export const dataPresets = pgTable(
  'data_presets',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    rules: jsonb('rules')
      .notNull()
      .default(sql`'[]'::jsonb`),
    isEnabled: boolean('is_enabled').notNull().default(true),
    priority: integer('priority').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('data_presets_project_idx').on(t.projectId)],
)

/** Immutable: a trigger rejects UPDATE (except the FK clean-up of created_by). No updated_at. */
export const versions = pgTable(
  'versions',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    label: text('label').notNull(),
    notes: text('notes'),
    snapshot: jsonb('snapshot').notNull(),
    /** JSON object { "<routeId>:<caseId>": "<body string>" } as text; null in random mode. */
    baked: text('baked'),
    routeCount: integer('route_count').notNull(),
    caseCount: integer('case_count').notNull(),
    snapshotBytes: integer('snapshot_bytes').notNull(),
    bakedBytes: integer('baked_bytes').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('versions_project_seq_unique').on(t.projectId, t.seq),
    unique('versions_project_label_unique').on(t.projectId, t.label),
    index('versions_project_created_idx').on(t.projectId, t.createdAt.desc()),
  ],
)

export const deployments = pgTable(
  'deployments',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id').references(() => versions.id, { onDelete: 'set null' }),
    versionLabel: text('version_label').notNull(),
    deployedBy: uuid('deployed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('deployments_project_created_idx').on(t.projectId, t.createdAt.desc(), t.id.desc()),
  ],
)

export const requestLogs = pgTable(
  'request_logs',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id').references(() => versions.id, { onDelete: 'restrict' }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    /** Plain columns, deliberately no FK: the route/case may be deleted later. */
    matchedRouteId: uuid('matched_route_id'),
    matchedCaseId: uuid('matched_case_id'),
    routePattern: text('route_pattern'),
    caseName: text('case_name'),
    statusCode: integer('status_code').notNull(),
    durationMs: integer('duration_ms').notNull(),
    mockError: text('mock_error'),
    requestHeaders: jsonb('request_headers')
      .notNull()
      .default(sql`'{}'::jsonb`),
    query: jsonb('query')
      .notNull()
      .default(sql`'{}'::jsonb`),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('request_logs_project_created_idx').on(t.projectId, t.createdAt.desc(), t.id.desc()),
  ],
)

export const allTables = {
  users,
  sessions,
  workspaces,
  workspaceMembers,
  projects,
  routes,
  responseCases,
  dataPresets,
  versions,
  deployments,
  requestLogs,
} as const
