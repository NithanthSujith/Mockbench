// DATA PLANE (`/mock/:slug/*`), API-CONTRACT section 4.
//
// This router is mounted FIRST, at `/mock`, before any cookie parsing, session lookup, CSRF guard or
// JSON body parsing, and it has its OWN error handler. It reads no request body at all. Errors it
// generates carry `X-Mock-Error: true` and the body `{ error, message, hint }` (4.5) - never the
// control-plane envelope. The warm path runs no SQL: everything comes from the VersionCache.
import { buildPresetResolver, generate } from '@mockbench/schema-core'
import type { MockSchema, PresetResolver, ResolvedPreset } from '@mockbench/schema-core'
import express from 'express'
import type { NextFunction, Request, Response, Router } from 'express'
import type { Logger } from 'pino'
import type { CompiledCase, CompiledRoute, CompiledVersion } from './compiled-version'
import { requestLog as defaultRequestLog } from './request-log'
import type { RequestLog } from './request-log'
import { VersionLoadError } from './version-cache'
import type { VersionCache } from './version-cache'

export interface DataPlaneDeps {
  logger: Logger
  /** RUN-06: created in app.ts; resolves `/mock/:slug`. */
  cache: VersionCache
  /** RUN-07 seam (no-op until it merges). */
  requestLog?: RequestLog
  /** Delay implementation (tests inject a recorder). */
  sleep?: (ms: number) => Promise<void>
}

const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS'
const BASE_EXPOSE = ['X-Mock-Version', 'X-Mock-Route', 'X-Mock-Case', 'X-Mock-Error']
const REDACTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'set-cookie',
])

type CorsMode = '*' | 'off'

interface Ctx {
  cors: CorsMode
  projectId: string | null
  versionLabel: string | null
  routePattern: string | null
  caseName: string | null
  mockError: string | null
}

const newCtx = (): Ctx => ({
  cors: '*',
  projectId: null,
  versionLabel: null,
  routePattern: null,
  caseName: null,
  mockError: null,
})

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The per-version preset resolver, built once (random mode generates on every request). */
const resolvers = new WeakMap<CompiledVersion, PresetResolver>()
function resolverFor(v: CompiledVersion): PresetResolver {
  let r = resolvers.get(v)
  if (!r) {
    r = buildPresetResolver(
      v.presets.map((p): ResolvedPreset => ({ priority: p.priority, rules: p.rules })),
    )
    resolvers.set(v, r)
  }
  return r
}

function ctxOf(res: Response): Ctx {
  return res.locals.mock as Ctx
}

/** Hardening (D9) and, when allowed, the CORS pair. Applied to every data-plane response. */
function baseHeaders(res: Response, cors: CorsMode, extraExpose: string[] = []): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', 'sandbox')
  if (cors === '*') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Expose-Headers', [...BASE_EXPOSE, ...extraExpose].join(', '))
  }
}

function sendMockError(
  res: Response,
  status: number,
  error: string,
  message: string,
  hint: string,
  extra: Record<string, unknown> = {},
): void {
  const ctx = ctxOf(res)
  ctx.mockError = error
  // Drop anything a half-built response set (e.g. a bad custom header), then start clean.
  for (const name of res.getHeaderNames()) res.removeHeader(name)
  baseHeaders(res, ctx.cors)
  const body = JSON.stringify({ error, message, hint, ...extra })
  res.statusCode = status
  res.setHeader('X-Mock-Error', 'true')
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(res.req.method === 'HEAD' ? undefined : body)
}

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** Splits `/slug/rest?query` (the path under the `/mock` mount). Slugs are matched lowercase. */
function splitTarget(url: string): { slug: string; rest: string } {
  const q = url.search(/[?#]/)
  const pathOnly = q === -1 ? url : url.slice(0, q)
  const search = q === -1 ? '' : url.slice(q)
  const m = /^\/([^/]*)(\/.*)?$/.exec(pathOnly)
  let slug = m?.[1] ?? ''
  try {
    slug = decodeURIComponent(slug)
  } catch {
    // leave undecoded: it will not match any slug
  }
  return { slug: slug.toLowerCase(), rest: (m?.[2] ?? '/') + search }
}

function queryOf(req: Request): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string') out[k] = v
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string')
  }
  return out
}

function redactedHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    out[k] = REDACTED_HEADERS.has(k) ? '[redacted]' : Array.isArray(v) ? v.join(', ') : v
  }
  return out
}

function writeCase(
  res: Response,
  req: Request,
  version: CompiledVersion,
  route: CompiledRoute,
  c: CompiledCase,
): void {
  let body = version.body(c)
  if (body === null) {
    // random mode: generated here, per request.
    body = generate(c.schema as MockSchema, {
      projectId: version.projectId,
      settings: { indexing: version.settings.indexing, mode: version.settings.mode },
      components: version.components,
      presets: resolverFor(version),
    }).json
  }

  baseHeaders(res, ctxOf(res).cors, Object.keys(c.headers))
  let hasContentType = false
  for (const [name, value] of Object.entries(c.headers)) {
    if (name.toLowerCase() === 'content-type') hasContentType = true
    res.setHeader(name, value)
  }
  res.setHeader('X-Mock-Version', version.label)
  res.setHeader('X-Mock-Route', `${route.method} ${route.path}`)
  res.setHeader('X-Mock-Case', c.name)
  res.statusCode = c.statusCode

  if (c.statusCode === 204) {
    res.removeHeader('Content-Type')
    res.end()
    return
  }
  if (!hasContentType) res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(req.method === 'HEAD' ? undefined : body)
}

