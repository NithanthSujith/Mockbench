// Endpoint registry machinery (ADR 0015). Concrete endpoints are defined in FND-07.
// Paths are RELATIVE to the control-plane base `/api/v1` (so `/auth/login`, not `/api/v1/auth/login`).
import type { z } from 'zod'
import { AUTH_LEVELS, HTTP_METHODS } from './primitives'
import type { AuthLevel, HttpMethod } from './primitives'

export interface EndpointDef {
  /** `<area>.<operation>`, e.g. `auth.login`, `projects.getBySlug`. The area prefix decides which module owns it. */
  readonly id: string
  readonly method: HttpMethod
  /** Express-style path relative to `/api/v1`, e.g. `/projects/:projectId`. */
  readonly path: string
  readonly auth: AuthLevel
  readonly summary?: string
  readonly params?: z.ZodObject
  readonly query?: z.ZodObject
  readonly body?: z.ZodType
  /** Success (and any other documented) responses by status. `null` = no body (204). */
  readonly responses: { readonly [status: number]: z.ZodType | null }
  /** Endpoint-specific errors, in addition to the global codes and the auth legend's implicit ones. */
  readonly errors: readonly { readonly status: number; readonly code: string }[]
  readonly example: { readonly request?: unknown; readonly response?: unknown }
  readonly tags: readonly string[]
  /** Extra relative paths where the same handler is also mounted (e.g. container healthchecks). */
  readonly aliases?: readonly string[]
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RegistryError'
  }
}

const ID_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/
const CODE_PATTERN = /^[a-z][a-z0-9_]*$/
const PARAM = /:([A-Za-z_][A-Za-z0-9_]*)/g

/** Names of the `:params` in an Express-style path. */
export function pathParamNames(path: string): string[] {
  return [...path.matchAll(PARAM)].map((m) => m[1] as string)
}

/**
 * Normalisation used ONLY for the load-time uniqueness check: static segments lowercased,
 * every `:name` replaced by `{}`. FND-07 exports the canonical `normalizePath`; this mirrors its rule.
 */
export function uniquenessKey(method: string, path: string): string {
  const norm = path
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '{}' : seg.toLowerCase()))
    .join('/')
  return `${method} ${norm}`
}

/** Validates one endpoint definition at module load and returns it with its literal types intact. */
export function defineEndpoint<const E extends EndpointDef>(endpoint: E): E {
  const where = `endpoint "${endpoint.id}"`
  if (!ID_PATTERN.test(endpoint.id)) {
    throw new RegistryError(`${where}: id must look like "<area>.<operation>"`)
  }
  if (!HTTP_METHODS.includes(endpoint.method)) {
    throw new RegistryError(`${where}: unsupported method "${String(endpoint.method)}"`)
  }
  if (!AUTH_LEVELS.includes(endpoint.auth)) {
    throw new RegistryError(`${where}: unknown auth level "${String(endpoint.auth)}"`)
  }
  const { path } = endpoint
  if (!path.startsWith('/') || (path.length > 1 && path.endsWith('/')) || path.includes('//')) {
    throw new RegistryError(
      `${where}: path "${path}" must start with "/", have no empty segments and no trailing "/"`,
    )
  }
  const names = pathParamNames(path)
  if (new Set(names).size !== names.length) {
    throw new RegistryError(`${where}: path "${path}" repeats a parameter name`)
  }
  const declared = endpoint.params ? Object.keys(endpoint.params.shape).sort() : []
  if (names.slice().sort().join(',') !== declared.join(',')) {
    throw new RegistryError(
      `${where}: path params [${names.join(', ')}] do not match the params schema keys [${declared.join(', ')}]`,
    )
  }
  if (endpoint.method === 'GET' && endpoint.body) {
    throw new RegistryError(`${where}: GET endpoints cannot have a body`)
  }
  const statuses = Object.keys(endpoint.responses).map(Number)
  if (!statuses.some((s) => s >= 200 && s < 300)) {
    throw new RegistryError(`${where}: needs at least one 2xx response`)
  }
  for (const e of endpoint.errors) {
    if (!CODE_PATTERN.test(e.code))
      throw new RegistryError(`${where}: error code "${e.code}" must be snake_case`)
    if (e.status < 400 || e.status > 599)
      throw new RegistryError(`${where}: error status ${e.status} must be 4xx/5xx`)
  }
  if (endpoint.tags.length === 0) throw new RegistryError(`${where}: needs at least one tag`)
  return endpoint
}

export interface Registry<T extends readonly EndpointDef[] = readonly EndpointDef[]> {
  readonly endpoints: T
  /** Look an endpoint up by id; throws if absent. */
  get(id: string): T[number]
  has(id: string): boolean
}

/** Builds a registry, throwing at import time on a duplicate id or a duplicate method + normalised path. */
export function defineRegistry<const T extends readonly EndpointDef[]>(endpoints: T): Registry<T> {
  const byId = new Map<string, EndpointDef>()
  const byRoute = new Map<string, string>()
  for (const e of endpoints) {
    if (byId.has(e.id)) throw new RegistryError(`duplicate endpoint id "${e.id}"`)
    byId.set(e.id, e)
    for (const p of [e.path, ...(e.aliases ?? [])]) {
      const key = uniquenessKey(e.method, p)
      const other = byRoute.get(key)
      if (other !== undefined && other !== e.id) {
        throw new RegistryError(`endpoints "${other}" and "${e.id}" both claim ${key}`)
      }
      byRoute.set(key, e.id)
    }
  }
  return {
    endpoints,
    has: (id) => byId.has(id),
    get: (id) => {
      const e = byId.get(id)
      if (!e) throw new RegistryError(`unknown endpoint id "${id}"`)
      return e as T[number]
    },
  }
}

// ---------- handler typing ----------

/**
 * Per-request context handed to every handler. Empty on purpose: FND-10 augments it with
 * `req.auth`, the logger, the db handle etc. via declaration merging.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HandlerContext {}

type OutOf<E, K extends string> = E extends { [P in K]: infer S extends z.ZodType }
  ? z.output<S>
  : undefined

export type EndpointInput<E> = {
  params: OutOf<E, 'params'>
  query: OutOf<E, 'query'>
  body: OutOf<E, 'body'>
}

type ResponseUnion<R> = {
  [S in keyof R & number]: R[S] extends z.ZodType
    ? { status: S; body: z.output<R[S]> }
    : { status: S; body?: undefined }
}[keyof R & number]

/** What a handler must resolve with: one of the endpoint's declared responses. */
export type EndpointResponse<E> = E extends { responses: infer R } ? ResponseUnion<R> : never

export type HandlerFor<E> = (
  ctx: HandlerContext,
  input: EndpointInput<E>,
) => Promise<EndpointResponse<E>>

type EndpointsOf<R> = R extends Registry<infer T> ? T[number] : never

/** `{ [endpointId]: handler }` for every endpoint in the registry. */
export type Handlers<R extends Registry> = { [E in EndpointsOf<R> as E['id']]: HandlerFor<E> }

/**
 * Handlers restricted to one area (`auth`, `projects`, ...). Because the keys are limited to the
 * area's ids, binding a handler for another area's endpoint is a compile error (FND-10 relies on this).
 */
export type AreaHandlers<R extends Registry, Area extends string> = {
  [E in EndpointsOf<R> as E['id'] extends `${Area}.${string}` ? E['id'] : never]?: HandlerFor<E>
}
