// Checks a real HTTP response against the frozen contract for an endpoint id, so teams verify their
// handlers mechanically instead of re-typing shapes (FND-11 open question: yes).
import { ErrorEnvelope, GLOBAL_ERRORS, registry } from '@mockbench/api-contract'
import type { EndpointDef } from '@mockbench/api-contract'

export interface ResponseLike {
  status: number
  body: unknown
  text?: string
}

/** Error codes the legend of API-CONTRACT 1.3 makes implicit for an auth level. */
function implicitErrors(auth: EndpointDef['auth']): { status: number; code: string }[] {
  if (auth === 'public') return []
  const out = [{ status: 401, code: 'unauthenticated' }]
  if (auth === 'viewer' || auth === 'editor' || auth === 'owner') {
    out.push({ status: 404, code: 'not_found' })
  }
  if (auth === 'editor' || auth === 'owner') out.push({ status: 403, code: 'forbidden' })
  return out
}

/** The (status, code) pairs an endpoint may legitimately return as errors. */
export function allowedErrors(endpoint: EndpointDef): { status: number; code: string }[] {
  return [...endpoint.errors, ...GLOBAL_ERRORS, ...implicitErrors(endpoint.auth)]
}

/**
 * Throws a descriptive Error unless `res` is a response the contract allows for `endpointId`:
 *  - a documented success status whose body parses with the registry schema (null = empty body), or
 *  - a documented error: body is the ErrorEnvelope and (status, `error` code) is allowed.
 * Returns the parsed body.
 */
export function assertContract(endpointId: string, res: ResponseLike): unknown {
  const endpoint: EndpointDef = registry.get(endpointId)
  const where = `${endpoint.id} -> ${res.status}`

  if (res.status in endpoint.responses) {
    const schema = endpoint.responses[res.status]
    if (schema === null || schema === undefined) {
      const text = res.text ?? ''
      if (text !== '')
        throw new Error(`${where}: expected an empty body, got ${text.slice(0, 200)}`)
      return undefined
    }
    const parsed = schema.safeParse(res.body)
    if (!parsed.success) {
      throw new Error(
        `${where}: body does not match the contract schema:\n${JSON.stringify(parsed.error.issues, null, 2)}\nbody: ${JSON.stringify(res.body).slice(0, 500)}`,
      )
    }
    return parsed.data
  }

  const envelope = ErrorEnvelope.safeParse(res.body)
  if (!envelope.success) {
    throw new Error(
      `${where}: status is not a documented success and the body is not the error envelope: ${JSON.stringify(res.body).slice(0, 300)}`,
    )
  }
  const ok = allowedErrors(endpoint).some(
    (e) => e.status === res.status && e.code === envelope.data.error,
  )
  if (!ok) {
    throw new Error(
      `${where}: error code "${envelope.data.error}" is not documented for this endpoint (allowed: ${
        allowedErrors(endpoint)
          .filter((e) => e.status === res.status)
          .map((e) => e.code)
          .join(', ') || 'none at this status'
      })`,
    )
  }
  return envelope.data
}

/** Concrete request path for an endpoint id, e.g. pathFor('projects.get', { projectId }) -> /api/v1/projects/<id>. */
export function pathFor(endpointId: string, params: Record<string, string> = {}): string {
  const endpoint: EndpointDef = registry.get(endpointId)
  const path = endpoint.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name: string) => {
    const v = params[name]
    if (v === undefined) throw new Error(`pathFor(${endpointId}): missing param "${name}"`)
    return encodeURIComponent(v)
  })
  return `/api/v1${path}`
}
