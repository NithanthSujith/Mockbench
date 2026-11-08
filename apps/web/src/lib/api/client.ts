import { ApiError, apiErrorFromResponse } from './errors'
import { ENDPOINT_TABLE, type EndpointId } from './endpoint-table.gen'
import type { Api, RequestOptions } from './types'
import { notifyUnauthenticated } from './unauthenticated'

/** Every control-plane request is relative to the origin the page was served from (LAN rule). */
export const API_BASE = '/api/v1'

type Primitive = string | number | boolean
type QueryValue = Primitive | null | undefined | readonly Primitive[]

interface RequestInput {
  params?: Record<string, unknown>
  query?: Record<string, QueryValue>
  body?: unknown
}

function buildPath(template: string, params: Record<string, unknown> = {}): string {
  return template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing path parameter "${name}" for ${template}`)
    }
    return encodeURIComponent(String(value))
  })
}

function buildQuery(query: Record<string, QueryValue> = {}): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) for (const v of value) search.append(key, String(v))
    else search.append(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** Performs one request for an endpoint id; throws ApiError for every non-2xx and network failure. */
export async function request(
  id: EndpointId,
  input: RequestInput = {},
  options: RequestOptions = {},
): Promise<unknown> {
  const endpoint = ENDPOINT_TABLE[id]
  const url = `${API_BASE}${buildPath(endpoint.path, input.params)}${buildQuery(input.query)}`

  const headers: Record<string, string> = { Accept: 'application/json' }
  // CSRF guard (API-CONTRACT 1.1): every non-safe request carries this custom header.
  if (endpoint.method !== 'GET') headers['X-Mockbench-Client'] = 'web'
  let body: string | undefined
  if (input.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(input.body)
  }

  let res: Response
  try {
    res = await globalThis.fetch(url, {
      method: endpoint.method,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(0, 'network_error', 'Could not reach the server.')
  }

  if (!res.ok) {
    const error = await apiErrorFromResponse(res)
    if (
      res.status === 401 &&
      error.code === 'unauthenticated' &&
      !options.skipUnauthenticatedRedirect
    ) {
      notifyUnauthenticated()
    }
    throw error
  }
  if (endpoint.bodyless || res.status === 204) return undefined
  const text = await res.text()
  return text ? (JSON.parse(text) as unknown) : undefined
}

function buildApi(): Api {
  const api: Record<string, Record<string, unknown>> = {}
  for (const id of Object.keys(ENDPOINT_TABLE) as EndpointId[]) {
    const [area, operation] = id.split('.') as [string, string]
    ;(api[area] ??= {})[operation] = (input?: RequestInput, options?: RequestOptions) =>
      request(id, input, options)
  }
  return api as unknown as Api
}

/** `api.projects.list({ query: { workspaceId } })`: one function per contract endpoint id. */
export const api: Api = buildApi()
