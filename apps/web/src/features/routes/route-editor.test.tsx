import {
  exampleAuthState,
  exampleCase,
  exampleProject,
  exampleRoute,
  type ResponseCase,
  type Route,
} from '@mockbench/api-contract'
import { createMemoryHistory } from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../app/App'
import { createAppRouter } from '../../app/router'
import { createQueryClient } from '../../lib/query-client'
import { checkHeaderRows } from './HeadersEditor'
import { uniqueCaseName } from './NewCaseDialog'
import { parseDelay } from './CaseBar'

const WS = exampleAuthState.workspaces[0]!
const PROJECT = { ...exampleProject, slug: 'billing-api' }
const ROUTE_ID = '00000000-0000-7000-8000-000000000001'
const mkCase = (n: number, patch: Partial<ResponseCase> = {}): ResponseCase => ({
  ...exampleCase,
  id: `00000000-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`,
  routeId: ROUTE_ID,
  name: n === 1 ? 'OK' : `Case ${n}`,
  statusCode: 200,
  headers: {},
  delayMs: null,
  isDefault: n === 1,
  ...patch,
})

let role: 'owner' | 'editor' | 'viewer' = 'editor'
let cases: ResponseCase[] = []
let route: Route
let routePatches: unknown[] = []
let casePatches: unknown[] = []
let routeUpdateError: 'none' | 'conflict' = 'none'
let caseUpdateError = false
let createCaseError = false
let deletedCases: string[] = []

const summaries = () =>
  cases.map((c) => ({ id: c.id, name: c.name, statusCode: c.statusCode, isDefault: c.isDefault }))

const server = setupServer(
  http.get('/api/v1/auth/me', () =>
    HttpResponse.json({ ...exampleAuthState, workspaces: [{ ...WS, role }] }),
  ),
  http.get('/api/v1/projects/by-slug/:slug', () =>
    HttpResponse.json({ ...PROJECT, settings: { ...PROJECT.settings, defaultDelayMs: 250 } }),
  ),
  http.get('/api/v1/projects', () => HttpResponse.json({ items: [PROJECT], nextCursor: null })),
  http.get('/api/v1/projects/:projectId/routes', () =>
    HttpResponse.json({ items: [{ ...route, cases: summaries() }], nextCursor: null }),
  ),
  http.get('/api/v1/routes/:routeId', ({ params }) =>
    params.routeId === ROUTE_ID
      ? HttpResponse.json({ ...route, cases: summaries() })
      : HttpResponse.json({ error: 'not_found', message: 'nope', details: [] }, { status: 404 }),
  ),
  http.patch('/api/v1/routes/:routeId', async ({ request }) => {
    const body = (await request.json()) as Partial<Route>
    routePatches.push(body)
    if (routeUpdateError === 'conflict') {
      return HttpResponse.json(
        { error: 'route_conflict', message: 'That route already exists.', details: [] },
        { status: 409 },
      )
    }
    route = { ...route, ...body }
    return HttpResponse.json({ ...route, cases: summaries() })
  }),
  http.get('/api/v1/routes/:routeId/cases', () =>
    HttpResponse.json({ items: cases, nextCursor: null }),
  ),
  http.post('/api/v1/routes/:routeId/cases', async ({ request }) => {
    const body = (await request.json()) as { name: string; statusCode: number }
    if (createCaseError) {
      return HttpResponse.json(
        { error: 'case_name_taken', message: 'A case with this name already exists.', details: [] },
        { status: 409 },
      )
    }
    const created = mkCase(50 + cases.length, { ...body, isDefault: false })
    cases = [...cases, created]
    return HttpResponse.json(created, { status: 201 })
  }),
  http.patch('/api/v1/cases/:caseId', async ({ request, params }) => {
    const body = (await request.json()) as Partial<ResponseCase>
    casePatches.push(body)
    if (caseUpdateError) {
      return HttpResponse.json(
        { error: 'internal_error', message: 'Database is unavailable.', details: [] },
        { status: 500 },
      )
    }
    cases = cases.map((c) => (c.id === params.caseId ? { ...c, ...body } : c))
    return HttpResponse.json(cases.find((c) => c.id === params.caseId))
  }),
  http.post('/api/v1/cases/:caseId/default', ({ params }) => {
    cases = cases.map((c) => ({ ...c, isDefault: c.id === params.caseId }))
    return HttpResponse.json(cases.find((c) => c.id === params.caseId))
  }),
  http.delete('/api/v1/cases/:caseId', ({ params }) => {
    deletedCases.push(String(params.caseId))
    cases = cases.filter((c) => c.id !== params.caseId)
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
afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
})
afterAll(() => {
  server.close()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  window.scrollTo = vi.fn()
  role = 'editor'
  cases = [mkCase(1), mkCase(2, { statusCode: 400 })]
  route = {
    ...exampleRoute,
    id: ROUTE_ID,
    projectId: PROJECT.id,
    method: 'GET',
    path: '/a/:id',
    description: null,
  }
  routePatches = []
  casePatches = []
  routeUpdateError = 'none'
  caseUpdateError = false
  createCaseError = false
  deletedCases = []
})

function mount(path: string) {
  const queryClient = createQueryClient()
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<App queryClient={queryClient} router={router} />)
  return router
}
const base = `/p/billing-api/routes/${ROUTE_ID}`

