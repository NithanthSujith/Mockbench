// Project export / import (PRJ-06, API-CONTRACT 3.11). The file is the draft plus presets: no ids,
// no versions. Export is deterministic (fixed key order, rows in sortOrder); import validates the whole
// document first, collects every problem with a path into the document, then writes in ONE transaction.
import {
  CASE_STATUS_CODES,
  CaseName,
  DEFAULT_PROJECT_SETTINGS,
  DelayMs,
  DescriptionField,
  NameField,
  PROJECT_EXPORT_FORMAT_VERSION,
  PresetPriority,
  Slug,
  normalizePath,
  parseRoutePath,
  toValidationIssues,
  validateCaseHeaders,
} from '@mockbench/api-contract'
import type { ProjectExport, ValidationIssue } from '@mockbench/api-contract'
import { validateSchema } from '@mockbench/schema-core'
import { asc, desc, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { dataPresets, projects, responseCases, routes } from '../../db/schema'
import { componentIssues } from './components'

type Row = typeof projects.$inferSelect

// ---------- export ----------

/** The export document of a project. Same data in, byte-identical JSON out. */
export async function buildExport(db: Db, project: Row): Promise<ProjectExport> {
  const [presetRows, routeRows, caseRows] = await Promise.all([
    db
      .select()
      .from(dataPresets)
      .where(eq(dataPresets.projectId, project.id))
      .orderBy(desc(dataPresets.priority), asc(dataPresets.createdAt), asc(dataPresets.id)),
    db
      .select()
      .from(routes)
      .where(eq(routes.projectId, project.id))
      .orderBy(asc(routes.sortOrder), asc(routes.createdAt), asc(routes.id)),
    db
      .select({ c: responseCases })
      .from(responseCases)
      .innerJoin(routes, eq(routes.id, responseCases.routeId))
      .where(eq(routes.projectId, project.id))
      .orderBy(asc(responseCases.sortOrder), asc(responseCases.createdAt), asc(responseCases.id)),
  ])

  const casesByRoute = new Map<string, ProjectExport['routes'][number]['cases']>()
  for (const { c } of caseRows) {
    const list = casesByRoute.get(c.routeId) ?? []
    list.push({
      name: c.name,
      statusCode: c.statusCode,
      schema: c.schema as ProjectExport['routes'][number]['cases'][number]['schema'],
      headers: c.headers as Record<string, string>,
      delayMs: c.delayMs,
      isDefault: c.isDefault,
    })
    casesByRoute.set(c.routeId, list)
  }

  const stored = project.settings as Partial<ProjectExport['project']['settings']>
  const merged = { ...DEFAULT_PROJECT_SETTINGS, ...stored }
  return {
    formatVersion: PROJECT_EXPORT_FORMAT_VERSION,
    project: {
      name: project.name,
      slug: project.slug,
      description: project.description,
      // Declared key order, whatever order the stored JSON happens to have.
      settings: {
        indexing: merged.indexing,
        mode: merged.mode,
        cors: merged.cors,
        defaultDelayMs: merged.defaultDelayMs,
      },
      components: project.components as ProjectExport['project']['components'],
    },
    presets: presetRows.map((p) => ({
      name: p.name,
      rules: p.rules as ProjectExport['presets'][number]['rules'],
      isEnabled: p.isEnabled,
      priority: p.priority,
    })),
    routes: routeRows.map((r) => ({
      method: r.method as ProjectExport['routes'][number]['method'],
      path: r.path,
      description: r.description,
      cases: casesByRoute.get(r.id) ?? [],
    })),
  }
}

// ---------- import: validation ----------

type Path = (string | number)[]

/** Runs a field rule from the registry and appends its issues under `path`. */
interface Rule {
  safeParse(
    value: unknown,
  ): { success: true } | { success: false; error: Parameters<typeof toValidationIssues>[0] }
}

function field(issues: ValidationIssue[], schema: Rule, value: unknown, path: Path): void {
  const r = schema.safeParse(value)
  if (r.success) return
  for (const i of toValidationIssues(r.error)) issues.push({ ...i, path: [...path, ...i.path] })
}

const STATUS_CODES: readonly number[] = CASE_STATUS_CODES

/**
 * Every problem in the document, each with a path into it. Empty = the document can be imported.
 * `slug` and `name` are the effective values (overrides already applied).
 */
export function validateImport(
  doc: ProjectExport,
  effective: { slug: string; name: string },
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if ((doc.formatVersion as number) !== PROJECT_EXPORT_FORMAT_VERSION) {
    return [
      {
        path: ['formatVersion'],
        code: 'unsupported_format_version',
        message: `Unsupported formatVersion ${String(doc.formatVersion)}; this server reads version ${PROJECT_EXPORT_FORMAT_VERSION}.`,
      },
    ]
  }

  field(issues, Slug, effective.slug, ['project', 'slug'])
  field(issues, NameField, effective.name, ['project', 'name'])
  if (doc.project.description !== null) {
    field(issues, DescriptionField, doc.project.description, ['project', 'description'])
  }
  issues.push(
    ...componentIssues(doc.project.components).map((i) => ({ ...i, path: ['project', ...i.path] })),
  )

  doc.presets.forEach((p, i) => {
    field(issues, NameField, p.name, ['presets', i, 'name'])
    field(issues, PresetPriority, p.priority, ['presets', i, 'priority'])
  })

  const seenRoutes = new Map<string, number>()
  doc.routes.forEach((route, ri) => {
    const parsed = parseRoutePath(route.path)
    if (!parsed.ok) {
      for (const i of parsed.issues) {
        issues.push({ path: ['routes', ri, 'path'], code: i.code, message: i.message })
      }
    } else {
      const key = `${route.method} ${normalizePath(route.path)}`
      const first = seenRoutes.get(key)
      if (first === undefined) seenRoutes.set(key, ri)
      else {
        issues.push({
          path: ['routes', ri, 'path'],
          code: 'route_conflict',
          message: `${route.method} ${route.path} collides with routes[${first}] (${doc.routes[first]!.path}) once parameter names and case are ignored.`,
        })
      }
    }

    if (route.description !== null) {
      field(issues, DescriptionField, route.description, ['routes', ri, 'description'])
    }
    if (route.cases.length === 0) {
      issues.push({
        path: ['routes', ri, 'cases'],
        code: 'route_without_cases',
        message: 'A route needs at least one response case.',
      })
    }
    const names = new Set<string>()
    route.cases.forEach((c, ci) => {
      const base: Path = ['routes', ri, 'cases', ci]
      field(issues, CaseName, c.name, [...base, 'name'])
      const lower = c.name.trim().toLowerCase()
      if (names.has(lower)) {
        issues.push({
          path: [...base, 'name'],
          code: 'case_name_taken',
          message: `Another case of this route is already named "${c.name}".`,
        })
      }
      names.add(lower)
      if (!STATUS_CODES.includes(c.statusCode)) {
        issues.push({
          path: [...base, 'statusCode'],
          code: 'invalid_status_code',
          message: `statusCode must be one of ${CASE_STATUS_CODES.join(', ')}`,
        })
      }
      if (c.delayMs !== null) field(issues, DelayMs, c.delayMs, [...base, 'delayMs'])
      for (const h of validateCaseHeaders(c.headers)) {
        issues.push({ path: [...base, 'headers', ...h.path], code: h.code, message: h.message })
      }
      const result = validateSchema(c.schema, { components: doc.project.components })
      if (!result.ok) {
        for (const i of result.issues) {
          issues.push({
            path: [...base, 'schema', ...i.path],
            code: i.code,
            message: i.message,
          })
        }
      }
    })
  })
  return issues
}

// ---------- import: write ----------

/** The one default case of a route: the first marked default wins; none marked -> the first case. */
function defaultIndex(cases: { isDefault: boolean }[]): number {
  const i = cases.findIndex((c) => c.isDefault)
  return i === -1 ? 0 : i
}

/** Inserts the project, presets, routes and cases in the caller's transaction; returns the new id. */
export async function writeImport(
  tx: Pick<Db, 'insert'>,
  workspaceId: string,
  doc: ProjectExport,
  effective: { slug: string; name: string },
): Promise<string> {
  const [project] = await tx
    .insert(projects)
    .values({
      workspaceId,
      name: effective.name,
      slug: effective.slug,
      description: doc.project.description,
      settings: { ...DEFAULT_PROJECT_SETTINGS, ...doc.project.settings },
      components: doc.project.components,
    })
    .returning({ id: projects.id })
  const projectId = project!.id

  if (doc.presets.length > 0) {
    // Explicit, increasing timestamps keep the export order (priority desc, createdAt asc) stable.
    const base = Date.now()
    await tx.insert(dataPresets).values(
      doc.presets.map((p, i) => ({
        projectId,
        name: p.name,
        rules: p.rules,
        isEnabled: p.isEnabled,
        priority: p.priority,
        createdAt: new Date(base + i),
      })),
    )
  }

  for (const [ri, route] of doc.routes.entries()) {
    const [row] = await tx
      .insert(routes)
      .values({
        projectId,
        method: route.method,
        path: route.path,
        description: route.description,
        sortOrder: ri,
      })
      .returning({ id: routes.id })
    const def = defaultIndex(route.cases)
    await tx.insert(responseCases).values(
      route.cases.map((c, ci) => ({
        routeId: row!.id,
        name: c.name.trim(),
        statusCode: c.statusCode,
        schema: c.schema,
        headers: c.headers,
        delayMs: c.delayMs,
        isDefault: ci === def,
        sortOrder: ci,
      })),
    )
  }
  return projectId
}
