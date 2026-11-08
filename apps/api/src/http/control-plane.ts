// The CONTROL PLANE: `/api/v1/*` (plus the root health aliases). Authenticated, write-heavy, rich
// validation, the error envelope. Wired from the endpoint registry (ADR 0015): for every endpoint
// there is exactly one route; it runs the module's handler, or answers 501 `not_implemented`
// until that module fills it in.
//
// Middleware order (each step is named so tests can prove the data plane never runs them):
//   request-id -> csrf -> cookies -> session -> rate-limit -> [per endpoint: require-session?
//   -> json-body -> validate -> handler] -> 404 -> error handler
import { randomUUID } from 'node:crypto'
import { toValidationIssues } from '@mockbench/api-contract'
import type { EndpointDef, ValidationIssue } from '@mockbench/api-contract'
import { parseCookie } from 'cookie'
import express from 'express'
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express'
import type { Pool } from 'pg'
import type { Config } from '../config'
import type { Db } from '../db/client'
import type { SessionAuth } from '../modules/auth/session-middleware'
import { DEFAULT_BODY_LIMIT, IMPORT_BODY_LIMIT, readJsonBody } from './body'
import { HttpError, errorBody, isHttpError } from './errors'
import type { Hooks } from './hooks'
import type { Logger } from './logger'
import { createLimiter } from './rate-limit'
import type { ApiContext, Handler } from './types'

export const API_PREFIX = '/api/v1'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const LOGIN_ENDPOINTS = new Set(['auth.login', 'auth.register'])
const QUIET_ENDPOINT_PATHS = new Set(['/healthz', '/readyz'])

export interface ControlPlaneDeps {
  config: Config
  db: Db
  pool: Pool
  logger: Logger
  hooks: Hooks
  sessionAuth: SessionAuth
  /** endpoint id -> handler. Missing id = 501. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlers: ReadonlyMap<string, Handler<any>>
  endpoints: readonly EndpointDef[]
  /** Called with the name of each control-plane middleware step as it runs (tests only). */
  trace?: (step: string) => void
  now?: () => number
}

/** Static segments before params, so `/projects/by-slug/:slug` is registered before `/projects/:id/...`. */
function bySpecificity(a: EndpointDef, b: EndpointDef): number {
  const A = a.path.split('/').filter(Boolean)
  const B = b.path.split('/').filter(Boolean)
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const pa = A[i]!.startsWith(':')
    const pb = B[i]!.startsWith(':')
    if (pa !== pb) return pa ? 1 : -1
  }
  return 0
}

function prefixed(prefix: string, issues: ValidationIssue[]): ValidationIssue[] {
  return issues.map((i) => ({ ...i, path: [prefix, ...i.path] }))
}

