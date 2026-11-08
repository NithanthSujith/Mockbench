import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { api } from './client'
import { ApiError } from './errors'
import type { RequestOptions } from './types'
import { resetUnauthenticated, setUnauthenticatedHandler } from './unauthenticated'

const WS = '0192f7a0-0000-7000-8000-000000000001'

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  resetUnauthenticated()
})
afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthenticatedHandler(undefined)
})

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init, headers: init.headers as Record<string, string> }
}

describe('API client requests', () => {
  it('api.projects.list issues a RELATIVE /api/v1 URL with the query string', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }))
    await api.projects.list({ query: { workspaceId: WS } })
    const { url, init } = lastCall()
    expect(url).toBe(`/api/v1/projects?workspaceId=${WS}`)
    expect(url.startsWith('/')).toBe(true)
    expect(url).not.toMatch(/^[a-z]+:\/\//)
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
  })

  it('a POST carries X-Mockbench-Client: web and a JSON body; a GET does not carry the header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'p1' }, 201))
    await api.projects.create({ body: { workspaceId: WS, name: 'Billing', slug: 'billing-api' } })
    const post = lastCall()
    expect(post.init.method).toBe('POST')
    expect(post.headers['X-Mockbench-Client']).toBe('web')
    expect(post.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(post.init.body as string)).toEqual({
      workspaceId: WS,
      name: 'Billing',
      slug: 'billing-api',
    })

    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }))
    await api.projects.list({ query: { workspaceId: WS } })
    expect(lastCall().headers['X-Mockbench-Client']).toBeUndefined()
  })

  it('a bodyless non-safe request (DELETE) still carries the CSRF header and no Content-Type', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const result = await api.projects.delete({ params: { projectId: 'p1' } })
    const { url, init, headers } = lastCall()
    expect(url).toBe('/api/v1/projects/p1')
    expect(init.method).toBe('DELETE')
    expect(headers['X-Mockbench-Client']).toBe('web')
    expect(headers['Content-Type']).toBeUndefined()
    expect(init.body).toBeUndefined()
    expect(result).toBeUndefined()
  })

  it('encodes path parameters and omits empty/undefined query values', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await api.projects.getBySlug({ params: { slug: 'a b/c' } })
    expect(lastCall().url).toBe('/api/v1/projects/by-slug/a%20b%2Fc')

    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }))
    await api.requests.list({
      params: { projectId: 'p1' },
      query: { status: '4xx', path: undefined, limit: 20 },
    })
    expect(lastCall().url).toBe('/api/v1/projects/p1/requests?status=4xx&limit=20')
  })

  it('fails loudly when a path parameter is missing', async () => {
    await expect(
      // @ts-expect-error deliberately omitting a required path parameter
      api.projects.get({ params: {} }),
    ).rejects.toThrow(/Missing path parameter "projectId"/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('takes no arguments for endpoints with no input (types and runtime)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: {}, workspaces: [] }))
    await api.auth.me()
    expect(lastCall().url).toBe('/api/v1/auth/me')
    expectTypeOf(api.auth.me).parameters.toEqualTypeOf<
      [input?: unknown, options?: RequestOptions]
    >()
  })

  it('requires the query when the endpoint requires one (compile-time)', () => {
    expectTypeOf(api.projects.list).parameter(0).toHaveProperty('query')
    // @ts-expect-error workspaceId is required by projects.list
    void (() => api.projects.list({ query: {} }))
  })
})

describe('ApiError', () => {
  it('is thrown for a 404 envelope with code, status, message and details populated', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: 'not_found', message: 'No such project.', details: [{ path: ['slug'] }] },
        404,
      ),
    )
    const err = await api.projects.get({ params: { projectId: 'nope' } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'No such project.',
      details: [{ path: ['slug'] }],
    })
  })

  it('tolerates a non-envelope body (e.g. a proxy 502 page) and a network failure', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }))
    await expect(api.auth.me()).rejects.toMatchObject({
      status: 502,
      code: 'http_502',
      details: [],
    })

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.auth.me()).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })

  it('does not swallow an aborted request', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(api.auth.me()).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('session ended (401 unauthenticated)', () => {
  const unauthenticated = () =>
    jsonResponse({ error: 'unauthenticated', message: 'Sign in.', details: [] }, 401)

  it('three parallel 401s fire the redirect handler exactly once, and it does not loop', async () => {
    const handler = vi.fn()
    setUnauthenticatedHandler(handler)
    fetchMock.mockImplementation(async () => unauthenticated())
    const calls = await Promise.allSettled([
      api.projects.get({ params: { projectId: 'a' } }),
      api.projects.get({ params: { projectId: 'b' } }),
      api.workspaces.list(),
    ])
    expect(calls.every((c) => c.status === 'rejected')).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)

    // Another 401 while the redirect is pending does not fire it again...
    await api.workspaces.list().catch(() => undefined)
    expect(handler).toHaveBeenCalledTimes(1)

    // ...until the app re-arms it (it does so when /login is reached).
    resetUnauthenticated()
    await api.workspaces.list().catch(() => undefined)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('a 401 with another code (invalid_credentials) never redirects', async () => {
    const handler = vi.fn()
    setUnauthenticatedHandler(handler)
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'invalid_credentials', message: 'No.', details: [] }, 401),
    )
    await api.auth.login({ body: { email: 'a@b.co', password: 'x' } }).catch(() => undefined)
    expect(handler).not.toHaveBeenCalled()
  })

  it('the session probe can opt out of the redirect', async () => {
    const handler = vi.fn()
    setUnauthenticatedHandler(handler)
    fetchMock.mockImplementation(async () => unauthenticated())
    await api.auth.me(undefined, { skipUnauthenticatedRedirect: true }).catch(() => undefined)
    expect(handler).not.toHaveBeenCalled()
  })
})
