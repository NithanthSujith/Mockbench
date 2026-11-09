// The control-plane endpoints of docs/API-CONTRACT.md section 3, as an executable registry.
// Paths are relative to `/api/v1`. `pnpm contract:docs --check` compares this file with the doc.
// `errors` lists endpoint-specific codes only: global codes and the auth legend's implicit errors
// (401 unauthenticated, 403 forbidden, 404 not_found) are added by the OpenAPI layer.
import { z } from 'zod'
import {
  EX,
  exampleAuthState,
  exampleCase,
  exampleDeployment,
  exampleDiff,
  exampleEnvelope,
  exampleExport,
  exampleLogEntry,
  exampleMember,
  examplePreset,
  exampleProject,
  exampleRoute,
  exampleRules,
  exampleVersion,
  exampleVersionSummary,
  exampleWorkspace,
} from './examples'
import { PageQuery, Id, Slug, WorkspaceSlug, paginated } from './primitives'
import { defineEndpoint, defineRegistry } from './registry'
import {
  AuthState,
  Components,
  Deployment,
  JsonValue,
  Member,
  MockSchemaEnvelope,
  Preset,
  PresetPriority,
  PresetRules,
  Project,
  ProjectExport,
  ProjectSettingsInput,
  RequestLogEntry,
  ResponseCase,
  Route,
  Version,
  VersionDiff,
  VersionSummary,
  Workspace,
} from './resources'
import {
  CaseHeaders,
  CaseName,
  CaseStatusCodeField,
  DelayMs,
  DescriptionField,
  EmailField,
  LoginPassword,
  MethodField,
  NameField,
  PasswordField,
  Role,
  RoutePath,
} from './rules'
import { patchBody } from './validation'

// ---------- shared params ----------

const workspaceParams = z.strictObject({ workspaceId: Id })
const projectParams = z.strictObject({ projectId: Id })
const routeParams = z.strictObject({ routeId: Id })
const caseParams = z.strictObject({ caseId: Id })
const presetParams = z.strictObject({ presetId: Id })
const versionParams = z.strictObject({ versionId: Id })

const unpaginated = <T>(items: T[]) => ({ items, nextCursor: null })

// ---------- system ----------

const system = {
  instance: defineEndpoint({
    id: 'system.instance',
    method: 'GET',
    path: '/instance',
    auth: 'public',
    summary: 'Instance info for the login screen',
    responses: {
      200: z.strictObject({
        name: z.literal('Mockbench'),
        version: z.string(),
        allowSignup: z.boolean(),
        setupRequired: z.boolean(),
      }),
    },
    errors: [],
    example: {
      response: { name: 'Mockbench', version: '0.1.0', allowSignup: true, setupRequired: false },
    },
    tags: ['system'],
  }),
  healthz: defineEndpoint({
    id: 'system.healthz',
    method: 'GET',
    path: '/healthz',
    alsoAtRoot: true,
    auth: 'public',
    summary: 'Liveness',
    responses: { 200: z.strictObject({ status: z.literal('ok') }) },
    errors: [],
    example: { response: { status: 'ok' } },
    tags: ['system'],
  }),
  readyz: defineEndpoint({
    id: 'system.readyz',
    method: 'GET',
    path: '/readyz',
    alsoAtRoot: true,
    auth: 'public',
    summary: 'Readiness (checks the database)',
    responses: { 200: z.strictObject({ status: z.literal('ok'), db: z.literal('up') }) },
    errors: [{ status: 503, code: 'not_ready' }],
    example: { response: { status: 'ok', db: 'up' } },
    tags: ['system'],
  }),
  openapi: defineEndpoint({
    id: 'system.openapi',
    method: 'GET',
    path: '/openapi.json',
    auth: 'public',
    summary: 'OpenAPI 3.1 document for the control plane',
    responses: { 200: z.record(z.string(), z.unknown()) },
    errors: [],
    example: { response: { openapi: '3.1.0', info: { title: 'Mockbench control-plane API' } } },
    tags: ['system'],
  }),
}

// ---------- auth ----------