export function createControlPlane(deps: ControlPlaneDeps): Router {
  const { config, sessionAuth } = deps
  const router = express.Router()
  const controlLimiter = createLimiter({ limit: config.controlRateLimit, now: deps.now })
  const loginLimiter = createLimiter({ limit: config.loginRateLimit, now: deps.now })

  const traced =
    (step: string, fn: RequestHandler): RequestHandler =>
    (req, res, next) => {
      deps.trace?.(step)
      return fn(req, res, next)
    }

  // ---- shared middleware ----
  router.use(
    traced('request-id', (req, res, next) => {
      const incoming = req.get('x-request-id')
      const id = incoming && /^[A-Za-z0-9._-]{1,128}$/.test(incoming) ? incoming : randomUUID()
      req.requestId = id
      res.setHeader('X-Request-Id', id)
      req.log = deps.logger.child({ requestId: id })
      const started = process.hrtime.bigint()
      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6
        const level = QUIET_ENDPOINT_PATHS.has(req.path) ? 'debug' : 'info'
        req.log[level](
          { method: req.method, path: req.path, status: res.statusCode, durationMs },
          'request',
        )
      })
      next()
    }),
  )

  router.use(
    traced('csrf', (req, _res, next) => {
      if (!SAFE_METHODS.has(req.method) && !req.get('x-mockbench-client')?.trim()) {
        throw new HttpError(
          403,
          'csrf_rejected',
          'Send the X-Mockbench-Client header on requests that change data.',
        )
      }
      next()
    }),
  )

  router.use(
    traced('cookies', (req, _res, next) => {
      req.cookies = parseCookie(req.headers.cookie ?? '')
      next()
    }),
  )

  router.use(traced('session', sessionAuth.optionalSession))

  router.use(
    traced('rate-limit', (req, _res, next) => {
      const key = req.auth ? `session:${req.auth.sessionId}` : `ip:${req.ip ?? 'unknown'}`
      const r = controlLimiter.consume(key)
      if (!r.allowed) {
        throw new HttpError(
          429,
          'rate_limited',
          'Too many requests. Slow down and retry shortly.',
          [],
          { 'Retry-After': String(r.retryAfterSec) },
        )
      }
      next()
    }),
  )

  // ---- registry-driven routes ----
  const endpoints = [...deps.endpoints].sort(bySpecificity)
  for (const endpoint of endpoints) {
    const handler = deps.handlers.get(endpoint.id)
    const paths = [
      `${API_PREFIX}${endpoint.path}`,
      ...(endpoint.aliases ?? []).map((a) => `${API_PREFIX}${a}`),
      ...(endpoint.alsoAtRoot ? [endpoint.path] : []),
    ]
    const method = endpoint.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
    const chain: RequestHandler[] = []
    if (handler && endpoint.auth !== 'public') {
      chain.push(traced('require-session', sessionAuth.requireSession))
    }
    chain.push(bind(endpoint, handler))
    router[method](paths, ...chain)
  }

  function bind(endpoint: EndpointDef, handler: Handler<never> | undefined): RequestHandler {
    return async (req: Request, res: Response) => {
      if (!handler) {
        throw new HttpError(501, 'not_implemented', `${endpoint.id} is not implemented yet.`)
      }
      if (LOGIN_ENDPOINTS.has(endpoint.id)) {
        const r = loginLimiter.consume(`login:${req.ip ?? 'unknown'}`)
        if (!r.allowed) {
          throw new HttpError(
            429,
            'rate_limited',
            'Too many sign-in attempts. Try again in a minute.',
            [],
            { 'Retry-After': String(r.retryAfterSec) },
          )
        }
      }

      deps.trace?.('json-body')
      const rawBody = await readJsonBody(
        req,
        endpoint.id === 'projects.import' ? IMPORT_BODY_LIMIT : DEFAULT_BODY_LIMIT,
      )

      const input = validate(endpoint, req, rawBody)
      const ctx: ApiContext = {
        req,
        res,
        requestId: req.requestId,
        log: req.log,
        db: deps.db,
        pool: deps.pool,
        config,
        hooks: deps.hooks,
        auth: req.auth ?? null,
        ip: req.ip ?? '',
      }
      const result = (await (handler as Handler<unknown>)(ctx, input as never)) as {
        status: number
        body?: unknown
      }

      if (config.nodeEnv !== 'production') assertMatchesContract(endpoint, result)

      if (res.headersSent) return // the handler wrote the response itself (e.g. a file download)
      res.status(result.status)
      if (result.body === undefined) res.end()
      else res.type('application/json').send(JSON.stringify(result.body))
    }
  }

  // ---- unknown paths and errors ----
  router.use(() => {
    throw new HttpError(404, 'not_found', 'No such endpoint.')
  })

  // Four-argument signature is what makes Express treat this as the error handler.
  router.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err)

    if (isHttpError(err)) {
      for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v)
      res.status(err.status).json(errorBody(err.code, err.message, err.details))
      return
    }

    // Express rejects an undecodable path parameter itself (status 400, URIError).
    const status = (err as { status?: unknown } | null)?.status
    if (status === 400 && err instanceof Error && /decode/i.test(err.message)) {
      res
        .status(422)
        .json(
          errorBody('validation_failed', 'The request is not valid.', [
            { path: ['params'], code: 'invalid_encoding', message: err.message },
          ]),
        )
      return
    }

    // Anything else is a bug: log it with the request id, tell the client nothing about it.
    ;(req.log ?? deps.logger).error({ err }, 'unhandled error')
    res.status(500).json(errorBody('internal_error', 'Something went wrong on the server.'))
  })

  return router
}

/** Validates params, query and body with the endpoint's registry schemas; throws 422 on failure. */
function validate(endpoint: EndpointDef, req: Request, rawBody: unknown) {
  const issues: ValidationIssue[] = []
  let params: unknown
  let query: unknown
  let body: unknown

  if (endpoint.params) {
    const r = endpoint.params.safeParse({ ...req.params })
    if (r.success) params = r.data
    else issues.push(...prefixed('params', toValidationIssues(r.error)))
  }
  if (endpoint.query) {
    const r = endpoint.query.safeParse({ ...req.query })
    if (r.success) query = r.data
    else issues.push(...prefixed('query', toValidationIssues(r.error)))
  }
  if (endpoint.body) {
    // An absent body is validated as `{}`: all-optional bodies pass, required fields are reported.
    const r = endpoint.body.safeParse(rawBody ?? {})
    if (r.success) body = r.data
    else issues.push(...toValidationIssues(r.error))
  }
  if (issues.length > 0) {
    throw new HttpError(422, 'validation_failed', 'The request is not valid.', issues)
  }
  return { params, query, body }
}

/** Outside production, a handler whose answer drifts from the registry is a loud 500, not a silent lie. */
function assertMatchesContract(endpoint: EndpointDef, result: { status: number; body?: unknown }) {
  const schema = endpoint.responses[result.status]
  if (schema === undefined) {
    throw new Error(
      `${endpoint.id} returned status ${result.status}, which the contract does not declare`,
    )
  }
  if (schema === null) {
    if (result.body !== undefined) {
      throw new Error(`${endpoint.id} returned a body with ${result.status}, which has none`)
    }
    return
  }
  const parsed = schema.safeParse(result.body)
  if (!parsed.success) {
    const issues = JSON.stringify(toValidationIssues(parsed.error)).slice(0, 600)
    throw new Error(`${endpoint.id} returned a body that does not match the contract: ${issues}`)
  }
}
