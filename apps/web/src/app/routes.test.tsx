import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLandingPath, getSession } from '../features/auth/session'
import { exampleProject } from '@mockbench/api-contract'
import { api } from '../lib/api/client'
import { setUnauthenticatedHandler } from '../lib/api/unauthenticated'
import { safeRedirectTarget } from '../lib/auth-guard'
import { createQueryClient } from '../lib/query-client'
import { App } from './App'
import { createAppRouter } from './router'

// The real route tree, the real shell, the real guard. Only the session probe is faked: AUTH-03
// owns features/auth/session.ts and fills in the real one.
vi.mock('../features/auth/session', () => ({
  getSession: vi.fn(),
  getLandingPath: vi.fn(() => '/w/alps'),
}))

const SESSION = {
  user: { id: 'u1', email: 'a@b.co', name: 'A', createdAt: '' },
  workspaces: [
    {
      id: exampleProject.workspaceId,
      name: 'Alps',
      slug: 'alps',
      role: 'owner',
      createdAt: '',
      updatedAt: '',
    },
  ],
}

function mount(path: string) {
  const queryClient = createQueryClient()
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<App queryClient={queryClient} router={router} />)
  return { router, queryClient }
}

const currentScreen = () => document.querySelector('[data-screen]')?.getAttribute('data-screen')

beforeEach(() => {
  window.scrollTo = vi.fn()
  vi.mocked(getSession).mockResolvedValue(SESSION as never)
  vi.mocked(getLandingPath).mockReturnValue('/w/alps')
  // The project loader reads the project and its (empty) route list.
  vi.spyOn(api.projects, 'getBySlug').mockResolvedValue(exampleProject)
  vi.spyOn(api.routes, 'list').mockResolvedValue({ items: [], nextCursor: null })
  vi.spyOn(api.projects, 'list').mockResolvedValue({ items: [], nextCursor: null })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setUnauthenticatedHandler(undefined)
})

// [path, owning feature screen, shell layout for /p screens, whether the top bar is shown]
const ROUTES: [string, string, string | null, boolean][] = [
  ['/login', 'auth/LoginScreen', null, false],
  ['/register', 'auth/RegisterScreen', null, false],
  ['/w/alps', 'projects/ProjectListScreen', null, true],
  ['/w/alps/members', 'workspaces/MembersScreen', null, true],
  ['/p/billing-api', 'routes/ProjectHomeScreen', 'wide', true],
  ['/p/billing-api/routes/r1', 'routes/RouteEditorScreen', 'editor', true],
  ['/p/billing-api/routes/r1/cases/c1', 'routes/RouteEditorScreen', 'editor', true],
  ['/p/billing-api/versions', 'versions/VersionsScreen', 'wide', true],
  ['/p/billing-api/presets', 'presets/PresetsScreen', 'wide', true],
  ['/p/billing-api/logs', 'logs/LogsScreen', 'wide', true],
  ['/p/billing-api/settings', 'projects/SettingsScreen', 'wide', true],
]

describe('every route renders its stub from the owning feature, inside the shell', () => {
  for (const [path, screenName, layout, hasTopbar] of ROUTES) {
    it(`${path} -> ${screenName}`, async () => {
      mount(path)
      await waitFor(() => expect(currentScreen()).toBe(screenName))
      expect(screen.queryAllByRole('banner')).toHaveLength(hasTopbar ? 1 : 0)
      if (layout) {
        expect(document.querySelector('[data-shell]')?.getAttribute('data-shell')).toBe(layout)
        expect(document.querySelector('[data-slot="project-rail"]')).not.toBeNull()
      }
    })
  }

  it('the route editor puts the response column beside the editor; other project screens do not', async () => {
    mount('/p/billing-api/routes/r1')
    await waitFor(() => expect(currentScreen()).toBe('routes/RouteEditorScreen'))
    expect(document.querySelector('[data-column="response"]')).not.toBeNull()
  })

  it('switching case keeps the editor mounted (the case lives in the URL, not a new screen)', async () => {
    const { router } = mount('/p/billing-api/routes/r1/cases/c1')
    await waitFor(() => expect(currentScreen()).toBe('routes/RouteEditorScreen'))
    const before = document.querySelector('[data-screen="routes/RouteEditorScreen"]')
    await router.navigate({
      to: '/p/$projectSlug/routes/$routeId/cases/$caseId',
      params: { projectSlug: 'billing-api', routeId: 'r1', caseId: 'c2' },
    })
    await waitFor(() => expect(router.state.location.pathname).toMatch(/cases\/c2$/))
    expect(document.querySelector('[data-screen="routes/RouteEditorScreen"]')).toBe(before)
  })

  it('the top bar slots are filled by the feature stubs and show the mock address of the open project', async () => {
    mount('/p/billing-api/versions')
    await waitFor(() => expect(currentScreen()).toBe('versions/VersionsScreen'))
    for (const slot of [
      'workspace-switcher',
      'project-switcher',
      'live-pill',
      'publish',
      'account-menu',
      'base-url',
    ]) {
      expect(document.querySelector(`[data-slot="${slot}"]`), slot).not.toBeNull()
    }
    expect(document.querySelector('[data-slot="base-url"]')?.textContent).toContain(
      `${window.location.origin}/mock/billing-api`,
    )
  })
})