const auth = {
  register: defineEndpoint({
    id: 'auth.register',
    method: 'POST',
    path: '/auth/register',
    auth: 'public',
    summary: 'Create an account and sign in',
    body: z.strictObject({ email: EmailField, password: PasswordField, name: NameField }),
    responses: { 201: AuthState },
    errors: [
      { status: 403, code: 'signup_disabled' },
      { status: 409, code: 'email_taken' },
    ],
    example: {
      request: { email: 'dev@example.test', password: 'correct horse battery', name: 'Dev Patel' },
      response: exampleAuthState,
    },
    tags: ['auth'],
  }),
  login: defineEndpoint({
    id: 'auth.login',
    method: 'POST',
    path: '/auth/login',
    auth: 'public',
    summary: 'Sign in',
    body: z.strictObject({ email: EmailField, password: LoginPassword }),
    responses: { 200: AuthState },
    errors: [{ status: 401, code: 'invalid_credentials' }],
    example: {
      request: { email: 'dev@example.test', password: 'correct horse battery' },
      response: exampleAuthState,
    },
    tags: ['auth'],
  }),
  logout: defineEndpoint({
    id: 'auth.logout',
    method: 'POST',
    path: '/auth/logout',
    auth: 'public',
    summary: 'Sign out (idempotent)',
    responses: { 204: null },
    errors: [],
    example: {},
    tags: ['auth'],
  }),
  me: defineEndpoint({
    id: 'auth.me',
    method: 'GET',
    path: '/auth/me',
    auth: 'session',
    summary: 'The signed-in user and their workspaces',
    responses: { 200: AuthState },
    errors: [],
    example: { response: exampleAuthState },
    tags: ['auth'],
  }),
  changePassword: defineEndpoint({
    id: 'auth.changePassword',
    method: 'POST',
    path: '/auth/password',
    auth: 'session',
    summary: 'Change password (revokes other sessions)',
    body: z.strictObject({ currentPassword: LoginPassword, newPassword: PasswordField }),
    responses: { 204: null },
    errors: [{ status: 403, code: 'wrong_password' }],
    example: {
      request: {
        currentPassword: 'correct horse battery',
        newPassword: 'a much longer passphrase',
      },
    },
    tags: ['auth'],
  }),
}

// ---------- workspaces and members ----------

const workspaces = {
  list: defineEndpoint({
    id: 'workspaces.list',
    method: 'GET',
    path: '/workspaces',
    auth: 'session',
    summary: "The caller's workspaces",
    responses: { 200: paginated(Workspace) },
    errors: [],
    example: { response: unpaginated([exampleWorkspace]) },
    tags: ['workspaces'],
  }),
  create: defineEndpoint({
    id: 'workspaces.create',
    method: 'POST',
    path: '/workspaces',
    auth: 'session',
    summary: 'Create a workspace (the caller becomes owner)',
    body: z.strictObject({ name: NameField, slug: WorkspaceSlug.optional() }),
    responses: { 201: Workspace },
    errors: [{ status: 409, code: 'slug_taken' }],
    example: { request: { name: 'Default' }, response: exampleWorkspace },
    tags: ['workspaces'],
  }),
  get: defineEndpoint({
    id: 'workspaces.get',
    method: 'GET',
    path: '/workspaces/:workspaceId',
    auth: 'viewer',
    summary: 'One workspace',
    params: workspaceParams,
    responses: { 200: Workspace },
    errors: [],
    example: { response: exampleWorkspace },
    tags: ['workspaces'],
  }),
  update: defineEndpoint({
    id: 'workspaces.update',
    method: 'PATCH',
    path: '/workspaces/:workspaceId',
    auth: 'owner',
    summary: 'Rename a workspace (the slug is read-only)',
    params: workspaceParams,
    body: patchBody({ name: NameField }, ['slug']),
    responses: { 200: Workspace },
    errors: [],
    example: { request: { name: 'Alps Chemicals' }, response: exampleWorkspace },
    tags: ['workspaces'],
  }),
  delete: defineEndpoint({
    id: 'workspaces.delete',
    method: 'DELETE',
    path: '/workspaces/:workspaceId',
    auth: 'owner',
    summary: 'Delete an empty workspace',
    params: workspaceParams,
    responses: { 204: null },
    errors: [{ status: 409, code: 'workspace_not_empty' }],
    example: {},
    tags: ['workspaces'],
  }),
}

