// Resource schemas (API-CONTRACT section 2). `z.infer` types are exported next to each schema.
// Responses are strict objects so a handler that returns an unexpected field fails its contract test.
// `.meta({ id })` hoists the main resources into components.schemas of the OpenAPI document.
import { z } from 'zod'
import {
  PresetRuleSchema,
  PresetRulesSchema,
  mockNodeZod,
  mockSchemaZod,
} from '@mockbench/schema-core'
import { HTTP_METHODS, Id, Slug, Timestamp, WorkspaceSlug } from './primitives'
import { ComponentName, DelayMs, MAX_COMPONENTS, Role } from './rules'

// schema-core's MockNode and preset-rule schemas are recursive (z.lazy / z.json), which the OpenAPI
// generator cannot expand. Describing them with an explicit OpenAPI `type` on the exported instances
// makes the generator emit a named component and stop there. Runtime validation is unaffected.
// (A try/catch guards against schema-core registering the same id itself in future.)
function describeForOpenApi(schema: z.ZodType, meta: Record<string, unknown>): void {
  if (z.globalRegistry.has(schema)) return
  try {
    z.globalRegistry.add(schema, meta)
  } catch {
    /* id already registered on another instance */
  }
}
describeForOpenApi(mockNodeZod, {
  id: 'MockNode',
  type: 'object',
  description:
    'A MockSchema node: { type, ...attributes }. Unknown keys are preserved. See packages/schema-core.',
})
/** Any JSON value (e.g. the sample posted to schema.infer). */
export const JsonValue = z.json()
describeForOpenApi(JsonValue, {
  id: 'JsonValue',
  type: ['string', 'number', 'boolean', 'object', 'array', 'null'],
  description: 'Any JSON value.',
})
describeForOpenApi(PresetRuleSchema, {
  id: 'PresetRule',
  type: 'object',
  description:
    'A preset rule: { match: { key?, path?, type? }, and exactly one of value | values | pattern }.',
})

// ---------- shared building blocks ----------

export const Method = z.enum(HTTP_METHODS)
export type Method = z.infer<typeof Method>

export const UserRef = z.strictObject({ id: Id, name: z.string() })
export type UserRef = z.infer<typeof UserRef>

export const User = z
  .strictObject({ id: Id, email: z.string(), name: z.string(), createdAt: Timestamp })
  .meta({ id: 'User' })
export type User = z.infer<typeof User>

/** MockSchema envelope `{ version: 1, components, root }`, owned by schema-core. */
export const MockSchemaEnvelope = mockSchemaZod
export type MockSchemaEnvelope = z.infer<typeof MockSchemaEnvelope>

export const MockNode = mockNodeZod
export type MockNode = z.infer<typeof MockNode>

/** Project-level `ref` targets: at most 100 components with valid names. */
export const Components = z
  .record(ComponentName, MockNode)
  .refine((c) => Object.keys(c).length <= MAX_COMPONENTS, {
    message: `A project can have at most ${MAX_COMPONENTS} components.`,
    params: { code: 'component_limit_exceeded' },
  })
export type Components = z.infer<typeof Components>

export const PresetRules = PresetRulesSchema

// ---------- workspaces ----------

