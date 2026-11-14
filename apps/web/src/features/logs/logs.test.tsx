import {
  exampleAuthState,
  exampleProject,
  exampleLogEntry,
  type Project,
  type RequestLogEntry,
} from '@mockbench/api-contract'
import { createMemoryHistory } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../app/App'
import { createAppRouter } from '../../app/router'
import { createQueryClient } from '../../lib/query-client'

const BASE = { ...exampleProject, slug: 'billing-api' }
const entry = (n: number, over: Partial<RequestLogEntry> = {}): RequestLogEntry => ({
  ...exampleLogEntry,
  id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  path: `/r/${n}`,
  ...over,
})

let activeVersion: Project['activeVersion'] = null
let rows: RequestLogEntry[] = []
let urls: URL[] = []

const server = setupServer(
  http.get('/api/v1/auth/me', () => HttpResponse.json(exampleAuthState)),
  http.get('/api/v1/projects/by-slug/:slug', () => HttpResponse.json({ ...BASE, activeVersion })),
  http.get('/api/v1/projects', () => HttpResponse.json({ items: [], nextCursor: null })),
  http.get('/api/v1/projects/:projectId/routes', () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  http.get('/api/v1/projects/:projectId/requests', ({ request }) => {
    const url = new URL(request.url)
    urls.push(url)
    const limit = Number(url.searchParams.get('limit') ?? 50)
    const start = Number(url.searchParams.get('cursor') ?? 0)
    const status = url.searchParams.get('status')
    const mockOnly = url.searchParams.get('mockError') === 'true'
    const matching = rows.filter(
      (r) => (!status || String(r.statusCode).startsWith(status[0]!)) && (!mockOnly || r.mockError),
    )
    const items = matching.slice(start, start + limit)
    const next = start + limit < matching.length ? String(start + limit) : null
    return HttpResponse.json({ items, nextCursor: next })
  }),
)

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
  const intercepted = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    intercepted(typeof input === 'string' ? new URL(input, window.location.origin) : input, init),
  )
})
afterEach(() => server.resetHandlers())
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  window.scrollTo = vi.fn()
  activeVersion = {
    id: exampleProject.activeVersion?.id ?? entry(0).id,
    label: 'v1',
    deployedAt: entry(0).createdAt,
  }
  rows = []
  urls = []
})

function mount(path = '/p/billing-api/logs') {
  const queryClient = createQueryClient()
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<App queryClient={queryClient} router={router} />)
  return router
}

describe('request log filters in the URL', () => {
  it('loads filters from the URL on first render', async () => {
    rows = [entry(1, { statusCode: 404, mockError: 'route_not_found' })]
    mount('/p/billing-api/logs?status=4xx&method=GET&path=inv&mockError=true')
    await screen.findByText('/r/1')
    const u = urls.at(-1)!
    expect(u.searchParams.get('status')).toBe('4xx')
    expect(u.searchParams.get('method')).toBe('GET')
    expect(u.searchParams.get('path')).toBe('inv')
    expect(u.searchParams.get('mockError')).toBe('true')
    expect(screen.getByLabelText('Filter by path')).toHaveValue('inv')
    expect(screen.getByLabelText('Mock-server errors only')).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('4xx')
  })

  it('changing a filter updates the URL (replace), and the path waits for its debounce', async () => {
    rows = [entry(1)]
    const router = mount()
    await screen.findByText('/r/1')
    fireEvent.click(screen.getByLabelText('Mock-server errors only'))
    await waitFor(() => expect(router.state.location.search).toMatchObject({ mockError: true }))
    expect(router.history.length).toBe(1)

    fireEvent.change(screen.getByLabelText('Filter by path'), { target: { value: 'invoices' } })
    expect(router.state.location.search).not.toHaveProperty('path')
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ path: 'invoices', mockError: true }),
    )
    expect(router.history.length).toBe(1)
    await waitFor(() =>
      expect(urls.some((u) => u.searchParams.get('path') === 'invoices')).toBe(true),
    )
  })

  it('a reload (fresh mount on the resulting URL) keeps the filters', async () => {
    rows = [entry(1, { mockError: 'route_not_found' })]
    const first = mount()
    await screen.findByText('/r/1')
    fireEvent.click(screen.getByLabelText('Mock-server errors only'))
    await waitFor(() => expect(first.state.location.search).toMatchObject({ mockError: true }))
    const href = first.state.location.href
    cleanup()
    urls = []
    mount(href)
    await screen.findByText('/r/1')
    expect(screen.getByLabelText('Mock-server errors only')).toBeChecked()
    expect(urls.at(-1)!.searchParams.get('mockError')).toBe('true')
  })

  it('invalid search params fall back to defaults', async () => {
    rows = [entry(1)]
    mount('/p/billing-api/logs?status=bogus&method=TRACE&mockError=maybe&since=yesterday')
    await screen.findByText('/r/1')
    const u = urls.at(-1)!
    for (const k of ['status', 'method', 'mockError', 'since', 'path']) {
      expect(u.searchParams.has(k)).toBe(false)
    }
    expect(screen.getByLabelText('Mock-server errors only')).not.toBeChecked()
  })
})