const members = {
  list: defineEndpoint({
    id: 'members.list',
    method: 'GET',
    path: '/workspaces/:workspaceId/members',
    auth: 'viewer',
    summary: 'Members of a workspace',
    params: workspaceParams,
    responses: { 200: paginated(Member) },
    errors: [],
    example: { response: unpaginated([exampleMember]) },
    tags: ['members'],
  }),
  add: defineEndpoint({
    id: 'members.add',
    method: 'POST',
    path: '/workspaces/:workspaceId/members',
    auth: 'owner',
    summary: 'Add an existing user by email',
    params: workspaceParams,
    body: z.strictObject({ email: EmailField, role: Role }),
    responses: { 201: Member },
    errors: [
      { status: 404, code: 'user_not_found' },
      { status: 409, code: 'already_member' },
    ],
    example: { request: { email: 'dev@example.test', role: 'editor' }, response: exampleMember },
    tags: ['members'],
  }),
  update: defineEndpoint({
    id: 'members.update',
    method: 'PATCH',
    path: '/workspaces/:workspaceId/members/:memberId',
    auth: 'owner',
    summary: "Change a member's role",
    params: z.strictObject({ workspaceId: Id, memberId: Id }),
    body: patchBody({ role: Role }),
    responses: { 200: Member },
    errors: [{ status: 409, code: 'last_owner' }],
    example: { request: { role: 'viewer' }, response: exampleMember },
    tags: ['members'],
  }),
  remove: defineEndpoint({
    id: 'members.remove',
    method: 'DELETE',
    path: '/workspaces/:workspaceId/members/:memberId',
    auth: 'owner',
    summary: 'Remove a member (any member may remove their own membership)',
    params: z.strictObject({ workspaceId: Id, memberId: Id }),
    responses: { 204: null },
    errors: [{ status: 409, code: 'last_owner' }],
    example: {},
    tags: ['members'],
  }),
}

// ---------- projects ----------

const projects = {
  list: defineEndpoint({
    id: 'projects.list',
    method: 'GET',
    path: '/projects',
    auth: 'viewer',
    summary: "A workspace's projects, oldest first",
    query: PageQuery.extend({ workspaceId: Id }),
    responses: { 200: paginated(Project) },
    errors: [{ status: 400, code: 'invalid_cursor' }],
    example: { response: { items: [exampleProject], nextCursor: null } },
    tags: ['projects'],
  }),
  create: defineEndpoint({
    id: 'projects.create',
    method: 'POST',
    path: '/projects',
    auth: 'editor',
    summary: 'Create a project',
    body: z.strictObject({
      workspaceId: Id,
      name: NameField,
      slug: Slug,
      description: DescriptionField.optional(),
      settings: ProjectSettingsInput.optional(),
    }),
    responses: { 201: Project },
    errors: [
      { status: 409, code: 'slug_taken' },
      { status: 422, code: 'slug_reserved' },
    ],
    example: {
      request: { workspaceId: EX.workspace, name: 'Billing API', slug: 'billing-api' },
      response: exampleProject,
    },
    tags: ['projects'],
  }),
  getBySlug: defineEndpoint({
    id: 'projects.getBySlug',
    method: 'GET',
    path: '/projects/by-slug/:slug',
    auth: 'viewer',
    summary: 'One project by its slug',
    params: z.strictObject({ slug: z.string().min(1).max(64) }),
    responses: { 200: Project },
    errors: [],
    example: { response: exampleProject },
    tags: ['projects'],
  }),
  get: defineEndpoint({
    id: 'projects.get',
    method: 'GET',
    path: '/projects/:projectId',
    auth: 'viewer',
    summary: 'One project',
    params: projectParams,
    responses: { 200: Project },
    errors: [],
    example: { response: exampleProject },
    tags: ['projects'],
  }),
  update: defineEndpoint({
    id: 'projects.update',
    method: 'PATCH',
    path: '/projects/:projectId',
    auth: 'editor',
    summary: 'Edit name, description, settings (merged per key) or components (replaced)',
    params: projectParams,
    body: patchBody(
      {
        name: NameField,
        description: DescriptionField.nullable(),
        settings: ProjectSettingsInput,
        components: Components,
      },
      ['slug', 'workspaceId'],
    ),
    responses: { 200: Project },
    errors: [],
    example: { request: { settings: { mode: 'seeded' } }, response: exampleProject },
    tags: ['projects'],
  }),
  delete: defineEndpoint({
    id: 'projects.delete',
    method: 'DELETE',
    path: '/projects/:projectId',
    auth: 'owner',
    summary: 'Delete a project and everything in it',
    params: projectParams,
    responses: { 204: null },
    errors: [],
    example: {},
    tags: ['projects'],
  }),
  export: defineEndpoint({
    id: 'projects.export',
    method: 'GET',
    path: '/projects/:projectId/export',
    auth: 'viewer',
    summary: 'Download the draft and presets as one JSON file',
    params: projectParams,
    responses: { 200: ProjectExport },
    errors: [],
    example: { response: exampleExport },
    tags: ['projects'],
  }),
  import: defineEndpoint({
    id: 'projects.import',
    method: 'POST',
    path: '/projects/import',
    auth: 'editor',
    summary: 'Create a project from an export file',
    body: z.strictObject({
      workspaceId: Id,
      document: ProjectExport,
      slug: Slug.optional(),
      name: NameField.optional(),
    }),
    responses: { 201: Project },
    errors: [
      { status: 409, code: 'slug_taken' },
      { status: 422, code: 'import_invalid' },
      { status: 422, code: 'slug_reserved' },
    ],
    example: {
      request: { workspaceId: EX.workspace, document: exampleExport },
      response: exampleProject,
    },
    tags: ['projects'],
  }),
}

