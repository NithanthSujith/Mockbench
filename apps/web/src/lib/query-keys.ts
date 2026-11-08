// Query-key factory. Keys are hierarchical so one `invalidateQueries({ queryKey })` can drop a whole
// scope: everything about a project lives under `['project', projectId, ...]`, so a publish can
// invalidate `qk.project(id).all` (DESIGN: "invalidateQueries keyed by project after a publish").
// Teams add keys here only through the main session; they use these functions, never literals.

export interface RequestLogFilters {
  status?: string
  method?: string
  path?: string
  since?: string
  mockError?: boolean
}

export const qk = {
  /** The signed-in user and their workspaces (`auth.me`). */
  session: () => ['session'] as const,
  /** `system.instance`: signup open? first run? */
  instance: () => ['instance'] as const,

  workspaces: () => ['workspaces'] as const,
  members: (workspaceId: string) => ['workspace', workspaceId, 'members'] as const,
  /** A workspace's project list. */
  projects: (workspaceId: string) => ['workspace', workspaceId, 'projects'] as const,

  /** A project looked up by its URL slug (the router loader's key). */
  projectBySlug: (slug: string) => ['project-by-slug', slug] as const,

  project: (projectId: string) => ({
    /** Prefix of every query about this project: invalidate it after a publish or deploy. */
    all: ['project', projectId] as const,
    detail: ['project', projectId, 'detail'] as const,
    routes: ['project', projectId, 'routes'] as const,
    presets: ['project', projectId, 'presets'] as const,
    versions: ['project', projectId, 'versions'] as const,
    deployments: ['project', projectId, 'deployments'] as const,
    requests: (filters: RequestLogFilters = {}) =>
      ['project', projectId, 'requests', filters] as const,
  }),

  route: (projectId: string, routeId: string) => ({
    all: ['project', projectId, 'route', routeId] as const,
    detail: ['project', projectId, 'route', routeId, 'detail'] as const,
    cases: ['project', projectId, 'route', routeId, 'cases'] as const,
    case: (caseId: string) => ['project', projectId, 'route', routeId, 'case', caseId] as const,
  }),

  version: (projectId: string, versionId: string) =>
    ['project', projectId, 'version', versionId] as const,
  versionDiff: (projectId: string, fromId: string, toId: string) =>
    ['project', projectId, 'version-diff', fromId, toId] as const,
}
