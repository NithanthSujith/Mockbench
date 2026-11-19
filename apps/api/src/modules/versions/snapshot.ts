// RUN-01: turns a project's draft into a validated, self-contained snapshot plus baked payloads.
// Pure service: no HTTP, no transaction/label/sequence logic (RUN-02 owns those), no caching.
import { DEFAULT_PROJECT_SETTINGS, ProjectSettings } from '@mockbench/api-contract'
import type { Snapshot } from '@mockbench/api-contract'
import {
  GENERATOR_VERSION,
  buildPresetResolver,
  generate,
  validateSchema,
} from '@mockbench/schema-core'
import type { MockNode, MockSchema, ResolvedPreset } from '@mockbench/schema-core'
import { sql } from 'drizzle-orm'
import type { Db } from '../../db/client'

/** The executor RUN-02 passes in: a Drizzle transaction (or the db itself in tests). */
export type Tx = Pick<Db, 'execute'>

export type PublishIssueDetail = { path: (string | number)[]; code: string; message: string }

/** One offending case (API-CONTRACT 3.9, `publish_invalid` details). */
export interface PublishIssue {
  routeId: string
  method: string
  path: string
  /** Null only for the (should-be-impossible) route that has no cases at all. */
  caseId: string | null
  caseName: string | null
  issues: PublishIssueDetail[]
}

/** The draft failed validation. Nothing was baked and no version should be created. */
export class PublishInvalidError extends Error {
  readonly details: PublishIssue[]
  constructor(details: PublishIssue[]) {
    super(`${details.length} case${details.length === 1 ? '' : 's'} failed validation`)
    this.name = 'PublishInvalidError'
    this.details = details
  }
}

/** Total size limit for one version's baked payload (ADR 0017, ADR 0021): 64 MiB, not configurable. */
export const MAX_BAKED_BYTES = 64 * 1024 * 1024
/** How many of the largest cases a `baked_too_large` error lists. */
export const BAKED_TOO_LARGE_LISTED = 10

/** One case in `baked_too_large` details (API-CONTRACT 3.9). `bytes`: UTF-8 length of its body. */
export interface BakedCaseSize {
  routeId: string
  method: string
  path: string
  caseId: string
  caseName: string
  bytes: number
}

/** The baked payload would exceed `MAX_BAKED_BYTES`. Nothing was stored. */
export class BakedTooLargeError extends Error {
  constructor(
    readonly totalBytes: number,
    readonly limitBytes: number,
    /** The largest cases, largest first, at most `BAKED_TOO_LARGE_LISTED`. */
    readonly largest: BakedCaseSize[],
    /** The most body bytes held in memory at once while baking (bounded by the limit plus one case). */
    readonly retainedBytes: number,
  ) {
    super(`Baked payload of ${totalBytes} bytes exceeds the ${limitBytes}-byte limit`)
    this.name = 'BakedTooLargeError'
  }
}

/** Keeps the `limit` largest entries, largest first; ties keep the earlier case first. */
function keepLargest(list: BakedCaseSize[], entry: BakedCaseSize, limit: number): void {
  if (list.length === limit && entry.bytes <= list[list.length - 1]!.bytes) return
  let i = list.length
  while (i > 0 && list[i - 1]!.bytes < entry.bytes) i--
  list.splice(i, 0, entry)
  if (list.length > limit) list.pop()
}

/** The project has no routes, so there is nothing to publish. */
export class EmptyProjectError extends Error {
  constructor() {
    super('The project has no routes')
    this.name = 'EmptyProjectError'
  }
}