// ---------- presets ----------

const presets = {
  list: defineEndpoint({
    id: 'presets.list',
    method: 'GET',
    path: '/projects/:projectId/presets',
    auth: 'viewer',
    summary: "A project's presets",
    params: projectParams,
    responses: { 200: paginated(Preset) },
    errors: [],
    example: { response: unpaginated([examplePreset]) },
    tags: ['presets'],
  }),
  create: defineEndpoint({
    id: 'presets.create',
    method: 'POST',
    path: '/projects/:projectId/presets',
    auth: 'editor',
    summary: 'Create a preset',
    params: projectParams,
    body: z.strictObject({
      name: NameField,
      rules: PresetRules,
      isEnabled: z.boolean().optional(),
      priority: PresetPriority.optional(),
    }),
    responses: { 201: Preset },
    errors: [],
    example: {
      request: { name: 'Indian B2B (sample)', rules: exampleRules, priority: 10 },
      response: examplePreset,
    },
    tags: ['presets'],
  }),
  update: defineEndpoint({
    id: 'presets.update',
    method: 'PATCH',
    path: '/presets/:presetId',
    auth: 'editor',
    summary: 'Edit a preset (rules are replaced wholesale)',
    params: presetParams,
    body: patchBody({
      name: NameField,
      rules: PresetRules,
      isEnabled: z.boolean(),
      priority: PresetPriority,
    }),
    responses: { 200: Preset },
    errors: [],
    example: { request: { isEnabled: false }, response: examplePreset },
    tags: ['presets'],
  }),
  delete: defineEndpoint({
    id: 'presets.delete',
    method: 'DELETE',
    path: '/presets/:presetId',
    auth: 'editor',
    summary: 'Delete a preset',
    params: presetParams,
    responses: { 204: null },
    errors: [],
    example: {},
    tags: ['presets'],
  }),
}

// ---------- routes ----------

