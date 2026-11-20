import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { BrowserContext } from '../../apps/web/node_modules/@playwright/test/index.mjs'
import { expect } from '../fixtures'
import { OWNER } from './lan'

/**
 * Helpers shared by the specs that cover one screen against the real API (BLD-09 infer, RUN-08 log
 * polling, WS-04 members). The golden loop (first-release.spec.ts) deliberately drives everything
 * through the UI; these specs set their fixtures up over the API so each test exercises one screen.
 */
export const API_HEADERS = { 'X-Mockbench-Client': 'e2e' }

type Cookies = Awaited<ReturnType<BrowserContext['cookies']>>

/**
 * One OWNER session for the whole run. `auth.login` and `auth.register` allow only 10 a minute per IP
 * and the suite runs in about two minutes, so a sign-in per test would hit the limiter; the control
 * plane allows 600 requests a minute per session (ADR 0019), which is ample for these specs.
 *
 * The cookies are cached on disk, not only in this module: Playwright starts a fresh worker process
 * after a failing test, which would otherwise drop the in-memory cache and sign in again for every
 * later file — three extra sign-ins that pushed the run over the limiter and turned one real failure
 * into three. The file lives in `outputDir`, which Playwright clears at the start of each run, so the
 * seed stack never inherits the loop stack's session.
 */
let shared: Cookies | null = null
const CACHE = new URL('../test-results/.owner-session.json', import.meta.url)

function readCache(): Cookies | null {
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8')) as Cookies
  } catch {
    return null
  }
}

function writeCache(cookies: Cookies) {
  try {
    mkdirSync(new URL('.', CACHE), { recursive: true })
    writeFileSync(CACHE, JSON.stringify(cookies))
  } catch {
    // A cache miss only costs a sign-in; never fail a test over it.
  }
}

/**
 * Signs `context` in as OWNER, registering the account first if it does not exist yet. Registering
 * keeps these specs independent of file order: run on their own against a fresh stack, OWNER becomes
 * the first user and owns workspace `default`; run after the golden loop, the account is already there.
 */
export async function signInAsOwner(context: BrowserContext) {
  shared ??= readCache()
  if (shared) {
    await context.addCookies(shared)
    // The cached session can still have been invalidated (a sign-out in another spec); check once.
    if ((await context.request.get('/api/v1/auth/me')).status() === 200) return
    await context.clearCookies()
    shared = null
  }
  const login = await context.request.post('/api/v1/auth/login', {
    headers: API_HEADERS,
    data: { email: OWNER.email, password: OWNER.password },
  })
  if (login.status() === 401) {
    const registered = await context.request.post('/api/v1/auth/register', {
      headers: API_HEADERS,
      data: OWNER,
    })
    expect(registered.status()).toBe(201)
  } else {
    expect(
      login.status(),
      'OWNER sign-in (429 means the 10/minute per-IP limiter was already spent)',
    ).toBe(200)
  }
  shared = await context.cookies()
  writeCache(shared)
}

/** The signed-in user's first workspace. */
export async function firstWorkspace(context: BrowserContext) {
  const me = await (await context.request.get('/api/v1/auth/me')).json()
  const workspace = me.workspaces[0]
  expect(workspace, 'the signed-in user has a workspace').toBeTruthy()
  return workspace as { id: string; slug: string; role: string }
}

export interface Fixture {
  projectId: string
  slug: string
  routeId: string
  caseId: string
  /** The route editor URL of the first case, ready for `page.goto`. */
  caseUrl: string
}

/**
 * Creates a project with one route over the API and returns the ids plus the route editor URL. The
 * route's default case is left empty unless `schema` is given.
 */
export async function createProjectWithRoute(
  context: BrowserContext,
  options: { slug: string; method?: string; path: string; schema?: unknown },
): Promise<Fixture> {
  const api = context.request
  const workspace = await firstWorkspace(context)
  const created = await api.post('/api/v1/projects', {
    headers: API_HEADERS,
    data: { workspaceId: workspace.id, name: options.slug, slug: options.slug },
  })
  expect(created.status()).toBe(201)
  const project = await created.json()

  const routeRes = await api.post(`/api/v1/projects/${project.id}/routes`, {
    headers: API_HEADERS,
    data: { method: options.method ?? 'GET', path: options.path },
  })
  expect(routeRes.status()).toBe(201)
  const route = await routeRes.json()

  const cases = await (await api.get(`/api/v1/routes/${route.id}/cases`)).json()
  const caseId = cases.items[0].id as string
  if (options.schema !== undefined) {
    const patch = await api.patch(`/api/v1/cases/${caseId}`, {
      headers: API_HEADERS,
      data: { schema: options.schema },
    })
    expect(patch.status()).toBe(200)
  }

  return {
    projectId: project.id,
    slug: options.slug,
    routeId: route.id,
    caseId,
    caseUrl: `/p/${options.slug}/routes/${route.id}/cases/${caseId}`,
  }
}

/** Publishes the draft and deploys it, so the data plane answers. */
export async function publishAndDeploy(context: BrowserContext, projectId: string) {
  const api = context.request
  const versionRes = await api.post(`/api/v1/projects/${projectId}/versions`, {
    headers: API_HEADERS,
    data: {},
  })
  expect(versionRes.status()).toBe(201)
  const version = await versionRes.json()
  const deployed = await api.post(`/api/v1/projects/${projectId}/deploy`, {
    headers: API_HEADERS,
    data: { versionId: version.id },
  })
  expect(deployed.status()).toBe(200)
  return version as { id: string; label: string }
}