describe('request log screen', () => {
  it('renders rows with method badge, status chip classes and the mock-server tag + hint', async () => {
    rows = [
      entry(1, { statusCode: 200, method: 'GET', caseName: 'Found' }),
      entry(2, { statusCode: 404, mockError: 'route_not_found', caseName: null }),
      entry(3, { statusCode: 500 }),
    ]
    mount()
    expect(await screen.findByText('/r/1')).toBeInTheDocument()
    const chips = document.querySelectorAll('[data-status-class]')
    expect([...chips].map((c) => c.getAttribute('data-status-class'))).toEqual([
      '2xx',
      '4xx',
      '5xx',
    ])
    expect(screen.getAllByTestId('mock-error-tag')).toHaveLength(1)
    expect(
      screen.getByText(/mocked 404s are your own cases; these were generated by the server/),
    ).toBeInTheDocument()
    expect(screen.getByText(/pruned automatically/)).toBeInTheDocument()
  })

  it('expands a row to show headers (redacted) and query as key/value pairs', async () => {
    rows = [
      entry(1, {
        requestHeaders: { authorization: '[redacted]', accept: '*/*' },
        query: { page: '2', tag: ['a', 'b'] },
      }),
    ]
    mount()
    await userEvent.click(
      await screen.findByRole('button', { name: /Show details for GET \/r\/1/ }),
    )
    const details = await screen.findByTestId('log-details')
    expect(within(details).getByText('authorization')).toBeInTheDocument()
    expect(within(details).getByText('[redacted]')).toBeInTheDocument()
    expect(within(details).getByText('page')).toBeInTheDocument()
    expect(within(details).getByText('a, b')).toBeInTheDocument()
  })

  it('shows the empty state; without an active version it links to Versions', async () => {
    mount()
    expect(
      await screen.findByText(
        /No requests yet\. The log starts filling once this project is deployed\./,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Go to Versions/ })).toBeNull()
  })

  it('unpublished project: empty state plus a link to Versions', async () => {
    activeVersion = null
    mount()
    const link = await screen.findByRole('link', { name: /Go to Versions/ })
    expect(link).toHaveAttribute('href', '/p/billing-api/versions')
  })

  it('changing a filter re-queries with the parameters and resets the cursor; Load more appends', async () => {
    rows = Array.from({ length: 70 }, (_, i) => entry(i + 1, { statusCode: i % 2 ? 404 : 200 }))
    mount()
    expect(await screen.findByText('/r/1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('/r/70')).toBeInTheDocument()
    expect(urls.some((u) => u.searchParams.get('cursor') === '50')).toBe(true)

    urls = []
    fireEvent.change(screen.getByLabelText('Filter by path'), { target: { value: 'invoices' } })
    await waitFor(() =>
      expect(urls.some((u) => u.searchParams.get('path') === 'invoices')).toBe(true),
    )
    expect(urls.every((u) => !u.searchParams.has('cursor'))).toBe(true)

    urls = []
    fireEvent.click(screen.getByLabelText('Mock-server errors only'))
    await waitFor(() =>
      expect(urls.some((u) => u.searchParams.get('mockError') === 'true')).toBe(true),
    )
    expect(await screen.findByText('No requests match these filters.')).toBeInTheDocument()
  })

  it('status class filter sends status=4xx', async () => {
    rows = [entry(1, { statusCode: 200 }), entry(2, { statusCode: 404 })]
    mount()
    await screen.findByText('/r/1')
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: '4xx' }))
    await waitFor(() => expect(urls.some((u) => u.searchParams.get('status') === '4xx')).toBe(true))
    await waitFor(() => expect(screen.queryByText('/r/1')).toBeNull())
    expect(screen.getByText('/r/2')).toBeInTheDocument()
  })

  it('auto-refresh polls every 3 s, prepends new rows, and stops when paused', async () => {
    rows = [entry(1)]
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mount()
      expect(await screen.findByText('/r/1')).toBeInTheDocument()
      rows = [entry(2), entry(1)]
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100)
      })
      expect(await screen.findByText('/r/2')).toBeInTheDocument()
      const paths = screen.getAllByText(/^\/r\/\d$/).map((e) => e.textContent)
      expect(paths).toEqual(['/r/2', '/r/1'])

      fireEvent.click(screen.getByLabelText('Auto-refresh'))
      urls = []
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7000)
      })
      expect(urls).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
