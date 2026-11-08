// Types every module codes against: the per-request context, the typed handler, and the
// compile-time guarantee that a module can only bind handlers of ITS OWN endpoint areas.
import type { EndpointInput, EndpointResponse, registry } from '@mockbench/api-contract'
import type { Request, Response } from 'express'
import type { Logger } from 'pino'
import type { Config } from '../config'
import type { Db } from '../db/client'
import type { Pool } from 'pg'
import type { Hooks } from './hooks'

export interface AuthInfo {
  userId: string
  sessionId: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The request id also sent back as `X-Request-Id` (set by the control plane). */
      requestId: string
      /** pino child logger carrying `requestId`. */
      log: Logger
      /** Set by the session middleware when a valid session cookie was presented. */
      auth?: AuthInfo
      /** Parsed `Cookie` header (set by the cookie step). */
      cookies?: Record<string, string | undefined>
      /** True when a session cookie was sent but did not resolve to a live session. */
      sessionCookieRejected?: boolean
    }
  }
}

/** Everything a handler may use. Handlers never see raw `process.env`. */
export interface ApiContext {
  req: Request
  res: Response
  requestId: string
  log: Logger
  db: Db
  pool: Pool
  config: Config
  hooks: Hooks
  /** The authenticated caller; null on public endpoints reached without a valid session. */
  auth: AuthInfo | null
  /** Client IP (honours TRUST_PROXY). */
  ip: string
}

type Endpoint = (typeof registry)['endpoints'][number]

/** A handler for one registry endpoint: typed params/query/body in, one declared response out. */
export type Handler<E> = (ctx: ApiContext, input: EndpointInput<E>) => Promise<EndpointResponse<E>>

/**
 * The handlers a module may bind: only endpoints whose id starts with one of its areas.
 * Binding any other endpoint id is a compile error (excess property check).
 */
export type ModuleHandlers<Areas extends string> = {
  [E in Endpoint as E['id'] extends `${Areas}.${string}` ? E['id'] : never]?: Handler<E>
}

/** What `createApp` hands each module's optional `init` (e.g. to register hook listeners). */
export interface ModuleInitContext {
  db: Db
  pool: Pool
  config: Config
  hooks: Hooks
  log: Logger
}

/** The shape every `modules/<dir>/index.ts` satisfies. */
export interface ModuleDefinition {
  /** Endpoint areas (id prefixes) this module owns. */
  areas: readonly string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlers: Partial<Record<string, Handler<any>>>
  init?: (ctx: ModuleInitContext) => void
}