const routes = {
  list: defineEndpoint({
    id: 'routes.list',
    method: 'GET',
    path: '/projects/:projectId/routes',
    auth: 'viewer',
    summary: "A project's routes in creation order, with case summaries",
    params: projectParams,
    responses: { 200: paginated(Route) },
    errors: [],
    example: { response: unpaginated([exampleRoute]) },
    tags: ['routes'],
  }),
  create: defineEndpoint({
    id: 'routes.create',
    method: 'POST',
    path: '/projects/:projectId/routes',
    auth: 'editor',
    summary: 'Create a route with its default case "OK"',
    params: projectParams,
    body: z.strictObject({
      method: MethodField,
      path: RoutePath,
      description: DescriptionField.optional(),
    }),
    responses: { 201: Route },
    errors: [{ status: 409, code: 'route_conflict' }],
    example: {
      request: { method: 'GET', path: '/invoices/:id', description: 'One invoice.' },
      response: exampleRoute,
    },
    tags: ['routes'],
  }),
  get: defineEndpoint({
    id: 'routes.get',
    method: 'GET',
    path: '/routes/:routeId',
    auth: 'viewer',
    summary: 'One route',
    params: routeParams,
    responses: { 200: Route },
    errors: [],
    example: { response: exampleRoute },
    tags: ['routes'],
  }),
  update: defineEndpoint({
    id: 'routes.update',
    method: 'PATCH',
    path: '/routes/:routeId',
    auth: 'editor',
    summary: 'Edit method, path or description',
    params: routeParams,
    body: patchBody({
      method: MethodField,
      path: RoutePath,
      description: DescriptionField.nullable(),
    }),
    responses: { 200: Route },
    errors: [{ status: 409, code: 'route_conflict' }],
    example: { request: { path: '/accounts/:id' }, response: exampleRoute },
    tags: ['routes'],
  }),
  delete: defineEndpoint({
    id: 'routes.delete',
    method: 'DELETE',
    path: '/routes/:routeId',
    auth: 'editor',
    summary: 'Delete a route and its cases',
    params: routeParams,
    responses: { 204: null },
    errors: [],
    example: {},
    tags: ['routes'],
  }),
  duplicate: defineEndpoint({
    id: 'routes.duplicate',
    method: 'POST',
    path: '/routes/:routeId/duplicate',
    auth: 'editor',
    summary: 'Deep-copy a route (the server derives a free path when none is given)',
    params: routeParams,
    body: z.strictObject({ method: MethodField.optional(), path: RoutePath.optional() }),
    responses: { 201: Route },
    errors: [{ status: 409, code: 'route_conflict' }],
    example: { request: {}, response: exampleRoute },
    tags: ['routes'],
  }),
}

// ---------- cases ----------

const cases = {
  list: defineEndpoint({
    id: 'cases.list',
    method: 'GET',
    path: '/routes/:routeId/cases',
    auth: 'viewer',
    summary: "A route's response cases",
    params: routeParams,
    responses: { 200: paginated(ResponseCase) },
    errors: [],
    example: { response: unpaginated([exampleCase]) },
    tags: ['cases'],
  }),
  create: defineEndpoint({
    id: 'cases.create',
    method: 'POST',
    path: '/routes/:routeId/cases',
    auth: 'editor',
    summary: 'Add a response case',
    params: routeParams,
    body: z.strictObject({
      name: CaseName,
      statusCode: CaseStatusCodeField,
      schema: MockSchemaEnvelope.optional(),
      headers: CaseHeaders.optional(),
      delayMs: DelayMs.nullable().optional(),
      isDefault: z.boolean().optional(),
    }),
    responses: { 201: ResponseCase },
    errors: [{ status: 409, code: 'case_name_taken' }],
    example: {
      request: { name: 'Not found', statusCode: 404, schema: exampleEnvelope },
      response: exampleCase,
    },
    tags: ['cases'],
  }),
  get: defineEndpoint({
    id: 'cases.get',
    method: 'GET',
    path: '/cases/:caseId',
    auth: 'viewer',
    summary: 'One response case',
    params: caseParams,
    responses: { 200: ResponseCase },
    errors: [],
    example: { response: exampleCase },
    tags: ['cases'],
  }),
  update: defineEndpoint({
    id: 'cases.update',
    method: 'PATCH',
    path: '/cases/:caseId',
    auth: 'editor',
    summary: 'Edit a case (schema and headers are replaced wholesale; isDefault is read-only)',
    params: caseParams,
    body: patchBody(
      {
        name: CaseName,
        statusCode: CaseStatusCodeField,
        schema: MockSchemaEnvelope,
        headers: CaseHeaders,
        delayMs: DelayMs.nullable(),
      },
      ['isDefault'],
    ),
    responses: { 200: ResponseCase },
    errors: [{ status: 409, code: 'case_name_taken' }],
    example: { request: { statusCode: 201 }, response: exampleCase },
    tags: ['cases'],
  }),
  delete: defineEndpoint({
    id: 'cases.delete',
    method: 'DELETE',
    path: '/cases/:caseId',
    auth: 'editor',
    summary: 'Delete a non-default case',
    params: caseParams,
    responses: { 204: null },
    errors: [{ status: 409, code: 'case_is_default' }],
    example: {},
    tags: ['cases'],
  }),
  setDefault: defineEndpoint({
    id: 'cases.setDefault',
    method: 'POST',
    path: '/cases/:caseId/default',
    auth: 'editor',
    summary: "Make this the route's default case (idempotent)",
    params: caseParams,
    responses: { 200: ResponseCase },
    errors: [],
    example: { response: exampleCase },
    tags: ['cases'],
  }),
}

