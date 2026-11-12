// RUN-04: a stored snapshot (plus its baked bodies) compiled into a structure that matches a request
// to a route and selects a case exactly as API-CONTRACT section 4 specifies.
//
// PURE: no database, no HTTP, no Express. The data-plane handler (RUN-05) and the version cache
// (RUN-06) build on this.
import { normalizePath, parseRoutePath } from '@mockbench/api-contract'
import type { Method, ProjectSettings, Snapshot } from '@mockbench/api-contract'

type SnapshotRoute = Snapshot['routes'][number]
type SnapshotCase = SnapshotRoute['cases'][number]

/** Raised when a stored snapshot cannot be compiled (it never happens for a version RUN-01 built). */
export class CompileError extends Error {
  override name = 'CompileError'
}

export interface CompiledCase {
  id: string
  name: string
  statusCode: number
  headers: Readonly<Record<string, string>>
  /** null = inherit the project's defaultDelayMs. */
  delayMs: number | null
  isDefault: boolean
  /** Kept (a reference, not a copy) so `random` mode can generate per request. */
  schema: SnapshotCase['schema']
}

export interface CompiledRoute {
  id: string
  method: Method
  /** The route pattern as defined, e.g. `/users/:id`. */
  path: string
  description: string | null
  /** In sortOrder (the snapshot's order). */
  cases: readonly CompiledCase[]
  defaultCase: CompiledCase
}

export interface CaseSelectors {
  /** `X-Mock-Case` header value. `undefined` = absent. */
  caseHeader?: string | undefined
  /** `__case` query value. `undefined` = absent. */
  caseQuery?: string | undefined
  /** `X-Mock-Status` header value. `undefined` = absent. */
  statusHeader?: string | undefined
}

export interface AvailableCase {
  name: string
  statusCode: number
  isDefault: boolean
}

export type SelectResult =
  { ok: true; case: CompiledCase } | { ok: false; available: AvailableCase[] }

export interface MatchResult {
  route: CompiledRoute
  /** Decoded parameter values by name. A param called `__proto__` is an own property, never the prototype. */
  params: Record<string, string>
}

export interface CompiledVersion {
  label: string
  /** `versions.id`, for the request log (RUN-07); null when the caller did not pass it. */
  versionId: string | null
  projectId: string
  slug: string
  settings: ProjectSettings
  /** Estimated resident size, for the byte-bounded cache (RUN-06). Never less than the baked text length. */
  bytes: number
  /** Project components and enabled presets frozen into the snapshot (needed to generate in `random` mode). */
  components: Snapshot['project']['components']
  presets: Snapshot['presets']
  match(method: string, rawPath: string): MatchResult | null
  routes(): { method: Method; path: string }[]
  selectCase(route: CompiledRoute, selectors: CaseSelectors): SelectResult
  /** The baked body; `""` for a 204 case; `null` when the version was not baked (`random` mode). */
  body(c: CompiledCase): string | null
}

export interface CompileOptions {
  /** `versions.snapshot_bytes`, when the caller knows it: added to the size estimate. */
  snapshotBytes?: number
  /** `versions.id` (RUN-07: recorded on each request-log row). */
  versionId?: string
}

// ---------------------------------------------------------------------------------------------------
// Segment tree

interface Node {
  /** Lowercased static segment -> child. */
  statics: Map<string, Node> | null
  /** The `:param` child (one per node: all param names at one position are the same slot). */
  param: Node | null
  route: InternalRoute | null
}

interface InternalRoute extends CompiledRoute {
  /** Parameter names in path order. */
  paramNames: readonly string[]
}

const newNode = (): Node => ({ statics: null, param: null, route: null })

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

// ---------------------------------------------------------------------------------------------------

class Compiled implements CompiledVersion {
  readonly label: string
  readonly versionId: string | null
  readonly projectId: string
  readonly slug: string
  readonly settings: ProjectSettings
  readonly bytes: number
  readonly components: Snapshot['project']['components']
  readonly presets: Snapshot['presets']

  private readonly trees = new Map<string, Node>()
  private readonly routeList: { method: Method; path: string }[] = []
  private readonly bodies = new Map<CompiledCase, string>()
  private readonly baked: boolean

