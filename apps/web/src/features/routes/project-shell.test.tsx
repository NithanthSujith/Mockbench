import {
  exampleAuthState,
  exampleCase,
  exampleProject,
  exampleRoute,
  type Route,
} from '@mockbench/api-contract'
import { createMemoryHistory } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../app/App'
import { createAppRouter } from '../../app/router'
import { createQueryClient } from '../../lib/query-client'
import { getMockBaseUrl } from '../../lib/mock-url'
import { filterRoutes } from './ProjectRail'

const WS = exampleAuthState.workspaces[0]!
const PROJECT = { ...exampleProject, slug: 'billing-api', routeCount: 0 }
const mkRoute = (n: number, method: Route['method'], path: string): Route => ({
  ...exampleRoute,
  id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  projectId: PROJECT.id,
  method,
  path,
})

let role: 'owner' | 'editor' | 'viewer' = 'editor'
let projectStatus = 200
let routes: Route[] = []
let listCalls = 0
let createStatus: 'ok' | 'conflict' = 'ok'
let created: unknown[] = []
let deleted: string[] = []

const server = setupServer(
  http.get('/api/v1/auth/me', () =>
    HttpResponse.json({ ...exampleAuthState, workspaces: [{ ...WS, role }] }),
  ),
  http.get('/api/v1/projects/by-slug/:slug', ({ params }) =>
    projectStatus === 200 && params.slug === PROJECT.slug
      ? HttpResponse.json({ ...PROJECT, routeCount: routes.length })
      : HttpResponse.json({ error: 'not_found', message: 'nope', details: [] }, { status: 404 }),
  ),
  http.get('/api/v1/projects/:projectId/routes', () => {
    listCalls += 1
    return HttpResponse.json({ items: routes, nextCursor: null })
  }),
  // The route editor (BLD-05) loads the selected route and its cases.
  http.get('/api/v1/routes/:routeId', ({ params }) => {
    const found = routes.find((r) => r.id === params.routeId)
    return found
      ? HttpResponse.json(found)
      : HttpResponse.json({ error: 'not_found', message: 'nope', details: [] }, { status: 404 })
  }),
  http.get('/api/v1/routes/:routeId/cases', ({ params }) =>
    HttpResponse.json({
      items: [
        { ...exampleCase, id: `${params.routeId}-case`, routeId: params.routeId, isDefault: true },
      ],
      nextCursor: null,
    }),
  ),
  http.get('/api/v1/projects', () => HttpResponse.json({ items: [PROJECT], nextCursor: null })),
  http.post('/api/v1/projects/:projectId/routes', async ({ request }) => {
    const body = (await request.json()) as { method: Route['method']; path: string }
    created.push(body)
    if (createStatus === 'conflict') {
      return HttpResponse.json(
        { error: 'route_conflict', message: 'x', details: [{ routeId: routes[0]!.id }] },
        { status: 409 },
      )
    }
    const route = mkRoute(900, body.method, body.path)
    routes = [...routes, route]
    return HttpResponse.json(route, { status: 201 })
  }),
  http.delete('/api/v1/routes/:routeId', ({ params }) => {
    deleted.push(String(params.routeId))
    routes = routes.filter((r) => r.id !== params.routeId)
    return new HttpResponse(null, { status: 204 })
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
  role = 'editor'
  projectStatus = 200
  routes = []
  listCalls = 0
  createStatus = 'ok'
  created = []
  deleted = []
})

function mount(path = '/p/billing-api') {
  const queryClient = createQueryClient()
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<App queryClient={queryClient} router={router} />)
  return router
}

describe('filterRoutes', () => {
  it('matches on method and path substring, case-insensitively', () => {
    const list = [mkRoute(1, 'GET', '/Users/:id'), mkRoute(2, 'POST', '/orders')]
    expect(filterRoutes(list, 'user').map((r) => r.path)).toEqual(['/Users/:id'])
    expect(filterRoutes(list, 'post /ord').map((r) => r.path)).toEqual(['/orders'])
    expect(filterRoutes(list, '  ')).toHaveLength(2)
    expect(filterRoutes(list, 'zzz')).toEqual([])
  })
})

