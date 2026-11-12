import {
  exampleCase,
  exampleProject,
  exampleRoute,
  type ResponseCase,
} from '@mockbench/api-contract'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui'
import { buildCurl } from './snippet'
import { TryItPanel } from './TryItPanel'

const O = window.location.origin
const route = { ...exampleRoute, method: 'GET' as const, path: '/users/:id' }
const found: ResponseCase = { ...exampleCase, id: 'c-found', name: 'Found', isDefault: true }
const mk = (patch: Partial<ResponseCase>): ResponseCase => ({
  ...found,
  isDefault: false,
  ...patch,
})

let activeVersion: { id: string; label: string } | null = { id: 'v', label: 'v3' }
const server = setupServer(
  http.get('/api/v1/projects/:projectId', () =>
    HttpResponse.json({ ...exampleProject, slug: 'shop-api', activeVersion }),
  ),
)
let mockFetch: ((url: string, init?: RequestInit) => Promise<Response>) | null = null
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
})
afterEach(() => {
  server.resetHandlers()
  vi.unstubAllGlobals()
})
afterAll(() => server.close())
beforeEach(() => {
  mockFetch = null
  const intercepted = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    typeof input === 'string' && input.startsWith('/mock/') && mockFetch
      ? mockFetch(input, init)
      : intercepted(
          typeof input === 'string' ? new URL(input, window.location.origin) : input,
          init,
        ),
  )
  activeVersion = { id: 'v', label: 'v3' }
})

function mount(c: ResponseCase, r = route) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TryItPanel case={c} route={r} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('buildCurl', () => {
  const cases: [string, string, string, Partial<ResponseCase>, string][] = [
    ['default case, GET', 'GET', '/users/:id', {}, `curl -i ${O}/mock/shop-api/users/42`],
    [
      'other param is 7',
      'GET',
      '/orgs/:orgId/users/:id',
      {},
      `curl -i ${O}/mock/shop-api/orgs/7/users/42`,
    ],
    ['non-GET', 'POST', '/users', {}, `curl -i ${O}/mock/shop-api/users \\\n  -X POST`],
    [
      'named case',
      'GET',
      '/users',
      { isDefault: false, name: 'Not found' },
      `curl -i ${O}/mock/shop-api/users \\\n  -H 'X-Mock-Case: Not found'`,
    ],
    [
      'quote uses id',
      'DELETE',
      '/users/:id',
      { isDefault: false, name: "it's", id: 'case-9' },
      `curl -i ${O}/mock/shop-api/users/42 \\\n  -X DELETE \\\n  -H 'X-Mock-Case: case-9'`,
    ],
    [
      'non-ASCII uses id',
      'GET',
      '/users',
      { isDefault: false, name: 'Café', id: 'case-8' },
      `curl -i ${O}/mock/shop-api/users \\\n  -H 'X-Mock-Case: case-8'`,
    ],
  ]
  it.each(cases)('%s', (_n, method, path, patch, expected) => {
    expect(buildCurl('shop-api', { method, path } as never, { ...found, ...patch })).toBe(expected)
  })

  it('uses the host the browser reached, never a hardcoded one', () => {
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      origin: 'http://192.168.1.24:8080',
      host: '192.168.1.24:8080',
    } as Location)
    expect(
      buildCurl('s', route, found).startsWith('curl -i http://192.168.1.24:8080/mock/s/'),
    ).toBe(true)
    vi.restoreAllMocks()
  })
})

describe('TryItPanel', () => {
  it('shows the curl, the deployed-version notice and the LAN footer when live', async () => {
    mount(found)
    expect(await screen.findByText(/^curl -i http/)).toHaveTextContent('/mock/shop-api/users/42')
    expect(screen.getByText('Calls the deployed version, not your draft')).toBeInTheDocument()
    expect(screen.getByText('Any machine on the LAN can call this now.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('disables Send and says why when nothing is deployed', async () => {
    activeVersion = null
    mount(found)
    await screen.findAllByText('Publish and deploy this project before the URL answers')
    expect(
      screen.getAllByText('Publish and deploy this project before the URL answers'),
    ).toHaveLength(2)
  })

  it('copy falls back to selecting the snippet outside a secure context, without throwing', async () => {
    vi.stubGlobal('isSecureContext', false)
    mount(found)
    await screen.findByText(/^curl -i http/)
    fireEvent.click(screen.getByRole('button', { name: 'Copy curl command' }))
    expect(await screen.findByText('Selected — press Ctrl/Cmd+C')).toBeInTheDocument()
    expect(window.getSelection()?.toString()).toContain('curl -i')
  })

  it('copy uses navigator.clipboard in a secure context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    mount(found)
    await screen.findByText(/^curl -i http/)
    fireEvent.click(screen.getByRole('button', { name: 'Copy curl command' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('curl -i')))
  })

  it('Send fetches the relative mock URL with the case header and shows the response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"id":42}', {
        status: 404,
        headers: {
          'X-Mock-Version': 'v3',
          'X-Mock-Case': 'Not found',
          'X-Mock-Route': 'GET /users/:id',
        },
      }),
    )
    mount(mk({ name: 'Not found', statusCode: 404 }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    mockFetch = fetchSpy
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByLabelText('Response body')).toHaveTextContent('{"id":42}')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/mock/shop-api/users/42',
      expect.objectContaining({ method: 'GET', headers: { 'X-Mock-Case': 'Not found' } }),
    )
    const headers = screen.getByLabelText('Response headers')
    expect(headers).toHaveTextContent('X-Mock-Version')
    expect(headers).toHaveTextContent('v3')
    expect(screen.queryByText('Mock server error')).toBeNull()
    expect(screen.getByText(/\d+ ms/)).toBeInTheDocument()
  })

  it('labels an X-Mock-Error response as a mock server error with its hint', async () => {
    mount(found)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    mockFetch = vi.fn().mockResolvedValue(
      new Response(
        '{"error":"case_not_found","message":"m","hint":"Use one of the listed cases"}',
        {
          status: 400,
          headers: { 'X-Mock-Error': 'true' },
        },
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Mock server error')).toBeInTheDocument()
    expect(screen.getByText(/— Use one of the listed cases/)).toBeInTheDocument()
  })

  it('shows the error text when the request fails', async () => {
    mount(found)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch')
  })
})