/** The project does not exist (callers authorise first, so this is a race with deletion). */
export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} not found`)
    this.name = 'ProjectNotFoundError'
  }
}

export interface VersionPayload {
  snapshot: Snapshot
  /** JSON text of `{ "<routeId>:<caseId>": "<body>" }`, or null in `random` mode (nothing is baked). */
  baked: string | null
  routeCount: number
  caseCount: number
  snapshotBytes: number
  bakedBytes: number
}

type DraftRoute = Snapshot['routes'][number]
interface Draft {
  project: { id: string; slug: string; settings: unknown; components: Record<string, MockNode> }
  routes: DraftRoute[]
  presets: Snapshot['presets']
}

/**
 * Reads the project, its routes (sortOrder), their cases (sortOrder) and its ENABLED presets
 * (priority desc, then creation order) in ONE statement, so the result is internally consistent even
 * at READ COMMITTED. RUN-02 should still open the publish transaction at REPEATABLE READ so the
 * snapshot also matches everything else it reads in that transaction.
 */
async function loadDraft(tx: Tx, projectId: string): Promise<Draft | null> {
  const result = await tx.execute(sql`
    select
      (select jsonb_build_object('id', p.id, 'slug', p.slug, 'settings', p.settings,
                                 'components', p.components)
         from projects p where p.id = ${projectId}) as project,
      coalesce((
        select jsonb_agg(x.route order by x.sort_order, x.id)
        from (
          select r.id, r.sort_order,
            jsonb_build_object(
              'id', r.id, 'method', r.method, 'path', r.path, 'description', r.description,
              'cases', coalesce((
                select jsonb_agg(
                  jsonb_build_object('id', c.id, 'name', c.name, 'statusCode', c.status_code,
                                     'headers', c.headers, 'delayMs', c.delay_ms,
                                     'isDefault', c.is_default, 'schema', c.schema)
                  order by c.sort_order, c.id)
                from response_cases c where c.route_id = r.id), '[]'::jsonb)) as route
          from routes r where r.project_id = ${projectId}
        ) x), '[]'::jsonb) as routes,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'priority', d.priority,
                                            'rules', d.rules)
                         order by d.priority desc, d.created_at, d.id)
        from data_presets d where d.project_id = ${projectId} and d.is_enabled), '[]'::jsonb) as presets
  `)
  const row = result.rows[0] as
    | { project: Draft['project'] | null; routes: DraftRoute[]; presets: Draft['presets'] }
    | undefined
  if (!row?.project) return null
  return { project: row.project, routes: row.routes, presets: row.presets }
}

function bake(
  schema: MockSchema,
  ctx: Parameters<typeof generate>[1],
): { body: string } | { issue: PublishIssueDetail } {
  try {
    return { body: generate(schema, ctx).json }
  } catch (error) {
    // A schema that passed validateSchema should never get here; report it as a publish problem
    // rather than letting a 500 escape.
    const e = error as Error & { code?: string }
    return { issue: { path: [], code: e.code ?? 'bake_failed', message: e.message } }
  }
}

export interface BuildVersionOptions {
  /** Test-only override of `MAX_BAKED_BYTES`, so tests need not bake 64 MiB. */
  maxBakedBytes?: number
}

/**
 * Builds the payload for one publish. Throws `EmptyProjectError` (no routes), `PublishInvalidError`
 * (every offending case listed, nothing baked), `BakedTooLargeError` (over the total cap; an
 * invalid case takes precedence) or `ProjectNotFoundError`.
 */
export async function buildVersionPayload(
  tx: Tx,
  projectId: string,
  opts: BuildVersionOptions = {},
): Promise<VersionPayload> {
  const maxBakedBytes = opts.maxBakedBytes ?? MAX_BAKED_BYTES
  const draft = await loadDraft(tx, projectId)
  if (!draft) throw new ProjectNotFoundError(projectId)
  if (draft.routes.length === 0) throw new EmptyProjectError()

  const settings: ProjectSettings = ProjectSettings.parse({
    ...DEFAULT_PROJECT_SETTINGS,
    ...(draft.project.settings as object),
  })
  const components = draft.project.components ?? {}

  // 1. Validate every case; collect ALL failures.
  const failures: PublishIssue[] = []
  for (const route of draft.routes) {
    if (route.cases.length === 0) {
      failures.push({
        routeId: route.id,
        method: route.method,
        path: route.path,
        caseId: null,
        caseName: null,
        issues: [
          { path: [], code: 'route_has_no_cases', message: 'The route has no response cases' },
        ],
      })
    }
    for (const c of route.cases) {
      const result = validateSchema(c.schema, { components })
      if (!result.ok) {
        failures.push({
          routeId: route.id,
          method: route.method,
          path: route.path,
          caseId: c.id,
          caseName: c.name,
          issues: result.issues.map((i) => ({ path: i.path, code: i.code, message: i.message })),
        })
      }
    }
  }
  if (failures.length > 0) throw new PublishInvalidError(failures)

  const snapshot: Snapshot = {
    schemaVersion: 1,
    generatorVersion: GENERATOR_VERSION,
    project: { id: draft.project.id, slug: draft.project.slug, settings, components },
    routes: draft.routes,
    presets: draft.presets,
  }

  // 2. Bake (not in random mode, which generates per request).
  let baked: string | null = null
  if (settings.mode !== 'random') {
    const resolver = buildPresetResolver(
      snapshot.presets.map((p): ResolvedPreset => ({ priority: p.priority, rules: p.rules })),
    )
    const ctx: Parameters<typeof generate>[1] = {
      projectId: snapshot.project.id,
      settings: { indexing: settings.indexing, mode: settings.mode },
      components,
      presets: resolver,
    }
    const bodies: Record<string, string> = {}
    const bakeFailures: PublishIssue[] = []
    // Exact size of JSON.stringify(bodies): braces, commas, and each `"key":"body"` entry. Once it
    // passes the cap, bodies are no longer kept (only measured), so memory stays bounded.
    let totalBytes = 2
    let entries = 0
    let retained = 0
    let peakRetained = 0
    let over = false
    const largest: BakedCaseSize[] = []
    const record = (
      route: DraftRoute,
      c: DraftRoute['cases'][number],
      key: string,
      body: string,
    ) => {
      totalBytes +=
        (entries++ > 0 ? 1 : 0) +
        Buffer.byteLength(JSON.stringify(key), 'utf8') +
        1 +
        Buffer.byteLength(JSON.stringify(body), 'utf8')
      const bytes = Buffer.byteLength(body, 'utf8')
      const entry = {
        routeId: route.id,
        method: route.method,
        path: route.path,
        caseId: c.id,
        caseName: c.name,
        bytes,
      }
      keepLargest(largest, entry, BAKED_TOO_LARGE_LISTED)
      // `retained + bytes`: the bodies kept so far plus the one just generated, held by the caller.
      peakRetained = Math.max(peakRetained, retained + bytes)
      if (!over && totalBytes > maxBakedBytes) {
        over = true
        for (const k of Object.keys(bodies)) delete bodies[k]
        retained = 0
      }
      if (!over) {
        bodies[key] = body
        retained += bytes
      }
    }
    for (const route of snapshot.routes) {
      for (const c of route.cases) {
        const key = `${route.id}:${c.id}`
        if (c.statusCode === 204) {
          record(route, c, key, '')
          continue
        }
        const out = bake(c.schema as MockSchema, ctx)
        if ('issue' in out) {
          bakeFailures.push({
            routeId: route.id,
            method: route.method,
            path: route.path,
            caseId: c.id,
            caseName: c.name,
            issues: [out.issue],
          })
        } else {
          record(route, c, key, out.body)
        }
      }
    }
    if (bakeFailures.length > 0) throw new PublishInvalidError(bakeFailures)
    if (over) throw new BakedTooLargeError(totalBytes, maxBakedBytes, largest, peakRetained)
    baked = JSON.stringify(bodies)
  }

  const caseCount = snapshot.routes.reduce((n, r) => n + r.cases.length, 0)
  return {
    snapshot,
    baked,
    routeCount: snapshot.routes.length,
    caseCount,
    snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot), 'utf8'),
    bakedBytes: baked === null ? 0 : Buffer.byteLength(baked, 'utf8'),
  }
}