describe('project loader', () => {
  it('shows the not-found screen with no rail for a project the user cannot see', async () => {
    projectStatus = 404
    mount('/p/billing-api')
    expect(await screen.findByText('Page not found')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Project' })).toBeNull()
    expect(screen.queryByLabelText('Filter routes')).toBeNull()
  })

  it('redirects /p/:slug to the first route', async () => {
    routes = [mkRoute(1, 'GET', '/a'), mkRoute(2, 'POST', '/b')]
    const router = mount()
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/p/billing-api/routes/${routes[0]!.id}`),
    )
  })

  it('shows the topbar base URL from window.location', async () => {
    mount()
    const url = getMockBaseUrl('billing-api')
    expect(await screen.findByText(url)).toBeInTheDocument()
    expect(url.startsWith(window.location.origin)).toBe(true)
  })
})

describe('route rail', () => {
  it('lists routes with method badge and path, marks the current one, and sets a title', async () => {
    routes = [mkRoute(1, 'GET', '/a'), mkRoute(2, 'DELETE', '/a/very/long/:path')]
    mount(`/p/billing-api/routes/${routes[1]!.id}`)
    const current = await screen.findByRole('link', { name: /DELETE/ })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveAttribute('title', 'DELETE /a/very/long/:path')
    expect(current.querySelector('.truncate')).toHaveTextContent('/a/very/long/:path')
    expect(screen.getByRole('link', { name: /GET/ })).not.toHaveAttribute('aria-current')
  })

  it('filters client-side without a request and says when nothing matches', async () => {
    routes = [mkRoute(1, 'GET', '/users'), mkRoute(2, 'POST', '/orders')]
    mount(`/p/billing-api/routes/${routes[0]!.id}`)
    await screen.findByRole('link', { name: /orders/ })
    const calls = listCalls
    await userEvent.type(screen.getByLabelText('Filter routes'), 'post')
    expect(screen.queryByRole('link', { name: /users/ })).toBeNull()
    expect(screen.getByRole('link', { name: /orders/ })).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Filter routes'))
    await userEvent.type(screen.getByLabelText('Filter routes'), 'nothing')
    expect(screen.getByText('No route matches.')).toBeInTheDocument()
    expect(listCalls).toBe(calls)
  })

  it('empty project: "No routes yet" with New route for editors', async () => {
    mount()
    expect(await screen.findByText('No routes yet')).toBeInTheDocument()
    // One in the rail, one in the empty state.
    expect(screen.getAllByRole('button', { name: 'New route' })).toHaveLength(2)
  })

  it('viewers can select routes but have no New or Delete controls', async () => {
    role = 'viewer'
    routes = [mkRoute(1, 'GET', '/users')]
    mount(`/p/billing-api/routes/${routes[0]!.id}`)
    await screen.findByRole('link', { name: /users/ })
    expect(screen.queryByRole('button', { name: /new route/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^delete/i })).toBeNull()
  })

  it('viewers get no New route action in the empty state', async () => {
    role = 'viewer'
    mount()
    expect(await screen.findByText('No routes yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new route/i })).toBeNull()
  })
})

describe('new route dialog', () => {
  async function openDialog() {
    routes = [mkRoute(1, 'GET', '/users')]
    const router = mount(`/p/billing-api/routes/${routes[0]!.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'New route' }))
    return { router, dialog: within(await screen.findByRole('dialog')) }
  }

  it('validates the path live with parseRoutePath messages', async () => {
    const { dialog } = await openDialog()
    const input = dialog.getByLabelText('Path')
    await userEvent.type(input, 'users')
    expect(dialog.getByText('A path must start with "/".')).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Create route' })).toBeDisabled()
    await userEvent.clear(input)
    await userEvent.type(input, '/users/')
    expect(dialog.getByText('A path cannot end with "/".')).toBeInTheDocument()
    await userEvent.clear(input)
    await userEvent.type(input, '/users/:id')
    expect(dialog.queryByRole('alert')).toBeNull()
    expect(dialog.getByRole('button', { name: 'Create route' })).toBeEnabled()
  })

  it('shows the collision message with a link to the existing route', async () => {
    createStatus = 'conflict'
    const { dialog } = await openDialog()
    await userEvent.type(dialog.getByLabelText('Path'), '/users')
    await userEvent.click(dialog.getByRole('button', { name: 'Create route' }))
    expect(await dialog.findByText(/A GET route with this path already exists/)).toBeInTheDocument()
    expect(dialog.getByRole('link', { name: 'Open it' })).toHaveAttribute(
      'href',
      `/p/billing-api/routes/${routes[0]!.id}`,
    )
  })

  it('creates the route and selects it', async () => {
    const { router, dialog } = await openDialog()
    await userEvent.type(dialog.getByLabelText('Path'), '/invoices/:id')
    await userEvent.click(dialog.getByRole('button', { name: 'Create route' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/p/billing-api/routes/${routes[1]!.id}`),
    )
    expect(created).toEqual([{ method: 'GET', path: '/invoices/:id' }])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('delete route', () => {
  it('confirms by naming METHOD /path, then selects the next route', async () => {
    routes = [mkRoute(1, 'GET', '/a'), mkRoute(2, 'POST', '/b'), mkRoute(3, 'PUT', '/c')]
    const router = mount(`/p/billing-api/routes/${routes[1]!.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete POST /b' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('POST /b')).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Delete route' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/p/billing-api/routes/${mkRoute(3, 'PUT', '/c').id}`,
      ),
    )
    expect(deleted).toEqual([mkRoute(2, 'POST', '/b').id])
    expect(screen.queryByRole('link', { name: /\/b/ })).toBeNull()
  })

  it('shows the empty state after deleting the last route', async () => {
    routes = [mkRoute(1, 'GET', '/a')]
    mount(`/p/billing-api/routes/${routes[0]!.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete GET /a' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete route' }),
    )
    expect(await screen.findByText('No routes yet')).toBeInTheDocument()
  })
})