describe('helpers', () => {
  it('proposes unique case names', () => {
    expect(uniqueCaseName([])).toBe('New case')
    expect(uniqueCaseName(['New case'])).toBe('New case 2')
    expect(uniqueCaseName(['new CASE', 'New case 2'])).toBe('New case 3')
  })
  it('parses delay', () => {
    expect(parseDelay('')).toEqual({ ok: true, value: null })
    expect(parseDelay('0')).toEqual({ ok: true, value: 0 })
    expect(parseDelay('10000')).toEqual({ ok: true, value: 10000 })
    expect(parseDelay('10001').ok).toBe(false)
    expect(parseDelay('-1').ok).toBe(false)
    expect(parseDelay('1.5').ok).toBe(false)
  })
  it('rejects reserved header names with the contract message', () => {
    for (const name of ['Content-Length', 'X-Mock-Error', 'Access-Control-Allow-Origin']) {
      const { errors } = checkHeaderRows([{ key: 1, name, value: 'x' }])
      expect(errors.get(1)).toMatch(/set by the mock server/)
    }
    expect(checkHeaderRows([{ key: 1, name: 'X-Ok', value: 'x' }]).errors.size).toBe(0)
  })
})

describe('case selection in the URL', () => {
  it('redirects a route with no case to the default case', async () => {
    cases = [mkCase(2, { statusCode: 400 }), mkCase(1)]
    const router = mount(base)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`${base}/cases/${mkCase(1).id}`),
    )
  })

  it('switching a tab changes the URL', async () => {
    const router = mount(`${base}/cases/${mkCase(1).id}`)
    await userEvent.click(await screen.findByRole('tab', { name: /Case 2/ }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`${base}/cases/${mkCase(2).id}`),
    )
  })

  it('shows not-found for a case that belongs to another route', async () => {
    mount(`${base}/cases/00000000-0000-7000-8000-00000000ffff`)
    expect(await screen.findByText('Page not found')).toBeInTheDocument()
  })
})

