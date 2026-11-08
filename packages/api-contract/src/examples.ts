// Example payloads: used in the OpenAPI document, the docs, and the web app's MSW mock mode.
// Every example here is parsed against its own schema by the contract tests.
import type { PresetRule } from '@mockbench/schema-core'
import type {
  AuthState,
  Deployment,
  Member,
  Preset,
  Project,
  ProjectExport,
  RequestLogEntry,
  ResponseCase,
  Route,
  Snapshot,
  User,
  Version,
  VersionDiff,
  VersionSummary,
  Workspace,
} from './resources'
import { DEFAULT_PROJECT_SETTINGS } from './resources'

/** Deterministic, valid UUID v7-shaped ids for examples. */
export const exampleId = (n: number): string =>
  `0190a1b2-c3d4-7e5f-8a6b-${n.toString(16).padStart(12, '0')}`

export const EX_TS = '2026-11-05T08:30:00.000Z'
export const EX_TS_LATER = '2026-11-05T09:15:00.000Z'

export const EX = {
  user: exampleId(1),
  workspace: exampleId(2),
  member: exampleId(3),
  project: exampleId(4),
  route: exampleId(5),
  case: exampleId(6),
  case2: exampleId(7),
  preset: exampleId(8),
  version: exampleId(9),
  version2: exampleId(10),
  deployment: exampleId(11),
  log: exampleId(12),
} as const

export const exampleUser: User = {
  id: EX.user,
  email: 'dev@example.test',
  name: 'Dev Patel',
  createdAt: EX_TS,
}

export const exampleWorkspace: Workspace = {
  id: EX.workspace,
  name: 'Default',
  slug: 'default',
  role: 'owner',
  createdAt: EX_TS,
  updatedAt: EX_TS,
}

export const exampleAuthState: AuthState = { user: exampleUser, workspaces: [exampleWorkspace] }

export const exampleMember: Member = {
  id: EX.member,
  userId: EX.user,
  email: 'dev@example.test',
  name: 'Dev Patel',
  role: 'owner',
  createdAt: EX_TS,
}

/** A small MockSchema envelope used across the examples. */
export const exampleEnvelope = {
  version: 1 as const,
  components: {},
  root: {
    type: 'object' as const,
    fields: [
      { key: 'id', node: { type: 'uuid' as const } },
      { key: 'name', node: { type: 'string' as const } },
    ],
  },
}

export const exampleProject: Project = {
  id: EX.project,
  workspaceId: EX.workspace,
  name: 'Billing API',
  slug: 'billing-api',
  description: 'Invoices and payments for the ERP front end.',
  settings: { ...DEFAULT_PROJECT_SETTINGS },
  components: {},
  activeVersion: { id: EX.version, label: 'v1', deployedAt: EX_TS_LATER },
  routeCount: 1,
  caseCount: 2,
  createdAt: EX_TS,
  updatedAt: EX_TS,
}

export const exampleRoute: Route = {
  id: EX.route,
  projectId: EX.project,
  method: 'GET',
  path: '/invoices/:id',
  description: 'One invoice.',
  cases: [
    { id: EX.case, name: 'Found', statusCode: 200, isDefault: true },
    { id: EX.case2, name: 'Not found', statusCode: 404, isDefault: false },
  ],
  createdAt: EX_TS,
  updatedAt: EX_TS,
}

export const exampleCase: ResponseCase = {
  id: EX.case,
  routeId: EX.route,
  name: 'Found',
  statusCode: 200,
  schema: exampleEnvelope,
  headers: { 'Cache-Control': 'no-store' },
  delayMs: null,
  isDefault: true,
  createdAt: EX_TS,
  updatedAt: EX_TS,
}

export const exampleRules: PresetRule[] = [
  { match: { key: 'currency' }, value: 'INR' },
  { match: { key: 'role' }, values: ['admin', 'manager', 'viewer'] },
  { match: { key: '*_id', type: 'string' }, pattern: 'ID-{n:05}' },
]