// ---------- schema helpers ----------

const schema = {
  infer: defineEndpoint({
    id: 'schema.infer',
    method: 'POST',
    path: '/schema/infer',
    auth: 'session',
    summary: 'Infer a MockSchema from a JSON sample (stateless)',
    body: z.strictObject({ sample: JsonValue }),
    responses: {
      200: z.strictObject({
        schema: MockSchemaEnvelope,
        warnings: z.array(
          z.strictObject({ path: z.string(), code: z.string(), message: z.string() }),
        ),
      }),
    },
    errors: [],
    example: {
      request: { sample: { id: 'abc', name: 'Dev' } },
      response: { schema: exampleEnvelope, warnings: [] },
    },
    tags: ['schema'],
  }),
  preview: defineEndpoint({
    id: 'schema.preview',
    method: 'POST',
    path: '/schema/preview',
    auth: 'session',
    summary: 'Generate the JSON body for a MockSchema (stateless)',
    body: z.strictObject({
      schema: MockSchemaEnvelope,
      settings: ProjectSettingsInput.optional(),
      components: Components.optional(),
      presets: z
        .array(z.strictObject({ rules: PresetRules, priority: PresetPriority.optional() }))
        .optional(),
      projectId: Id.optional(),
    }),
    responses: { 200: z.strictObject({ json: z.string(), generatorVersion: z.number().int() }) },
    errors: [],
    example: {
      request: { schema: exampleEnvelope, settings: { indexing: 'local' } },
      response: {
        json: '{\n  "id": "8c1f0e2a-5b43-5c9d-9f12-6a7b8c9d0e1f",\n  "name": "name-1"\n}',
        generatorVersion: 1,
      },
    },
    tags: ['schema'],
  }),
}

// ---------- versions, deploy, cache ----------

const versions = {
  list: defineEndpoint({
    id: 'versions.list',
    method: 'GET',
    path: '/projects/:projectId/versions',
    auth: 'viewer',
    summary: "A project's versions, newest first",
    params: projectParams,
    query: PageQuery,
    responses: { 200: paginated(VersionSummary) },
    errors: [{ status: 400, code: 'invalid_cursor' }],
    example: { response: { items: [exampleVersionSummary], nextCursor: null } },
    tags: ['versions'],
  }),
  publish: defineEndpoint({
    id: 'versions.publish',
    method: 'POST',
    path: '/projects/:projectId/versions',
    auth: 'editor',
    summary: 'Publish the draft as an immutable version (does not deploy)',
    params: projectParams,
    body: z.strictObject({
      label: z.string().trim().min(1).max(80).optional(),
      notes: z.string().max(2000).optional(),
    }),
    responses: { 201: Version },
    errors: [
      { status: 409, code: 'label_taken' },
      { status: 422, code: 'empty_project' },
      { status: 422, code: 'publish_invalid' },
    ],
    example: { request: { label: 'first-cut' }, response: exampleVersion },
    tags: ['versions'],
  }),
  get: defineEndpoint({
    id: 'versions.get',
    method: 'GET',
    path: '/versions/:versionId',
    auth: 'viewer',
    summary: 'One version with its snapshot',
    params: versionParams,
    responses: { 200: Version },
    errors: [],
    example: { response: exampleVersion },
    tags: ['versions'],
  }),
  delete: defineEndpoint({
    id: 'versions.delete',
    method: 'DELETE',
    path: '/versions/:versionId',
    auth: 'editor',
    summary: 'Delete an inactive, unreferenced version',
    params: versionParams,
    responses: { 204: null },
    errors: [
      { status: 409, code: 'version_active' },
      { status: 409, code: 'version_referenced' },
    ],
    example: {},
    tags: ['versions'],
  }),
  diff: defineEndpoint({
    id: 'versions.diff',
    method: 'GET',
    path: '/versions/:fromId/diff/:toId',
    auth: 'viewer',
    summary: 'Compare two versions of one project',
    params: z.strictObject({ fromId: Id, toId: Id }),
    responses: { 200: VersionDiff },
    errors: [{ status: 422, code: 'versions_different_projects' }],
    example: { response: exampleDiff },
    tags: ['versions'],
  }),
}