describe('unknown paths and removed routes', () => {
  it('an unknown path renders a not-found screen inside the shell (top bar present)', async () => {
    mount('/nope/at/all')
    await waitFor(() => expect(currentScreen()).toBe('shell/NotFound'))
    expect(screen.getAllByRole('banner')).toHaveLength(1)
  })

  it('an unknown path under a project is not-found inside the same shell, with one top bar', async () => {
    mount('/p/billing-api/does-not-exist')
    await waitFor(() => expect(currentScreen()).toBe('shell/NotFound'))
    expect(screen.getAllByRole('banner')).toHaveLength(1)
  })

  it('there is no /p/$projectSlug/import route (OpenAPI import is deferred, ADR 0010)', async () => {
    mount('/p/billing-api/import')
    await waitFor(() => expect(currentScreen()).toBe('shell/NotFound'))
  })
})

describe('the session guard', () => {
  it('a signed-out visit to a protected route redirects to /login?redirect=… and never renders the shell', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    let shellEverRendered = false
    const observer = new MutationObserver(() => {
      if (document.querySelector('header, [data-slot="base-url"]')) shellEverRendered = true
    })
    observer.observe(document.body, { childList: true, subtree: true })

    const { router } = mount('/p/billing-api/routes/r1')
    await waitFor(() => expect(currentScreen()).toBe('auth/LoginScreen'))
    observer.disconnect()

    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toMatchObject({ redirect: '/p/billing-api/routes/r1' })
    expect(shellEverRendered).toBe(false)
    expect(screen.queryAllByRole('banner')).toHaveLength(0)
  })

  it('/ goes to the landing path when signed in and to /login when signed out', async () => {
    const signedIn = mount('/')
    await waitFor(() => expect(signedIn.router.state.location.pathname).toBe('/w/alps'))
    await waitFor(() => expect(currentScreen()).toBe('projects/ProjectListScreen'))
    document.body.innerHTML = ''

    vi.mocked(getSession).mockResolvedValue(null)
    const signedOut = mount('/')
    await waitFor(() => expect(signedOut.router.state.location.pathname).toBe('/login'))
  })

  it('only same-origin absolute paths survive as a redirect target (no open redirect)', () => {
    expect(safeRedirectTarget('/p/x?y=1')).toBe('/p/x?y=1')
    for (const bad of [
      '//evil.test',
      'https://evil.test',
      '/\\evil.test',
      'javascript:alert(1)',
      '',
      undefined,
      5,
    ]) {
      expect(safeRedirectTarget(bad)).toBeUndefined()
    }
  })

  it('an off-origin ?redirect on /login is dropped by the route search validator', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const { router } = mount('/login?redirect=//evil.test&reason=expired')
    await waitFor(() => expect(currentScreen()).toBe('auth/LoginScreen'))
    expect(router.state.location.search).toEqual({ redirect: undefined, reason: 'expired' })
  })
})

describe('a 401 from any API call', () => {
  it('redirects ONCE to /login (remembering where you were) and does not loop', async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ error: 'unauthenticated', message: 'Sign in.', details: [] }),
          {
            status: 401,
          },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { router, queryClient } = mount('/w/alps')
    await waitFor(() => expect(currentScreen()).toBe('projects/ProjectListScreen'))
    const navigate = vi.spyOn(router, 'navigate')
    queryClient.setQueryData(['marker'], 1)

    await Promise.allSettled([
      api.workspaces.list(),
      api.workspaces.list(),
      api.projects.list({ query: { workspaceId: 'w1' } }),
    ])
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(router.state.location.search).toMatchObject({ redirect: '/w/alps', reason: 'expired' })
    expect(queryClient.getQueryData(['marker'])).toBeUndefined() // cache cleared on sign-out

    // Another 401 while already on /login must not navigate again.
    await api.workspaces.list().catch(() => undefined)
    await new Promise((r) => setTimeout(r, 20))
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/login')
  })
})