  constructor(
    snapshot: Snapshot,
    bakedText: string | null,
    label: string,
    options: CompileOptions,
  ) {
    this.label = label
    this.versionId = options.versionId ?? null
    this.projectId = snapshot.project.id
    this.slug = snapshot.project.slug
    this.settings = snapshot.project.settings
    this.components = snapshot.project.components
    this.presets = snapshot.presets
    this.baked = bakedText !== null

    let bakedMap: Record<string, unknown> | null = null
    if (bakedText !== null) {
      let parsed: unknown
      try {
        parsed = JSON.parse(bakedText)
      } catch (err) {
        throw new CompileError(`The baked payload is not valid JSON: ${(err as Error).message}`)
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new CompileError('The baked payload must be a JSON object keyed by "routeId:caseId".')
      }
      bakedMap = parsed as Record<string, unknown>
    }

    let nodeCount = 1
    let caseCount = 0
    for (const route of snapshot.routes) {
      const parsedPath = parseRoutePath(route.path)
      if (!parsedPath.ok) {
        throw new CompileError(
          `Route ${route.method} ${route.path} has an invalid path: ${parsedPath.issues[0]?.message}`,
        )
      }
      if (!METHODS.has(route.method)) {
        throw new CompileError(`Route ${route.path} has an unsupported method "${route.method}".`)
      }
      if (route.cases.length === 0) {
        throw new CompileError(`Route ${route.method} ${route.path} has no cases.`)
      }

      const cases: CompiledCase[] = route.cases.map((c) => ({
        id: c.id,
        name: c.name,
        statusCode: c.statusCode,
        headers: c.headers,
        delayMs: c.delayMs,
        isDefault: c.isDefault,
        schema: c.schema,
      }))
      caseCount += cases.length
      const defaultCase = cases.find((c) => c.isDefault) ?? (cases[0] as CompiledCase)

      const paramNames: string[] = []
      const compiledRoute: InternalRoute = {
        id: route.id,
        method: route.method,
        path: route.path,
        description: route.description,
        cases,
        defaultCase,
        paramNames,
      }

      // Insert into this method's tree.
      let node = this.trees.get(route.method)
      if (!node) {
        node = newNode()
        this.trees.set(route.method, node)
        nodeCount++
      }
      for (const seg of parsedPath.segments) {
        if ('static' in seg) {
          const key = seg.static.toLowerCase()
          node.statics ??= new Map()
          let child = node.statics.get(key)
          if (!child) {
            child = newNode()
            node.statics.set(key, child)
            nodeCount++
          }
          node = child
        } else {
          paramNames.push(seg.param)
          if (!node.param) {
            node.param = newNode()
            nodeCount++
          }
          node = node.param
        }
      }
      if (node.route) {
        throw new CompileError(
          `Routes "${node.route.method} ${node.route.path}" and "${route.method} ${route.path}" collide (${normalizePath(route.path)}).`,
        )
      }
      node.route = compiledRoute
      this.routeList.push({ method: route.method, path: route.path })

      // Bodies. A 204 case sends no body, whatever was baked.
      for (const c of cases) {
        if (c.statusCode === 204) {
          this.bodies.set(c, '')
          continue
        }
        if (bakedMap) {
          const key = `${route.id}:${c.id}`
          const body = bakedMap[key]
          if (typeof body !== 'string') {
            throw new CompileError(
              `The baked payload has no body for case "${c.name}" of ${route.method} ${route.path} (${key}).`,
            )
          }
          this.bodies.set(c, body)
        }
      }
    }

    // A deliberately generous estimate: JS strings can be two bytes per character, plus the tree and
    // per-route/per-case objects. Never less than the baked text length.
    const bakedChars = bakedText?.length ?? 0
    this.bytes =
      bakedChars * 2 +
      nodeCount * 96 +
      snapshot.routes.length * 256 +
      caseCount * 512 +
      (options.snapshotBytes ?? 0)
  }

  routes(): { method: Method; path: string }[] {
    return this.routeList.map((r) => ({ ...r }))
  }

