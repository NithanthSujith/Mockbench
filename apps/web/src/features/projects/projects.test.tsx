import { exampleAuthState, exampleProject, type Project } from '@mockbench/api-contract'
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
import { SLUG_FORMAT_RULE, SLUG_TAKEN_MESSAGE } from './slug'

const WS = exampleAuthState.workspaces[0]!
const project = (n: number, extra: Partial<Project> = {}): Project => ({
  ...exampleProject,
  id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  name: `Project ${n}`,
  slug: `project-${n}`,
  description: `About ${n}`,
  ...extra,
})

let role: 'owner' | 'editor' | 'viewer' = 'editor'
let all: Project[] = []
let created: unknown[] = []
let createStatus: 'ok' | 'taken' = 'ok'
let existing = new Set<string>()
const listCalls: (string | null)[] = []

const server = setupServer(
  http.get('/api/v1/auth/me', () =>
    HttpResponse.json({ ...exampleAuthState, workspaces: [{ ...WS, role }] }),
  ),
  http.get('/api/v1/projects/by-slug/:slug', ({ params }) => {
    const slug = String(params.slug)
    const found = all.find((p) => p.slug === slug)
    if (found) return HttpResponse.json(found)
    if (existing.has(slug)) return HttpResponse.json({ ...exampleProject, slug })
    return HttpResponse.json({ error: 'not_found', message: 'nope', details: [] }, { status: 404 })
  }),
  http.get('/api/v1/projects/:projectId/routes', () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  http.get('/api/v1/projects', ({ request }) => {
    const cursor = new URL(request.url).searchParams.get('cursor')
    listCalls.push(cursor)
    const start = cursor ? Number(cursor) : 0
    const items = all.slice(start, start + 2)
    const next = start + 2 < all.length ? String(start + 2) : null
    return HttpResponse.json({ items, nextCursor: next })
  }),
  http.post('/api/v1/projects', async ({ request }) => {
    const body = (await request.json()) as { slug: string; name: string }
    created.push(body)
    if (createStatus === 'taken') {
      return HttpResponse.json(
        { error: 'slug_taken', message: 'taken', details: [] },
        { status: 409 },
      )
    }
    return HttpResponse.json({ ...exampleProject, ...body }, { status: 201 })
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
  all = []
  created = []
  createStatus = 'ok'
  existing = new Set()
  listCalls.length = 0
})

function mount(path = `/w/${WS.slug}`) {
  const queryClient = createQueryClient()
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<App queryClient={queryClient} router={router} />)
  return router
}

describe('project list', () => {
  it('shows base URL from window.location, counts, LIVE pill, and a dash for unpublished', async () => {
    all = [
      project(1, {
        routeCount: 4,
        caseCount: 9,
        activeVersion: { ...exampleProject.activeVersion!, label: 'v3' },
      }),
      project(2, { activeVersion: null }),
    ]
    mount()
    const row1 = (await screen.findByRole('link', { name: 'Project 1' })).closest('tr')!
    expect(within(row1).getByText(getMockBaseUrl('project-1'))).toBeInTheDocument()
    expect(getMockBaseUrl('project-1').startsWith(window.location.origin)).toBe(true)
    expect(within(row1).getByText('v3')).toBeInTheDocument()
    expect(within(row1).getByText('4')).toBeInTheDocument()
    expect(within(row1).getByText('9')).toBeInTheDocument()
    const row2 = screen.getByRole('link', { name: 'Project 2' }).closest('tr')!
    expect(within(row2).getByText('—')).toBeInTheDocument()
  })

  it('pages with Load more while nextCursor is set', async () => {
    all = [project(1), project(2), project(3)]
    mount()
    await screen.findByRole('link', { name: 'Project 1' })
    expect(screen.queryByRole('link', { name: 'Project 3' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByRole('link', { name: 'Project 3' })
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    expect(listCalls).toEqual([null, '2'])
  })

  it('empty workspace: empty state with New project for editors, none for viewers', async () => {
    mount()
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument()
  })

  it('viewers do not see New project', async () => {
    role = 'viewer'
    mount()
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new project/i })).toBeNull()
  })
})

describe('new project dialog', () => {
  async function openDialog() {
    const router = mount()
    await userEvent.click(await screen.findByRole('button', { name: 'New project' }))
    const dialog = await screen.findByRole('dialog')
    return { router, dialog }
  }

  it('derives the slug from the name, states the rule and shows the live URL', async () => {
    const { dialog } = await openDialog()
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Billing API')
    expect(within(dialog).getByLabelText('Slug')).toHaveValue('billing-api')
    expect(within(dialog).getByText(getMockBaseUrl('billing-api'))).toBeInTheDocument()
    expect(
      within(dialog).getByText('The slug is the URL prefix and cannot be changed later.'),
    ).toBeInTheDocument()
  })

  it('flags reserved and badly formatted slugs and disables submit', async () => {
    const { dialog } = await openDialog()
    const create = within(dialog).getByRole('button', { name: 'Create project' })
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Thing')
    expect(create).toBeEnabled()
    const slug = within(dialog).getByLabelText('Slug')
    await userEvent.clear(slug)
    await userEvent.type(slug, 'api')
    expect(within(dialog).getByText('api is reserved')).toBeInTheDocument()
    expect(create).toBeDisabled()
    await userEvent.clear(slug)
    await userEvent.type(slug, 'Billing')
    expect(within(dialog).getByText(SLUG_FORMAT_RULE)).toBeInTheDocument()
    expect(create).toBeDisabled()
  })

  it('checks availability on blur', async () => {
    existing = new Set(['in-use'])
    const { dialog } = await openDialog()
    await userEvent.type(within(dialog).getByLabelText('Name'), 'In use')
    await userEvent.tab()
    await userEvent.tab()
    expect(await within(dialog).findByText(SLUG_TAKEN_MESSAGE)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled()
  })

  it('keeps the dialog and values on 409 slug_taken', async () => {
    createStatus = 'taken'
    const { dialog } = await openDialog()
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Billing API')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(await within(dialog).findByText(SLUG_TAKEN_MESSAGE)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Billing API')
    expect(within(dialog).getByLabelText('Slug')).toHaveValue('billing-api')
  })

  it('creates the project and navigates to /p/<slug>', async () => {
    const { router, dialog } = await openDialog()
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Billing API')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/p/billing-api'))
    expect(created).toEqual([{ workspaceId: WS.id, name: 'Billing API', slug: 'billing-api' }])
  })
})

describe('project switcher', () => {
  it('lists projects with a tick on the current one and navigates on select', async () => {
    all = [project(1), project(2)]
    const router = mount('/p/project-1')
    const trigger = await screen.findByRole('button', { name: /project-1/ })
    await waitFor(() => expect(trigger).toBeEnabled())
    await userEvent.click(trigger)
    const current = await screen.findByRole('menuitem', { name: /Project 1/ })
    expect(within(current).getByLabelText('Selected')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'All projects' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '+ New project' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: /Project 2/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/p/project-2'))
    expect(await screen.findByRole('button', { name: /project-2/ })).toBeInTheDocument()
  })

  it('hides + New project from viewers', async () => {
    role = 'viewer'
    all = [project(1)]
    mount('/p/project-1')
    const trigger = await screen.findByRole('button', { name: /project-1/ })
    await waitFor(() => expect(trigger).toBeEnabled())
    await userEvent.click(trigger)
    await screen.findByRole('menuitem', { name: /Project 1/ })
    expect(screen.queryByRole('menuitem', { name: '+ New project' })).toBeNull()
  })
})