export const examplePreset: Preset = {
  id: EX.preset,
  projectId: EX.project,
  name: 'Indian B2B (sample)',
  rules: exampleRules,
  isEnabled: true,
  priority: 10,
  createdAt: EX_TS,
  updatedAt: EX_TS,
}

export const exampleVersionSummary: VersionSummary = {
  id: EX.version,
  projectId: EX.project,
  seq: 1,
  label: 'v1',
  notes: null,
  createdBy: { id: EX.user, name: 'Dev Patel' },
  createdAt: EX_TS,
  routeCount: 1,
  caseCount: 2,
  bakedBytes: 412,
  isActive: true,
}

export const exampleSnapshot: Snapshot = {
  schemaVersion: 1,
  generatorVersion: 1,
  project: {
    id: EX.project,
    slug: 'billing-api',
    settings: { ...DEFAULT_PROJECT_SETTINGS },
    components: {},
  },
  routes: [
    {
      id: EX.route,
      method: 'GET',
      path: '/invoices/:id',
      description: 'One invoice.',
      cases: [
        {
          id: EX.case,
          name: 'Found',
          statusCode: 200,
          headers: {},
          delayMs: null,
          isDefault: true,
          schema: exampleEnvelope,
        },
      ],
    },
  ],
  presets: [{ id: EX.preset, name: 'Indian B2B (sample)', priority: 10, rules: exampleRules }],
}

export const exampleVersion: Version = { ...exampleVersionSummary, snapshot: exampleSnapshot }

export const exampleDeployment: Deployment = {
  id: EX.deployment,
  projectId: EX.project,
  versionId: EX.version,
  versionLabel: 'v1',
  deployedAt: EX_TS_LATER,
  deployedBy: { id: EX.user, name: 'Dev Patel' },
}

export const exampleLogEntry: RequestLogEntry = {
  id: EX.log,
  projectId: EX.project,
  createdAt: EX_TS_LATER,
  method: 'GET',
  path: '/invoices/42',
  query: {},
  statusCode: 200,
  durationMs: 3,
  routePattern: 'GET /invoices/:id',
  caseName: 'Found',
  versionId: EX.version,
  versionLabel: 'v1',
  mockError: null,
  requestHeaders: { accept: '*/*', authorization: '[redacted]' },
  ip: '192.168.1.31',
}

export const exampleExport: ProjectExport = {
  formatVersion: 1,
  project: {
    name: 'Billing API',
    slug: 'billing-api',
    description: 'Invoices and payments for the ERP front end.',
    settings: { ...DEFAULT_PROJECT_SETTINGS },
    components: {},
  },
  presets: [{ name: 'Indian B2B (sample)', rules: exampleRules, isEnabled: true, priority: 10 }],
  routes: [
    {
      method: 'GET',
      path: '/invoices/:id',
      description: 'One invoice.',
      cases: [
        {
          name: 'Found',
          statusCode: 200,
          schema: exampleEnvelope,
          headers: {},
          delayMs: null,
          isDefault: true,
        },
      ],
    },
  ],
}

export const exampleDiff: VersionDiff = {
  from: { id: EX.version, label: 'v1' },
  to: { id: EX.version2, label: 'v2' },
  settings: [],
  components: { added: [], removed: [], changed: [] },
  presets: { added: [], removed: [], changed: [] },
  routes: {
    added: [{ method: 'POST', path: '/invoices' }],
    removed: [],
    changed: [
      {
        method: 'GET',
        path: '/invoices/:id',
        fields: [],
        cases: {
          added: [{ name: 'Server error', statusCode: 500 }],
          removed: [],
          changed: [
            {
              name: 'Found',
              fields: [],
              schema: [{ path: '$.currency', kind: 'added', after: { type: 'string' } }],
            },
          ],
        },
      },
    ],
  },
}
