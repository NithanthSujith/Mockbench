import { registry, type EndpointDef } from '@mockbench/api-contract'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ENDPOINT_TABLE, type EndpointId } from '../lib/api/endpoint-table.gen'
import { request } from '../lib/api/client'
import { createHandlers, generatedHandlers } from './handlers'

const server = setupServer(...createHandlers())
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
  // Capture fetch AFTER listen(): MSW patches it. Node's fetch has no page to resolve relative URLs
  // against, so resolve them against the page origin like a browser would.
  const interceptedFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    interceptedFetch(
      typeof input === 'string' ? new URL(input, window.location.origin) : input,
      init,
    ),
  )
})
afterEach(() => server.resetHandlers())
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})

const endpoints = registry.endpoints as readonly EndpointDef[]

/** Fills `:param` placeholders so the request matches the handler pattern. */
function sampleParams(path: string): Record<string, string> {
  const params: Record<string, string> = {}
  for (const m of path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) params[m[1] as string] = 'sample'
  return params
}

describe('MSW mock mode serves every contract endpoint from its example', () => {
  it('has a handler for every endpoint path, alias and root alias', () => {
    const expected = endpoints.reduce(
      (n, e) => n + 1 + (e.aliases?.length ?? 0) + (e.alsoAtRoot ? 1 : 0),
      0,
    )
    expect(generatedHandlers()).toHaveLength(expected)
  })

  for (const endpoint of endpoints) {
    it(`${endpoint.id} -> ${endpoint.method} ${endpoint.path} answers with its example`, async () => {
      const id = endpoint.id as EndpointId
      const body = endpoint.example.request
      const result = await request(id, {
        params: sampleParams(endpoint.path),
        body,
      })
      const bodyless = ENDPOINT_TABLE[id].bodyless || endpoint.example.response === undefined
      if (bodyless) expect(result).toBeUndefined()
      else expect(result).toEqual(JSON.parse(JSON.stringify(endpoint.example.response)))
    })
  }

  it('the bare-root health aliases answer too (container healthchecks use them)', async () => {
    const res = await globalThis.fetch('/healthz')
    expect(res.status).toBe(200)
  })
})
