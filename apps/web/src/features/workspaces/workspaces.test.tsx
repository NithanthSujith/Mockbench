import { exampleAuthState, exampleWorkspace, type Workspace } from '@mockbench/api-contract'
import { createMemoryHistory } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../app/App'
import { createAppRouter } from '../../app/router'
import { createQueryClient } from '../../lib/query-client'
import { deriveWorkspaceSlug } from './slug'

const ws = (n: number, extra: Partial<Workspace> = {}) =>
  ({
    ...exampleAuthState.workspaces[0]!,
    id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    name: `Team ${n}`,
    slug: `team-${n}`,
    ...extra,
  }) as Workspace

let mine: Workspace[] = []
let taken = false
let posted: unknown[] = []

const server = setupServer(
  http.get('/api/v1/auth/me', () => HttpResponse.json({ ...exampleAuthState, workspaces: mine })),
  http.get('/api/v1/projects', () => HttpResponse.json({ items: [], nextCursor: null })),
  http.post('/api/v1/workspaces', async ({ request }) => {
    const body = (await request.json()) as { name: string; slug: string }
    posted.push(body)
    if (taken)
      return HttpResponse.json(
        { error: 'slug_taken', message: 'taken', details: [] },
        { status: 409 },
      )
    const created = { ...exampleWorkspace, ...body, id: '00000000-0000-7000-8000-0000000000ff' }
    mine = [...mine, created as Workspace]
    return HttpResponse.json(created, { status: 201 })
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
  mine = []
  taken = false
  posted = []
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
const slot = () => document.querySelector('[data-slot="workspace-switcher"]') as HTMLElement

describe('slug derivation', () => {
  it('Alps Chemicals -> alps-chemicals', () => {
    expect(deriveWorkspaceSlug('Alps Chemicals')).toBe('alps-chemicals')
  })
})

describe('WorkspaceSwitcher', () => {
  it('one workspace: plain label, not a button', async () => {
    mine = [ws(1)]
    mount('/w/team-1')
    await waitFor(() => expect(slot()?.textContent).toBe('Team 1'))
    expect(slot().tagName).not.toBe('BUTTON')
    expect(screen.queryByText('+ New workspace')).toBeNull()
  })

  it('two workspaces: menu ticks current, navigates on choose', async () => {
    mine = [ws(1), ws(2)]
    const router = mount('/w/team-1')
    const user = userEvent.setup()
    await waitFor(() => expect(slot()?.tagName).toBe('BUTTON'))
    await user.click(slot())
    const menu = await screen.findByRole('menu')
    expect(
      within(within(menu).getByRole('menuitem', { name: /Team 1/ })).getByLabelText('Selected'),
    ).toBeInTheDocument()
    expect(
      within(within(menu).getByRole('menuitem', { name: /Team 2/ })).queryByLabelText('Selected'),
    ).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: '+ New workspace' })).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: /Team 2/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/team-2'))
  })

  it('zero workspaces: Create workspace button', async () => {
    mount('/welcome')
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Create workspace' }).length).toBe(2),
    )
  })

  it('dialog derives slug, shows 409 under slug, then creates and navigates', async () => {
    mine = [ws(1), ws(2)]
    taken = true
    const router = mount('/w/team-1')
    const user = userEvent.setup()
    await waitFor(() => expect(slot()?.tagName).toBe('BUTTON'))
    await user.click(slot())
    await user.click(await screen.findByRole('menuitem', { name: '+ New workspace' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Alps Chemicals')
    expect(within(dialog).getByLabelText('Slug')).toHaveValue('alps-chemicals')
    await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))
    expect(await within(dialog).findByText(/already used/)).toBeInTheDocument()
    taken = false
    await user.clear(within(dialog).getByLabelText('Slug'))
    await user.type(within(dialog).getByLabelText('Slug'), 'alps')
    await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/alps'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posted).toHaveLength(2)
  })
})
