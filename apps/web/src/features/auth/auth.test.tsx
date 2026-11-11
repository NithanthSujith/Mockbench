import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryHistory } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../app/App'
import { createAppRouter } from '../../app/router'
import { setUnauthenticatedHandler } from '../../lib/api/unauthenticated'
import { createQueryClient } from '../../lib/query-client'
import { qk } from '../../lib/query-keys'
import { getLandingPath } from './session'
import { NoWorkspaceState } from './NoWorkspaceState'

// The real router, guard, session probe and screens. Only `fetch` is faked (a tiny in-memory server).
const USER = {
  id: 'u1',
  email: 'dana@example.test',
  name: 'Dana',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const WS = { id: 'w1', name: 'Alps', slug: 'alps', role: 'owner', createdAt: USER.createdAt }
const STATE = { user: USER, workspaces: [WS] }

interface Server {
  signedIn: boolean
  instance: { name: string; version: string; allowSignup: boolean; setupRequired: boolean }
  loginStatus: number
  registerError?: { status: number; error: string; message: string }
  state: typeof STATE
  calls: string[]
}
let server: Server

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  window.scrollTo = vi.fn()
  server = {
    signedIn: false,
    instance: { name: 'Mockbench', version: '0', allowSignup: false, setupRequired: false },
    loginStatus: 200,
    state: STATE,
    calls: [],
  }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const key = `${init?.method ?? 'GET'} ${url}`
    server.calls.push(key)
    if (key === 'GET /api/v1/instance') return json(200, server.instance)
    if (key === 'GET /api/v1/auth/me') {
      return server.signedIn
        ? json(200, server.state)
        : json(401, { error: 'unauthenticated', message: 'Sign in', details: [] })
    }
    if (key === 'POST /api/v1/auth/login') {
      if (server.loginStatus !== 200) {
        return json(401, {
          error: 'invalid_credentials',
          message: 'Email or password is incorrect.',
          details: [],
        })
      }
      server.signedIn = true
      return json(200, server.state)
    }
    if (key === 'POST /api/v1/auth/register') {
      if (server.registerError) {
        const { status, error, message } = server.registerError
        return json(status, { error, message, details: [] })
      }
      server.signedIn = true
      return json(201, server.state)
    }
    if (key === 'POST /api/v1/auth/logout') {
      server.signedIn = false
      return json(204)
    }
    if (url.startsWith('/api/v1/')) return json(200, { items: [], nextCursor: null })
    return json(404, { error: 'not_found', message: 'nope', details: [] })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthenticatedHandler(undefined)
})

function mount(path: string) {
  const queryClient = createQueryClient()
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<App queryClient={queryClient} router={router} />)
  return { router, queryClient }
}

async function signIn(email = 'dana@example.test', password = 'correct horse') {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.keyboard('{Enter}')
  return user
}

