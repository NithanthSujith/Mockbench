import {
  exampleAuthState,
  exampleMember,
  type Member,
  type Workspace,
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

const WS_ID = '00000000-0000-7000-8000-000000000a01'
const OTHER_ID = '00000000-0000-7000-8000-000000000a02'
const uid = (n: number) => `00000000-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`
const mid = (n: number) => `00000000-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`

const person = (n: number, role: Member['role'], name: string): Member => ({
  ...exampleMember,
  id: mid(n),
  userId: uid(n),
  name,
  email: `${name.toLowerCase()}@example.test`,
  role,
})

let myRole: Member['role'] = 'owner'
let workspaces: Workspace[] = []
let members: Member[] = []
let nextError: { status: number; code: string } | null = null
let calls: string[] = []

const base = exampleAuthState.workspaces[0]!
const mkWs = (id: string, slug: string, role: Member['role']): Workspace => ({
  ...base,
  id,
  slug,
  name: slug,
  role,
})

const server = setupServer(
  http.get('/api/v1/auth/me', () =>
    HttpResponse.json({
      user: { ...exampleAuthState.user, id: uid(1) },
      workspaces,
    }),
  ),
  http.get(`/api/v1/workspaces/${WS_ID}/members`, () =>
    HttpResponse.json({ items: members, nextCursor: null }),
  ),
  http.post(`/api/v1/workspaces/${WS_ID}/members`, async ({ request }) => {
    const body = (await request.json()) as { email: string; role: Member['role'] }
    calls.push(`add ${body.email}`)
    if (nextError)
      return HttpResponse.json(
        { error: nextError.code, message: 'x', details: [] },
        { status: nextError.status },
      )
    const created = { ...person(9, body.role, 'Newbie'), email: body.email }
    members = [...members, created]
    return HttpResponse.json(created, { status: 201 })
  }),
  http.patch(`/api/v1/workspaces/${WS_ID}/members/:id`, async ({ request, params }) => {
    const body = (await request.json()) as { role: Member['role'] }
    calls.push(`patch ${String(params.id)} ${body.role}`)
    if (nextError)
      return HttpResponse.json(
        { error: nextError.code, message: 'x', details: [] },
        { status: nextError.status },
      )
    members = members.map((m) => (m.id === params.id ? { ...m, role: body.role } : m))
    return HttpResponse.json(members.find((m) => m.id === params.id))
  }),
  http.delete(`/api/v1/workspaces/${WS_ID}/members/:id`, ({ params }) => {
    calls.push(`delete ${String(params.id)}`)
    if (nextError)
      return HttpResponse.json(
        { error: nextError.code, message: 'x', details: [] },
        { status: nextError.status },
      )
    members = members.filter((m) => m.id !== params.id)
    workspaces = workspaces.filter((w) => !(w.id === WS_ID && m_is_me(params.id)))
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('/api/v1/projects', () => HttpResponse.json({ items: [], nextCursor: null })),
)
const m_is_me = (id: unknown) => id === mid(1)

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
  myRole = 'owner'
  nextError = null
  calls = []
  workspaces = [mkWs(WS_ID, 'alps', myRole)]
  members = [person(1, 'owner', 'Ann'), person(2, 'editor', 'Bob')]
})

function setRole(role: Member['role']) {
  myRole = role
  workspaces = workspaces.map((w) => (w.id === WS_ID ? { ...w, role } : w))
  members = members.map((m) => (m.userId === uid(1) ? { ...m, role } : m))
}

function mount() {
  const queryClient = createQueryClient()
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: ['/w/alps/members'] }),
  })
  render(<App queryClient={queryClient} router={router} />)
  return router
}

const table = () => screen.findByRole('table', { name: 'Members' })