describe('case metadata', () => {
  it('updates the chip class optimistically and persists a status change', async () => {
    mount(`${base}/cases/${mkCase(1).id}`)
    const status = await screen.findByRole('combobox', { name: 'Status' })
    await userEvent.click(status)
    await userEvent.click(await screen.findByRole('option', { name: '404' }))
    await waitFor(() => {
      const chip = within(screen.getByRole('tab', { name: /OK/ })).getByText('404')
      expect(chip).toHaveAttribute('data-status-class', '4xx')
    })
    await waitFor(() => expect(casePatches).toEqual([{ statusCode: 404 }]))
  })

  it('offers exactly the 14 curated status codes', async () => {
    mount(`${base}/cases/${mkCase(1).id}`)
    await userEvent.click(await screen.findByRole('combobox', { name: 'Status' }))
    expect(await screen.findAllByRole('option')).toHaveLength(14)
  })

  it('reverts and shows the message when the server rejects a status change', async () => {
    caseUpdateError = true
    mount(`${base}/cases/${mkCase(1).id}`)
    await userEvent.click(await screen.findByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: '500' }))
    expect(await screen.findByText('Database is unavailable.')).toBeInTheDocument()
    await waitFor(() =>
      expect(within(screen.getByRole('tab', { name: /OK/ })).getByText('200')).toHaveAttribute(
        'data-status-class',
        '2xx',
      ),
    )
  })

  it('shows the project default delay hint and sends null for an empty delay', async () => {
    cases = [mkCase(1, { delayMs: 100 }), mkCase(2)]
    mount(`${base}/cases/${mkCase(1).id}`)
    const delay = await screen.findByLabelText('Delay (ms)')
    await userEvent.clear(delay)
    expect(screen.getByText('Inherits the project default (250 ms)')).toBeInTheDocument()
    await waitFor(() => expect(casePatches).toEqual([{ delayMs: null }]), { timeout: 3000 })
  })

  it('does not send an out-of-range delay', async () => {
    mount(`${base}/cases/${mkCase(1).id}`)
    await userEvent.type(await screen.findByLabelText('Delay (ms)'), '10001')
    expect(await screen.findByText(/whole number from 0 to 10000/)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 900))
    expect(casePatches).toEqual([])
  })

  it('rejects a reserved header before sending and allows add and remove', async () => {
    mount(`${base}/cases/${mkCase(1).id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Add header' }))
    await userEvent.type(screen.getByLabelText('Header name'), 'X-Mock-Thing')
    await userEvent.type(screen.getByLabelText('Header value'), 'v')
    expect(await screen.findByText(/set by the mock server/)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 900))
    expect(casePatches).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Remove header' }))
    expect(screen.queryByLabelText('Header name')).toBeNull()
  })

  it('shows No response body for a 204 case', async () => {
    cases = [mkCase(1, { statusCode: 204 })]
    mount(`${base}/cases/${mkCase(1).id}`)
    expect(await screen.findByText('No response body')).toBeInTheDocument()
    expect(document.querySelector('[data-screen="schema-builder/SchemaEditorSlot"]')).toBeNull()
  })
})

describe('adding, defaulting and deleting cases', () => {
  it('creates a case with a unique default name and selects it', async () => {
    cases = [mkCase(1, { name: 'New case' })]
    const router = mount(`${base}/cases/${mkCase(1).id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Case' }))
    const input = await screen.findByLabelText('Name')
    expect(input).toHaveValue('New case 2')
    await userEvent.click(screen.getByRole('button', { name: 'Create case' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/cases\/.*151$/))
  })

  it('shows case_name_taken inline', async () => {
    createCaseError = true
    mount(`${base}/cases/${mkCase(1).id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Case' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Create case' }))
    expect(await screen.findByText('A case with this name already exists.')).toBeInTheDocument()
  })

  it('moves the default star with Make default', async () => {
    mount(`${base}/cases/${mkCase(2).id}`)
    await userEvent.click(await screen.findByRole('button', { name: /Make default/ }))
    await waitFor(() => expect(cases.find((c) => c.isDefault)?.id).toBe(mkCase(2).id))
    await waitFor(() =>
      expect(within(screen.getByRole('tab', { name: /Case 2/ })).getByLabelText('Default case')),
    )
  })

  it('disables deleting the default case with a tooltip', async () => {
    mount(`${base}/cases/${mkCase(1).id}`)
    const del = await screen.findByRole('button', { name: /Delete case/ })
    expect(del).toBeDisabled()
    expect(del.parentElement).toHaveAttribute('title', 'Make another case the default first')
  })

  it('deleting another case selects the default case', async () => {
    const router = mount(`${base}/cases/${mkCase(2).id}`)
    await userEvent.click(await screen.findByRole('button', { name: /Delete case/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete case' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`${base}/cases/${mkCase(1).id}`),
    )
    expect(deletedCases).toEqual([mkCase(2).id])
  })
})

describe('route header', () => {
  it('flags an invalid path live and does not send it', async () => {
    mount(`${base}/cases/${mkCase(1).id}`)
    const path = await screen.findByLabelText('Path')
    await userEvent.clear(path)
    await userEvent.type(path, 'no-slash')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 900))
    expect(routePatches).toEqual([])
  })

  it('shows the conflict message inline and reverts the field', async () => {
    routeUpdateError = 'conflict'
    mount(`${base}/cases/${mkCase(1).id}`)
    const path = await screen.findByLabelText('Path')
    await userEvent.clear(path)
    await userEvent.type(path, '/taken')
    expect(
      await screen.findByText('That route already exists.', {}, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(path).toHaveValue('/a/:id')
  })

  it('sends one request after a burst of typing and shows Saving then Saved', async () => {
    mount(`${base}/cases/${mkCase(1).id}`)
    const description = await screen.findByLabelText('Description')
    await userEvent.type(description, 'hello world')
    expect(routePatches).toEqual([])
    expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(routePatches).toEqual([{ description: 'hello world' }])
  })
})

describe('viewer', () => {
  it('disables inputs, does not autosave, and still switches tabs', async () => {
    role = 'viewer'
    const router = mount(`${base}/cases/${mkCase(1).id}`)
    expect(await screen.findByLabelText('Path')).toBeDisabled()
    expect(screen.getByLabelText('Description')).toBeDisabled()
    expect(screen.getByLabelText('Case name')).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Case' })).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: /Case 2/ }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`${base}/cases/${mkCase(2).id}`),
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800))
    })
    expect(routePatches).toEqual([])
    expect(casePatches).toEqual([])
  })
})