  match(method: string, rawPath: string): MatchResult | null {
    let m = method.toUpperCase()
    if (m === 'HEAD') m = 'GET'
    const root = this.trees.get(m)
    if (!root) return null

    // Strip the query string and fragment, then one trailing slash.
    let end = rawPath.length
    for (let i = 0; i < rawPath.length; i++) {
      const ch = rawPath.charCodeAt(i)
      if (ch === 63 /* ? */ || ch === 35 /* # */) {
        end = i
        break
      }
    }
    if (end === 0 || rawPath.charCodeAt(0) !== 47 /* / */) return null
    if (end === 2 && rawPath.charCodeAt(1) === 47) return null // "//" is an empty segment
    if (end > 1 && rawPath.charCodeAt(end - 1) === 47) end--

    // Split into decoded segments. Any empty segment, or a malformed escape, is no match.
    const segments: string[] = []
    if (end > 1) {
      let start = 1
      for (let i = 1; i <= end; i++) {
        if (i === end || rawPath.charCodeAt(i) === 47) {
          if (i === start) return null // empty segment ("//")
          let seg = rawPath.slice(start, i)
          if (seg.includes('%')) {
            try {
              seg = decodeURIComponent(seg)
            } catch {
              return null
            }
          }
          segments.push(seg)
          start = i + 1
        }
      }
    }

    const values: string[] = []
    const route = walk(root, segments, 0, values)
    if (!route) return null

    // A plain object (fast in V8). A param may legally be called `__proto__`: that one name is
    // defined as an own data property so it can never reach the prototype.
    const params: Record<string, string> = {}
    for (let i = 0; i < route.paramNames.length; i++) {
      const name = route.paramNames[i] as string
      const value = values[i] as string
      if (name === '__proto__') {
        Object.defineProperty(params, name, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        })
      } else {
        params[name] = value
      }
    }
    return { route, params }
  }

  selectCase(route: CompiledRoute, selectors: CaseSelectors): SelectResult {
    const fail = (): SelectResult => ({
      ok: false,
      available: route.cases.map((c) => ({
        name: c.name,
        statusCode: c.statusCode,
        isDefault: c.isDefault,
      })),
    })

    // First PRESENT selector decides: there is no fall-through to a later one.
    const named = selectors.caseHeader ?? selectors.caseQuery
    if (named !== undefined) {
      const wanted = named.trim().toLowerCase()
      const hit =
        route.cases.find((c) => c.id.toLowerCase() === wanted) ??
        route.cases.find((c) => c.name.trim().toLowerCase() === wanted)
      return hit ? { ok: true, case: hit } : fail()
    }
    if (selectors.statusHeader !== undefined) {
      const text = selectors.statusHeader.trim()
      const status = /^\d{1,3}$/.test(text) ? Number(text) : Number.NaN
      const hit = route.cases.find((c) => c.statusCode === status)
      return hit ? { ok: true, case: hit } : fail()
    }
    return { ok: true, case: route.defaultCase }
  }

  body(c: CompiledCase): string | null {
    if (c.statusCode === 204) return ''
    if (!this.baked) return null
    return this.bodies.get(c) ?? null
  }
}

/**
 * Static segments are tried before the `:param` child at every level, and a failed static branch
 * backtracks to the param branch (so `/users/me/orders` still matches `/users/:id/orders` when
 * `/users/me` exists but has no `orders` child).
 */
function walk(
  node: Node,
  segments: readonly string[],
  index: number,
  values: string[],
): InternalRoute | null {
  if (index === segments.length) return node.route
  const seg = segments[index] as string
  if (node.statics) {
    const child = node.statics.get(seg.toLowerCase())
    if (child) {
      const found = walk(child, segments, index + 1, values)
      if (found) return found
    }
  }
  if (node.param) {
    values.push(seg)
    const found = walk(node.param, segments, index + 1, values)
    if (found) return found
    values.pop()
  }
  return null
}

/**
 * Compiles a snapshot and its baked bodies.
 *
 * `label` is a parameter because the registry's `Snapshot` type does not carry the version label (it
 * lives on the `versions` row); the cache passes `versions.label` and the data plane reports it as
 * `X-Mock-Version`.
 *
 * `baked` is the text of `{ "<routeId>:<caseId>": "<body>" }`, or `null` for a `random`-mode version.
 * Throws `CompileError` for a snapshot or payload that RUN-01 could not have produced.
 */
export function compileVersion(
  snapshot: Snapshot,
  baked: string | null,
  label: string,
  options: CompileOptions = {},
): CompiledVersion {
  return new Compiled(snapshot, baked, label, options)
}