describe('MembersScreen permissions', () => {
  it('owner sees role selects, remove buttons and the add form', async () => {
    mount()
    const t = await table()
    expect(within(t).getAllByRole('combobox')).toHaveLength(2)
    expect(within(t).getAllByRole('button', { name: /^Remove/ })).toHaveLength(2)
    expect(screen.getByRole('form', { name: 'Add member' })).toBeInTheDocument()
    expect(within(t).getByText('bob@example.test')).toHaveClass('mono')
  })

  it.each(['editor', 'viewer'] as const)(
    '%s sees a read-only table and Leave only',
    async (role) => {
      setRole(role)
      mount()
      const t = await table()
      expect(within(t).queryAllByRole('combobox')).toHaveLength(0)
      expect(within(t).queryAllByRole('button')).toHaveLength(0)
      expect(screen.queryByRole('form', { name: 'Add member' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Leave workspace' })).toBeInTheDocument()
      expect(within(t).getByText('Bob')).toBeInTheDocument()
    },
  )
})

describe('MembersScreen add', () => {
  it('maps user_not_found, already_member, then appends on success', async () => {
    mount()
    const user = userEvent.setup()
    await table()
    const form = screen.getByRole('form', { name: 'Add member' })
    await user.type(within(form).getByLabelText('Email'), 'ghost@example.test')
    nextError = { status: 404, code: 'user_not_found' }
    await user.click(within(form).getByRole('button', { name: 'Add member' }))
    expect(
      await within(form).findByText('No account with that email — they need to register first'),
    ).toBeInTheDocument()
    nextError = { status: 409, code: 'already_member' }
    await user.click(within(form).getByRole('button', { name: 'Add member' }))
    expect(await within(form).findByText('Already a member')).toBeInTheDocument()
    nextError = null
    await user.click(within(form).getByRole('button', { name: 'Add member' }))
    expect(await screen.findByText('ghost@example.test')).toBeInTheDocument()
  })
})

describe('MembersScreen role change', () => {
  it('last_owner shows the message and reverts the select', async () => {
    mount()
    const user = userEvent.setup()
    const t = await table()
    const select = within(t).getByRole('combobox', { name: 'Role for Ann' })
    expect(select).toHaveTextContent('owner')
    nextError = { status: 409, code: 'last_owner' }
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: 'editor' }))
    expect(await screen.findByText('A workspace needs at least one owner')).toBeInTheDocument()
    await waitFor(() =>
      expect(within(t).getByRole('combobox', { name: 'Role for Ann' })).toHaveTextContent('owner'),
    )
  })

  it('applies a successful change', async () => {
    mount()
    const user = userEvent.setup()
    const t = await table()
    await user.click(within(t).getByRole('combobox', { name: 'Role for Bob' }))
    await user.click(await screen.findByRole('option', { name: 'viewer' }))
    await waitFor(() => expect(calls).toContain(`patch ${mid(2)} viewer`))
    await waitFor(() =>
      expect(within(t).getByRole('combobox', { name: 'Role for Bob' })).toHaveTextContent('viewer'),
    )
  })
})

describe('MembersScreen remove', () => {
  it('confirms by name and removes the row on 204', async () => {
    mount()
    const user = userEvent.setup()
    const t = await table()
    await user.click(within(t).getByRole('button', { name: 'Remove Bob' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Remove Bob \(bob@example.test\)/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(within(t).queryByText('Bob')).toBeNull())
    expect(calls).toContain(`delete ${mid(2)}`)
  })

  it('rolls the row back when removal fails', async () => {
    mount()
    const user = userEvent.setup()
    const t = await table()
    nextError = { status: 500, code: 'internal' }
    await user.click(within(t).getByRole('button', { name: 'Remove Bob' }))
    await user.click(
      await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Remove' }),
    )
    await waitFor(() => expect(calls).toContain(`delete ${mid(2)}`))
    expect(await within(t).findByText('Bob')).toBeInTheDocument()
  })

  it('leaving the only workspace returns to the empty state', async () => {
    setRole('viewer')
    const router = mount()
    const user = userEvent.setup()
    await table()
    await user.click(screen.getByRole('button', { name: 'Leave workspace' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'))
  })

  it('leaving moves to another workspace when there is one', async () => {
    setRole('editor')
    workspaces = [...workspaces, mkWs(OTHER_ID, 'beta', 'owner')]
    const router = mount()
    const user = userEvent.setup()
    await table()
    await user.click(screen.getByRole('button', { name: 'Leave workspace' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave' }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/beta'))
  })
})
