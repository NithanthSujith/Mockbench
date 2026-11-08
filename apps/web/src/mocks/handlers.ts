// MSW handlers generated from the contract registry: every endpoint answers with its `example`
// payload at its documented success status. Used by `pnpm dev:mock` (browser) and by tests (node).
// Feature teams add richer fixtures in features/<area>/__mocks__/handlers.ts; those win over the
// generated ones. This module is NEVER imported by production code.
import { registry, type EndpointDef } from '@mockbench/api-contract'
import { HttpResponse, http, type RequestHandler } from 'msw'

const API_BASE = '/api/v1'

function lowestSuccess(responses: Record<number, unknown>): number {
  return Math.min(
    ...Object.keys(responses)
      .map(Number)
      .filter((s) => s >= 200 && s < 300),
  )
}

/** One handler per endpoint path (primary, aliases, and the bare-root alias when it has one). */
export function generatedHandlers(): RequestHandler[] {
  const handlers: RequestHandler[] = []
  for (const endpoint of registry.endpoints as readonly EndpointDef[]) {
    const status = lowestSuccess(endpoint.responses)
    const bodyless = endpoint.responses[status] === null
    const example = endpoint.example.response
    const verb = http[endpoint.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete']
    const paths = [endpoint.path, ...(endpoint.aliases ?? [])].map((p) => `${API_BASE}${p}`)
    if (endpoint.alsoAtRoot) paths.push(endpoint.path)
    for (const path of paths) {
      handlers.push(
        verb(path, () =>
          bodyless || example === undefined
            ? new HttpResponse(null, { status })
            : HttpResponse.json(example as Record<string, unknown>, { status }),
        ),
      )
    }
  }
  return handlers
}

// features/<area>/__mocks__/handlers.ts each export `handlers: RequestHandler[]`.
const featureModules = import.meta.glob<{ handlers: RequestHandler[] }>(
  '../features/*/__mocks__/handlers.ts',
  { eager: true },
)

export function featureHandlers(): RequestHandler[] {
  return Object.values(featureModules).flatMap((m) => m.handlers)
}

/** Feature overrides first (MSW uses the first matching handler), then the generated ones. */
export function createHandlers(): RequestHandler[] {
  return [...featureHandlers(), ...generatedHandlers()]
}