export const Workspace = z
  .strictObject({
    id: Id,
    name: z.string(),
    slug: WorkspaceSlug,
    /** The caller's role in this workspace. */
    role: Role,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Workspace' })
export type Workspace = z.infer<typeof Workspace>

export const Member = z
  .strictObject({
    /** Membership id (not the user id). */
    id: Id,
    userId: Id,
    email: z.string(),
    name: z.string(),
    role: Role,
    createdAt: Timestamp,
  })
  .meta({ id: 'Member' })
export type Member = z.infer<typeof Member>

export const AuthState = z
  .strictObject({ user: User, workspaces: z.array(Workspace) })
  .meta({ id: 'AuthState' })
export type AuthState = z.infer<typeof AuthState>

// ---------- projects ----------

export const ProjectSettings = z
  .strictObject({
    indexing: z.enum(['local', 'path']),
    mode: z.enum(['deterministic', 'seeded', 'random']),
    cors: z.enum(['*', 'off']),
    defaultDelayMs: DelayMs,
  })
  .meta({ id: 'ProjectSettings' })
export type ProjectSettings = z.infer<typeof ProjectSettings>

/** Settings as sent on create / PATCH / preview: any subset; PATCH merges per key. */
export const ProjectSettingsInput = z.strictObject(ProjectSettings.shape).partial()
export type ProjectSettingsInput = z.infer<typeof ProjectSettingsInput>

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  indexing: 'local',
  mode: 'deterministic',
  cors: '*',
  defaultDelayMs: 0,
}

export const Project = z
  .strictObject({
    id: Id,
    workspaceId: Id,
    name: z.string(),
    slug: Slug,
    description: z.string().nullable(),
    settings: ProjectSettings,
    components: Components,
    activeVersion: z.strictObject({ id: Id, label: z.string(), deployedAt: Timestamp }).nullable(),
    routeCount: z.number().int().min(0),
    caseCount: z.number().int().min(0),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Project' })
export type Project = z.infer<typeof Project>

// ---------- routes and cases ----------

export const CaseSummary = z.strictObject({
  id: Id,
  name: z.string(),
  statusCode: z.number().int(),
  isDefault: z.boolean(),
})
export type CaseSummary = z.infer<typeof CaseSummary>

export const Route = z
  .strictObject({
    id: Id,
    projectId: Id,
    method: Method,
    path: z.string(),
    description: z.string().nullable(),
    /** Sorted by `sortOrder`: the editor's case tabs. */
    cases: z.array(CaseSummary),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Route' })
export type Route = z.infer<typeof Route>

export const ResponseCase = z
  .strictObject({
    id: Id,
    routeId: Id,
    name: z.string(),
    statusCode: z.number().int(),
    schema: MockSchemaEnvelope,
    headers: z.record(z.string(), z.string()),
    delayMs: z.number().int().nullable(),
    isDefault: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'ResponseCase' })
export type ResponseCase = z.infer<typeof ResponseCase>

/** The empty-object envelope used as the default case schema. */
export const EMPTY_SCHEMA_ENVELOPE: MockSchemaEnvelope = {
  version: 1,
  components: {},
  root: { type: 'object', fields: [] },
}

// ---------- presets ----------

export const Preset = z
  .strictObject({
    id: Id,
    projectId: Id,
    name: z.string(),
    rules: PresetRules,
    isEnabled: z.boolean(),
    priority: z.number().int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Preset' })
export type Preset = z.infer<typeof Preset>

export const PRIORITY_MIN = -2_147_483_648
export const PRIORITY_MAX = 2_147_483_647
export const PresetPriority = z.number().int().min(PRIORITY_MIN).max(PRIORITY_MAX)

// ---------- versions, deployments ----------

export const VersionSummary = z
  .strictObject({
    id: Id,
    projectId: Id,
    seq: z.number().int().min(1),
    label: z.string(),
    notes: z.string().nullable(),
    createdBy: UserRef.nullable(),
    createdAt: Timestamp,
    routeCount: z.number().int().min(0),
    caseCount: z.number().int().min(0),
    bakedBytes: z.number().int().min(0),
    isActive: z.boolean(),
  })
  .meta({ id: 'VersionSummary' })
export type VersionSummary = z.infer<typeof VersionSummary>

export const Snapshot = z
  .strictObject({
    schemaVersion: z.literal(1),
    generatorVersion: z.number().int(),
    project: z.strictObject({
      id: Id,
      slug: z.string(),
      settings: ProjectSettings,
      components: Components,
    }),
    routes: z.array(
      z.strictObject({
        id: Id,
        method: Method,
        path: z.string(),
        description: z.string().nullable(),
        cases: z.array(
          z.strictObject({
            id: Id,
            name: z.string(),
            statusCode: z.number().int(),
            headers: z.record(z.string(), z.string()),
            delayMs: z.number().int().nullable(),
            isDefault: z.boolean(),
            schema: MockSchemaEnvelope,
          }),
        ),
      }),
    ),
    /** Enabled presets only. */
    presets: z.array(
      z.strictObject({ id: Id, name: z.string(), priority: z.number().int(), rules: PresetRules }),
    ),
  })
  .meta({ id: 'Snapshot' })
export type Snapshot = z.infer<typeof Snapshot>

/** A version with its snapshot. Baked payloads are never returned. */
export const Version = VersionSummary.extend({ snapshot: Snapshot }).meta({ id: 'Version' })
export type Version = z.infer<typeof Version>

export const Deployment = z
  .strictObject({
    id: Id,
    projectId: Id,
    versionId: Id.nullable(),
    versionLabel: z.string(),
    deployedAt: Timestamp,
    deployedBy: UserRef.nullable(),
  })
  .meta({ id: 'Deployment' })
export type Deployment = z.infer<typeof Deployment>

// ---------- request log ----------

export const RequestLogEntry = z
  .strictObject({
    id: Id,
    projectId: Id,
    createdAt: Timestamp,
    method: z.string(),
    path: z.string(),
    query: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    statusCode: z.number().int(),
    durationMs: z.number().int().min(0),
    routePattern: z.string().nullable(),
    caseName: z.string().nullable(),
    versionId: Id.nullable(),
    versionLabel: z.string().nullable(),
    /** Set when the mock server itself generated the response. */
    mockError: z.string().nullable(),
    /** authorization, cookie, proxy-authorization, x-api-key and set-cookie values are "[redacted]". */
    requestHeaders: z.record(z.string(), z.string()),
    ip: z.string().nullable(),
  })
  .meta({ id: 'RequestLogEntry' })
export type RequestLogEntry = z.infer<typeof RequestLogEntry>

// ---------- project export file ----------

export const PROJECT_EXPORT_FORMAT_VERSION = 1

/** One self-contained JSON document. No ids; key order is the order declared here (stable diffs). */
export const ProjectExport = z
  .strictObject({
    formatVersion: z.literal(PROJECT_EXPORT_FORMAT_VERSION),
    project: z.strictObject({
      name: z.string(),
      slug: z.string(),
      description: z.string().nullable(),
      settings: ProjectSettings,
      components: Components,
    }),
    presets: z.array(
      z.strictObject({
        name: z.string(),
        rules: PresetRules,
        isEnabled: z.boolean(),
        priority: z.number().int(),
      }),
    ),
    routes: z.array(
      z.strictObject({
        method: Method,
        path: z.string(),
        description: z.string().nullable(),
        cases: z.array(
          z.strictObject({
            name: z.string(),
            statusCode: z.number().int(),
            schema: MockSchemaEnvelope,
            headers: z.record(z.string(), z.string()),
            delayMs: z.number().int().nullable(),
            isDefault: z.boolean(),
          }),
        ),
      }),
    ),
  })
  .meta({ id: 'ProjectExport' })
export type ProjectExport = z.infer<typeof ProjectExport>

// ---------- version diff ----------

export const Change = z.strictObject({ field: z.string(), before: z.unknown(), after: z.unknown() })
export type Change = z.infer<typeof Change>

export const SchemaChange = z.strictObject({
  /** `$.address.city`; array elements as `[*]`. */
  path: z.string(),
  kind: z.enum(['added', 'removed', 'changed']),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
})
export type SchemaChange = z.infer<typeof SchemaChange>

const NameDiff = z.strictObject({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  changed: z.array(z.string()),
})
const RouteRef = z.strictObject({ method: Method, path: z.string() })
const CaseRef = z.strictObject({ name: z.string(), statusCode: z.number().int() })

export const VersionDiff = z
  .strictObject({
    from: z.strictObject({ id: Id, label: z.string() }),
    to: z.strictObject({ id: Id, label: z.string() }),
    settings: z.array(Change),
    components: NameDiff,
    presets: NameDiff,
    routes: z.strictObject({
      added: z.array(RouteRef),
      removed: z.array(RouteRef),
      changed: z.array(
        z.strictObject({
          method: Method,
          path: z.string(),
          fields: z.array(Change),
          cases: z.strictObject({
            added: z.array(CaseRef),
            removed: z.array(CaseRef),
            changed: z.array(
              z.strictObject({
                name: z.string(),
                fields: z.array(Change),
                schema: z.array(SchemaChange),
              }),
            ),
          }),
        }),
      ),
    }),
  })
  .meta({ id: 'VersionDiff' })
export type VersionDiff = z.infer<typeof VersionDiff>