const deploy = {
  create: defineEndpoint({
    id: 'deploy.create',
    method: 'POST',
    path: '/projects/:projectId/deploy',
    auth: 'editor',
    summary: 'Make a version live (rollback is the same call with an older version)',
    params: projectParams,
    body: z.strictObject({ versionId: Id }),
    responses: { 200: Deployment },
    errors: [{ status: 404, code: 'version_not_found' }],
    example: { request: { versionId: EX.version }, response: exampleDeployment },
    tags: ['deploy'],
  }),
}

const deployments = {
  list: defineEndpoint({
    id: 'deployments.list',
    method: 'GET',
    path: '/projects/:projectId/deployments',
    auth: 'viewer',
    summary: 'Deploy history, newest first',
    params: projectParams,
    query: PageQuery,
    responses: { 200: paginated(Deployment) },
    errors: [{ status: 400, code: 'invalid_cursor' }],
    example: { response: { items: [exampleDeployment], nextCursor: null } },
    tags: ['deployments'],
  }),
}

const cache = {
  flush: defineEndpoint({
    id: 'cache.flush',
    method: 'POST',
    path: '/projects/:projectId/cache/flush',
    auth: 'editor',
    summary: "Drop this project's data-plane cache entry on this instance",
    params: projectParams,
    responses: { 204: null },
    errors: [],
    example: {},
    tags: ['cache'],
  }),
}

// ---------- request log ----------

const requests = {
  list: defineEndpoint({
    id: 'requests.list',
    method: 'GET',
    path: '/projects/:projectId/requests',
    auth: 'viewer',
    summary: 'Recent requests to the project, newest first',
    params: projectParams,
    query: PageQuery.extend({
      /** `200`, or a class: `2xx`, `4xx`, `5xx`. */
      status: z
        .string()
        .regex(/^([1-5][0-9]{2}|[1-5]xx)$/, 'a status code like 404, or a class like 4xx')
        .optional(),
      method: z
        .string()
        .regex(/^[A-Za-z]{3,10}$/)
        .optional(),
      /** Case-insensitive substring of the request path. */
      path: z.string().min(1).max(200).optional(),
      since: z.iso.datetime({ offset: true }).optional(),
      /** `true` = only responses generated by the mock server itself. */
      mockError: z.enum(['true', 'false']).optional(),
    }),
    responses: { 200: paginated(RequestLogEntry) },
    errors: [{ status: 400, code: 'invalid_cursor' }],
    example: { response: { items: [exampleLogEntry], nextCursor: null } },
    tags: ['requests'],
  }),
}

// ---------- the registry ----------

/** Endpoints grouped by area (the id prefix), so `AreaHandlers<typeof registry, 'auth'>` lines up. */
export const endpoints = {
  system,
  auth,
  workspaces,
  members,
  projects,
  presets,
  routes,
  cases,
  schema,
  versions,
  deploy,
  deployments,
  cache,
  requests,
} as const

export const registry = defineRegistry([
  ...Object.values(system),
  ...Object.values(auth),
  ...Object.values(workspaces),
  ...Object.values(members),
  ...Object.values(projects),
  ...Object.values(presets),
  ...Object.values(routes),
  ...Object.values(cases),
  ...Object.values(schema),
  ...Object.values(versions),
  ...Object.values(deploy),
  ...Object.values(deployments),
  ...Object.values(cache),
  ...Object.values(requests),
] as const)
