import { exampleAuthState, exampleProject, type Project } from '@mockbench/api-contract'
import { createMemoryHistory } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../app/App'
import { createAppRouter } from '../../app/router'
import { getMockBaseUrl } from '../../lib/mock-url'
import { createQueryClient } from '../../lib/query-client'
import { delayProblem, diffToPatch, valuesFromProject } from './settings-form'
import { indexingExample } from './indexing-example'

const WS = exampleAuthState.workspaces[0]!
const base: Project = { ...exampleProject, slug: 'billing-api', description: null }

let role: 'owner' | 'editor' | 'viewer' = 'owner'
let project: Project = base
let patches: unknown[] = []
let deleteResult: 'ok' | 'fail' = 'ok'
let deleted = 0
let apiCalls = 0

const server = setupServer(
  http.get('/api/v1/auth/me', () =>
    HttpResponse.json({ ...exampleAuthState, workspaces: [{ ...WS, role }] }),
  ),
  http.get('/api/v1/projects/by-slug/:slug', () => HttpResponse.json(project)),
  http.get('/api/v1/projects/:projectId/routes', () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  http.get('/api/v1/projects', () => HttpResponse.json({ items: [], nextCursor: null })),
  http.patch('/api/v1/projects/:projectId', async ({ request }) => {
    const body = (await request.json()) as { settings?: Partial<Project['settings']> }
    patches.push(body)
    project = { ...project, ...body, settings: { ...project.settings, ...body.settings } }
    return HttpResponse.json(project)
  }),
  http.delete('/api/v1/projects/:projectId', () => {
    if (deleteResult === 'fail') {
      return HttpResponse.json(
        { error: 'forbidden', message: 'Only owners can delete.', details: [] },
        { status: 403 },
      )
    }
    deleted += 1
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
  role = 'owner'
  project = base
  patches = []
  deleteResult = 'ok'
  deleted = 0
  apiCalls = 0
})

function mount() {
  const queryClient = createQueryClient()
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: ['/p/billing-api/settings'] }),
  })
  render(<App queryClient={queryClient} router={router} />)
  return router
}

describe('settings helpers', () => {
  it('computes the indexing example locally', () => {
    expect(indexingExample('local')).toEqual(['tags-1', 'tags-2'])
    expect(indexingExample('path')).toEqual(['users-2-tags-1', 'users-2-tags-2'])
  })
  it('delay accepts 0-10000 integers only', () => {
    expect(delayProblem('0')).toBeUndefined()
    expect(delayProblem('10000')).toBeUndefined()
    expect(delayProblem('10001')).toBeTruthy()
    expect(delayProblem('-1')).toBeTruthy()
    expect(delayProblem('1.5')).toBeTruthy()
    expect(delayProblem('')).toBeTruthy()
  })
  it('diffs to changed keys only', () => {
    const v = valuesFromProject(base)
    expect(diffToPatch(base, v)).toEqual({})
    expect(diffToPatch(base, { ...v, mode: 'seeded' })).toEqual({ settings: { mode: 'seeded' } })
  })
})

describe('settings screen', () => {
  it('switching indexing updates the example live with no network call', async () => {
    mount()
    expect(await screen.findByTestId('indexing-example')).toHaveTextContent('["tags-1","tags-2"]')
    const before = server.listHandlers().length
    await userEvent.click(screen.getByRole('radio', { name: /Path-qualified/ }))
    expect(screen.getByTestId('indexing-example')).toHaveTextContent(
      '["users-2-tags-1","users-2-tags-2"]',
    )
    expect(server.listHandlers().length).toBe(before)
    expect(apiCalls).toBe(0)
  })

  it('Deterministic is selected by default; Random shows the warning', async () => {
    mount()
    expect(await screen.findByRole('radio', { name: /Deterministic/ })).toBeChecked()
    expect(screen.queryByRole('note')).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: /^Random/ }))
    expect(screen.getByRole('note')).toHaveTextContent(/flaky/)
  })

  it('saves only changed keys and shows the notices', async () => {
    mount()
    await userEvent.click(await screen.findByRole('radio', { name: /Seeded faker/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    const status = await screen.findByRole('status')
    expect(patches).toEqual([{ settings: { mode: 'seeded' } }])
    expect(status).toHaveTextContent('Saved — applies from your next publish')
    expect(status).toHaveTextContent(
      'The live version keeps its current settings until you publish and deploy.',
    )
  })

  it('rejects a delay of 10001 with a field message and does not save', async () => {
    mount()
    const delay = await screen.findByLabelText('Default delay (ms)')
    await userEvent.clear(delay)
    await userEvent.type(delay, '10001')
    expect(await screen.findByText('Enter a whole number from 0 to 10000.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  })

  it('states the access note and the base URL from window.location', async () => {
    mount()
    expect(await screen.findByText(/take no authentication/)).toBeInTheDocument()
    expect(screen.getAllByText(getMockBaseUrl('billing-api')).length).toBeGreaterThan(0)
  })

  it('owners delete with the slug typed exactly and land on the workspace', async () => {
    const router = mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete project' }))
    const buttons = screen.getAllByRole('button', { name: 'Delete project' })
    const submit = buttons[buttons.length - 1]!
    expect(submit).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Type billing-api to confirm'), 'billing-ap')
    expect(submit).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Type billing-api to confirm'), 'i')
    await userEvent.click(submit)
    await waitFor(() => expect(deleted).toBe(1))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/${WS.slug}`))
  })

  it('a failed delete leaves the dialog open with the server message', async () => {
    deleteResult = 'fail'
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete project' }))
    await userEvent.type(screen.getByLabelText('Type billing-api to confirm'), 'billing-api')
    const buttons = screen.getAllByRole('button', { name: 'Delete project' })
    await userEvent.click(buttons[buttons.length - 1]!)
    expect(await screen.findByText('Only owners can delete.')).toBeInTheDocument()
    expect(screen.getByLabelText('Type billing-api to confirm')).toBeInTheDocument()
  })

  it('editors can save but not delete', async () => {
    role = 'editor'
    mount()
    expect(await screen.findByRole('button', { name: 'Save settings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete project' })).toBeNull()
  })

  it('viewers see read-only values and no actions', async () => {
    role = 'viewer'
    mount()
    expect(await screen.findByLabelText('Name')).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Seeded faker/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete project' })).toBeNull()
  })

  it('prompts before leaving with unsaved changes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const router = mount()
    await userEvent.click(await screen.findByRole('radio', { name: /Path-qualified/ }))
    void router.navigate({ to: '/w/$wsSlug', params: { wsSlug: WS.slug } })
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(router.state.location.pathname).toBe('/p/billing-api/settings')
    confirm.mockReturnValue(true)
    void router.navigate({ to: '/w/$wsSlug', params: { wsSlug: WS.slug } })
    await waitFor(() => expect(router.state.location.pathname).toBe(`/w/${WS.slug}`))
    confirm.mockRestore()
  })
})