function sendOptions(req: Request, res: Response, cors: CorsMode): void {
  baseHeaders(res, cors)
  if (cors === '*') {
    res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS)
    res.setHeader(
      'Access-Control-Allow-Headers',
      single(req.headers['access-control-request-headers']) ?? '*',
    )
    res.setHeader('Access-Control-Max-Age', '600')
  }
  res.statusCode = 204
  res.end()
}

export function createDataPlaneRouter(deps: DataPlaneDeps): Router {
  const log = deps.logger.child({ plane: 'data' })
  const requestLog = deps.requestLog ?? defaultRequestLog
  const sleep = deps.sleep ?? defaultSleep
  const router = express.Router()

  router.use(async (req: Request, res: Response) => {
    const started = process.hrtime.bigint()
    const ctx = newCtx()
    res.locals.mock = ctx
    const { slug, rest } = splitTarget(req.url)

    res.once('finish', () => {
      // Step 8: after the response is flushed. Unknown-slug requests are not logged. Never throws.
      if (ctx.projectId === null) return
      try {
        const [pathname] = rest.split(/[?#]/, 1) as [string]
        requestLog.record({
          projectId: ctx.projectId,
          method: req.method,
          path: pathname,
          query: queryOf(req),
          statusCode: res.statusCode,
          durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
          routePattern: ctx.routePattern,
          caseName: ctx.caseName,
          versionId: null,
          versionLabel: ctx.versionLabel,
          mockError: ctx.mockError,
          requestHeaders: redactedHeaders(req),
          ip: req.ip ?? null,
        })
      } catch (err) {
        log.warn({ err }, 'request log record failed')
      }
    })

    // 2-3. Resolve the project and its live version. (A warm lookup is a Map read; the lookup is also
    // how OPTIONS learns `cors: "off"`. It never makes OPTIONS depend on the project existing.)
    let lookup
    try {
      lookup = await deps.cache.get(slug)
    } catch (err) {
      if (!(err instanceof VersionLoadError)) throw err
      log.error({ err, slug }, 'version load failed')
      if (req.method === 'OPTIONS') return sendOptions(req, res, '*')
      sendMockError(
        res,
        503,
        'project_not_published',
        `The mock for "${slug}" could not be loaded right now.`,
        'Try again in a moment; check the api logs if it persists.',
        { slug },
      )
      return
    }
    if (lookup.status !== 'unknown') ctx.projectId = lookup.projectId
    if (lookup.status === 'live') {
      ctx.cors = lookup.version.settings.cors === 'off' ? 'off' : '*'
      ctx.versionLabel = lookup.version.label
    }

    // 1. OPTIONS is answered before project/route resolution results matter.
    if (req.method === 'OPTIONS') return sendOptions(req, res, ctx.cors)

    if (lookup.status === 'unknown') {
      sendMockError(
        res,
        404,
        'project_not_found',
        `No project has the slug "${slug}".`,
        'Check the slug in the project settings.',
        { slug },
      )
      return
    }
    if (lookup.status === 'unpublished') {
      sendMockError(
        res,
        503,
        'project_not_published',
        `The project "${slug}" has no published version.`,
        'Publish a version and deploy it from the Versions screen.',
        { slug },
      )
      return
    }

    // 4. Match.
    const { version } = lookup
    const matched = version.match(req.method, rest)
    if (!matched) {
      sendMockError(
        res,
        404,
        'route_not_found',
        `No route matches ${req.method} ${rest.split(/[?#]/, 1)[0]}.`,
        'Pick one of the routes listed in this response.',
        { routes: version.routes() },
      )
      return
    }
    ctx.routePattern = `${matched.route.method} ${matched.route.path}`

    // 5. Select the case.
    const selected = version.selectCase(matched.route, {
      caseHeader: single(req.headers['x-mock-case']),
      caseQuery: single(req.query.__case as string | string[] | undefined),
      statusHeader: single(req.headers['x-mock-status']),
    })
    if (!selected.ok) {
      sendMockError(
        res,
        400,
        'case_not_found',
        'The requested case does not exist on this route.',
        'Use one of the cases listed in this response.',
        { cases: selected.available },
      )
      return
    }
    ctx.caseName = selected.case.name

    // 6. Delay.
    const delay = selected.case.delayMs ?? version.settings.defaultDelayMs
    if (delay > 0) await sleep(delay)

    // 7. Respond.
    writeCase(res, req, version, matched.route, selected.case)
  })

  // Four-argument signature is what makes Express treat this as an error handler.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err)
    log.error({ err }, 'data plane error')
    res.locals.mock ??= newCtx()
    sendMockError(
      res,
      500,
      'mock_internal_error',
      'The mock server hit an unexpected error.',
      'Check the api logs.',
    )
  })

  return router
}
