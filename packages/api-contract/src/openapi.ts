// OpenAPI 3.1 generator. SEPARATE ENTRY POINT ('@mockbench/api-contract/openapi'):
// never import this from the main entry or from web code.
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi'
import { ErrorEnvelope } from './primitives'
import type { AuthLevel } from './primitives'
import type { EndpointDef, Registry } from './registry'

export const SESSION_SECURITY_SCHEME = 'mockbench_session'

export interface OpenApiOptions {
  title?: string
  version?: string
  description?: string
}

/** `/projects/:projectId` -> `/projects/{projectId}` */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
}

const ROLE_LEVELS: readonly AuthLevel[] = ['viewer', 'editor', 'owner']

/** Statuses every endpoint can produce implicitly (API-CONTRACT 1.3 legend), with their codes. */
function implicitErrors(e: EndpointDef): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>()
  const add = (status: number, code: string) => {
    let set = out.get(status)
    if (!set) out.set(status, (set = new Set()))
    set.add(code)
  }
  const hasInput = Boolean(e.params ?? e.query ?? e.body)
  if (e.auth !== 'public') add(401, 'unauthenticated')
  if (ROLE_LEVELS.includes(e.auth)) {
    add(403, 'forbidden')
    add(404, 'not_found')
  }
  if (e.method !== 'GET') add(403, 'csrf_rejected')
  if (e.body) {
    add(400, 'invalid_json')
    add(413, 'payload_too_large')
    add(415, 'unsupported_media_type')
  }
  if (hasInput) add(422, 'validation_failed')
  add(429, 'rate_limited')
  add(500, 'internal_error')
  for (const x of e.errors) add(x.status, x.code)
  return out
}

/** Generates an OpenAPI 3.1 document from a registry. Paths are relative to the `/api/v1` server. */
export function generateOpenApi(registry: Registry, options: OpenApiOptions = {}) {
  const oa = new OpenAPIRegistry()
  oa.registerComponent('securitySchemes', SESSION_SECURITY_SCHEME, {
    type: 'apiKey',
    in: 'cookie',
    name: 'mockbench_session',
    description:
      'Opaque session cookie set by auth.login / auth.register. Non-safe requests must also send X-Mockbench-Client.',
  })

  for (const e of registry.endpoints) {
    const responses: Record<string, unknown> = {}
    for (const [statusKey, schema] of Object.entries(e.responses)) {
      const status = Number(statusKey)
      const example = status >= 200 && status < 300 ? e.example.response : undefined
      responses[statusKey] = schema
        ? {
            description: 'Success',
            content: {
              'application/json': { schema, ...(example === undefined ? {} : { example }) },
            },
          }
        : { description: 'Success (no body)' }
    }
    for (const [status, codes] of implicitErrors(e)) {
      if (responses[String(status)] !== undefined) continue
      responses[String(status)] = {
        description: `Error: ${[...codes].join(', ')}`,
        content: { 'application/json': { schema: ErrorEnvelope } },
      }
    }

    oa.registerPath({
      method: e.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete',
      path: toOpenApiPath(e.path),
      operationId: e.id,
      summary: e.summary ?? e.id,
      tags: [...e.tags],
      security: e.auth === 'public' ? [] : [{ [SESSION_SECURITY_SCHEME]: [] }],
      'x-mockbench-auth': e.auth,
      request: {
        ...(e.params ? { params: e.params } : {}),
        ...(e.query ? { query: e.query } : {}),
        ...(e.body
          ? {
              body: {
                required: true,
                content: {
                  'application/json': {
                    schema: e.body,
                    ...(e.example.request === undefined ? {} : { example: e.example.request }),
                  },
                },
              },
            }
          : {}),
      },
      responses: responses as never,
    } as never)
  }

  return new OpenApiGeneratorV31(oa.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'Mockbench control-plane API',
      version: options.version ?? '1',
      ...(options.description === undefined ? {} : { description: options.description }),
    },
    servers: [{ url: '/api/v1' }],
  })
}