describe('route guard', () => {
  it('redirects a signed-out visit to /login?redirect= and never puts the shell in the DOM', async () => {
    let shellSeen = false
    const observer = new MutationObserver(() => {
      if (document.querySelector('header, [data-slot="account-menu"]')) shellSeen = true
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const { router } = mount('/p/anything/routes/x')
    await screen.findByLabelText('Email')
    observer.disconnect()
    expect(shellSeen).toBe(false)
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.href).toBe('/login?redirect=%2Fp%2Fanything%2Froutes%2Fx')
  })
})

describe('sign in', () => {
  it('lands on the redirect path after a successful sign-in', async () => {
    const { router } = mount('/login?redirect=%2Fp%2Fanything%2Froutes%2Fx')
    await signIn()
    await waitFor(() => expect(router.state.location.pathname).toBe('/p/anything/routes/x'))
  })

  it('lands on the first workspace when there is no redirect', async () => {
    const { router } = mount('/login')
    await signIn()
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/alps'))
  })

  it.each(['//evil.test', 'https://evil.test'])(
    'ignores the off-origin redirect %s',
    async (bad) => {
      const { router } = mount(`/login?redirect=${encodeURIComponent(bad)}`)
      await signIn()
      await waitFor(() => expect(router.state.location.pathname).toBe('/w/alps'))
    },
  )

  it('shows wrong credentials inline, keeps the email and clears the password', async () => {
    server.loginStatus = 401
    mount('/login')
    await signIn('dana@example.test', 'wrong password')
    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('dana@example.test')
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('uses the right autocomplete attributes', async () => {
    mount('/login')
    expect(await screen.findByLabelText('Email')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
  })

  it('says "Your session ended" for reason=expired', async () => {
    mount('/login?reason=expired')
    expect(await screen.findByText('Your session ended')).toBeInTheDocument()
  })
})

describe('instance-driven copy', () => {
  it('first run: offers to create the first account', async () => {
    server.instance.setupRequired = true
    mount('/login')
    const link = await screen.findByRole('link', { name: 'Create the first account' })
    expect(link).toHaveAttribute('href', expect.stringContaining('/register'))
  })

  it('signup closed: no register link on /login, and /register says it is closed', async () => {
    mount('/login')
    await screen.findByLabelText('Email')
    expect(screen.queryByRole('link', { name: /register|create the first/i })).toBeNull()
    expect(screen.queryByText(/ALLOW_SIGNUP/)).toBeNull()
  })

  it('signup closed: /register shows the closed message with a link back', async () => {
    mount('/register')
    expect(await screen.findByText('Registration is closed on this server')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument()
  })

  it('signup open: shows the ALLOW_SIGNUP hint and a register link', async () => {
    server.instance.allowSignup = true
    mount('/login')
    expect(await screen.findByText(/ALLOW_SIGNUP=false/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Register' })).toBeInTheDocument()
  })
})

describe('register', () => {
  async function fillAndSubmit() {
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Name'), 'Dana')
    await user.type(screen.getByLabelText('Email'), 'dana@example.test')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.keyboard('{Enter}')
  }

  it('registers and lands on the first workspace', async () => {
    server.instance.allowSignup = true
    const { router } = mount('/register')
    await fillAndSubmit()
    await waitFor(() => expect(router.state.location.pathname).toBe('/w/alps'))
  })

  it('maps 409 email_taken to the email field', async () => {
    server.instance.allowSignup = true
    server.registerError = { status: 409, error: 'email_taken', message: 'taken' }
    mount('/register')
    await fillAndSubmit()
    expect(
      await screen.findByText('An account with this email already exists.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(/already exists/)
  })

  it('maps 403 signup_disabled to a form message', async () => {
    server.instance.allowSignup = true
    server.registerError = { status: 403, error: 'signup_disabled', message: 'closed' }
    mount('/register')
    await fillAndSubmit()
    expect(await screen.findByText('Registration is closed on this server.')).toBeInTheDocument()
  })

  it('uses new-password and rejects short passwords before calling the server', async () => {
    server.instance.allowSignup = true
    mount('/register')
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Use 8 to 128 characters.')).toBeInTheDocument()
    expect(server.calls).not.toContain('POST /api/v1/auth/register')
  })
})

describe('signed-in behaviour', () => {
  it('sign out calls logout, clears the cache and lands on /login', async () => {
    server.signedIn = true
    const { router, queryClient } = mount('/w/alps')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Account' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(server.calls).toContain('POST /api/v1/auth/logout')
    expect(queryClient.getQueryData(qk.session())).toBeUndefined()
  })

  it('a mid-session 401 redirects to /login with "Your session ended" and clears the cache', async () => {
    server.signedIn = true
    const { router, queryClient } = mount('/w/alps')
    await screen.findByRole('button', { name: 'Account' })
    // The session ends; the next API call anywhere answers 401.
    server.signedIn = false
    const { api } = await import('../../lib/api/client')
    await api.workspaces.list().catch(() => undefined)
    await api.auth.me().catch(() => undefined)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toMatchObject({ reason: 'expired' })
    expect(await screen.findByText('Your session ended')).toBeInTheDocument()
    expect(queryClient.getQueryData(qk.session())).toBeUndefined()
  })
})

describe('landing path and empty state', () => {
  it('lands on the first workspace slug', () => {
    expect(getLandingPath(STATE as never)).toBe('/w/alps')
  })

  it('shows the no-workspace copy and a Create workspace action', async () => {
    const onCreate = vi.fn()
    render(<NoWorkspaceState onCreate={onCreate} />)
    expect(screen.getByText("You aren't in any workspace yet")).toBeInTheDocument()
    expect(screen.getByText('or ask an owner to add your email')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
    expect(onCreate).toHaveBeenCalled()
  })
})
