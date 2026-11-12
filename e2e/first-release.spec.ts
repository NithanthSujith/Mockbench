import { readFileSync } from 'node:fs'
import type { BrowserContext } from '../apps/web/node_modules/@playwright/test/index.mjs'
import { expect, ORIGIN, OWNER, PROBE_ORIGIN, test } from './fixtures'
import { AuthPage } from './pages/auth.page'
import { ProjectPage } from './pages/project.page'

// XC-01: the first-release loop, against the real compose stack with SEED_DEMO=false on an empty
// database. The tests build on each other (one user, one project, versions v1..v3), so they run in
// order in one worker and stop at the first failure.
test.describe.configure({ mode: 'serial' })

const fixture = (name: string) =>
  readFileSync(new URL(`../packages/schema-core/fixtures/${name}`, import.meta.url), 'utf8')
const WORKED_EXAMPLE = fixture('worked-example.schema.json')
const WORKED_GOLDEN = fixture('worked-example.deterministic-local.golden.txt')

// UUIDs are v5 over the project id, so they differ between the committed golden (fixed project id)
// and a project created just now. Everything else in the preview must equal the golden exactly.
const maskUuids = (text: string) =>
  text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')

const SLUG = 'shop-api'
const MOCK = `/mock/${SLUG}/products/42`
const API_HEADERS = { 'X-Mockbench-Client': 'e2e' }

const state: {
  productsRouteUrl?: string
  notFoundCaseId?: string
  cookies?: Parameters<BrowserContext['addCookies']>[0]
} = {}

/**
 * Signs a fresh context in. The control plane allows 100 requests a minute per session and 10 sign-ins
 * a minute per IP; the whole suite runs in well under a minute and the SPA is chatty, so a single
 * session is not enough and a sign-in per test is too many. Sessions are therefore shared by three
 * tests at a time, starting with the one the golden loop registered.
 */
let signIns = 0
async function signIn(context: BrowserContext) {
  if (signIns > 0 && signIns % 3 === 0) {
    await signInFresh(context)
    state.cookies = await context.cookies()
  } else {
    await context.addCookies(state.cookies!)
  }
  signIns++
}

/** A brand-new session, through the API. */
async function signInFresh(context: BrowserContext) {
  const res = await context.request.post('/api/v1/auth/login', {
    headers: API_HEADERS,
    data: { email: OWNER.email, password: OWNER.password },
  })
  expect(res.status()).toBe(200)
}

/** Setup shortcut for fixtures that are not the subject of a test: publish and deploy over the API. */
async function seedProject(
  context: BrowserContext,
  slug: string,
  routes: {
    path: string
    schema?: unknown
    headers?: Record<string, string>
  }[],
  options: { deploy: boolean },
) {
  const api = context.request
  const me = await (await api.get('/api/v1/auth/me')).json()
  const created = await api.post('/api/v1/projects', {
    headers: API_HEADERS,
    data: { workspaceId: me.workspaces[0].id, name: slug, slug },
  })
  expect(created.status()).toBe(201)
  const project = await created.json()
  for (const r of routes) {
    const route = await (
      await api.post(`/api/v1/projects/${project.id}/routes`, {
        headers: API_HEADERS,
        data: { method: 'GET', path: r.path },
      })
    ).json()
    const cases = await (await api.get(`/api/v1/routes/${route.id}/cases`)).json()
    const patch = await api.patch(`/api/v1/cases/${cases.items[0].id}`, {
      headers: API_HEADERS,
      data: { schema: r.schema, headers: r.headers },
    })
    expect(patch.status()).toBe(200)
  }
  if (!options.deploy) return
  const version = await (
    await api.post(`/api/v1/projects/${project.id}/versions`, { headers: API_HEADERS, data: {} })
  ).json()
  const deployed = await api.post(`/api/v1/projects/${project.id}/deploy`, {
    headers: API_HEADERS,
    data: { versionId: version.id },
  })
  expect(deployed.status()).toBe(200)
}

test('golden loop: register, build, publish, deploy, call the mock from outside the browser', async ({
  page,
  request,
}) => {
  const auth = new AuthPage(page)
  const project = new ProjectPage(page)

  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)

  // First user on a fresh stack: the register screen says so, and they land in workspace Default.
  await auth.register(OWNER)
  await expect(page).toHaveURL(/\/w\/default$/)
  await expect(page.getByRole('banner')).toContainText('Default')

  state.cookies = await page.context().cookies()

  await project.create('Shop API', SLUG)
  await project.createRoute('GET', '/products/:id')
  state.productsRouteUrl = page.url().replace(/\/cases\/[^/]+$/, '')

  await project.setSchemaJson(WORKED_EXAMPLE)
  await expect(project.previewText()).toContainText('"branch_list-3"')
  const preview = (await project.previewText().textContent())!
  expect(maskUuids(preview.trimEnd())).toBe(maskUuids(WORKED_GOLDEN.trimEnd()))

  // The schema must have been saved before it is published.
  await expect(page.getByText(/saved/i).first()).toBeVisible()
  await project.publish({ deploy: true })
  await expect(project.livePill()).toContainText('v1')

  // Outside the browser: a plain HTTP client against the same LAN host name.
  const res = await request.get(MOCK)
  expect(res.status()).toBe(200)
  expect(res.headers()['x-mock-version']).toBe('v1')
  expect(res.headers()['x-mock-route']).toBe('GET /products/:id')
  const body = await res.text()
  // The data plane serves the compact form of exactly what the preview showed.
  expect(body).toBe(JSON.stringify(JSON.parse(preview)))
})

test('the session cookie has no Secure and no Domain and is accepted over plain HTTP', async ({
  page,
  context,
}) => {
  // Raw header from a fresh sign-in.
  const res = await context.request.post('/api/v1/auth/login', {
    headers: API_HEADERS,
    data: { email: OWNER.email, password: OWNER.password },
  })
  const setCookie = res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')!.value
  expect(setCookie).toMatch(/^mockbench_session=/)
  expect(setCookie).toMatch(/HttpOnly/i)
  expect(setCookie).not.toMatch(/;\s*Secure/i)
  expect(setCookie).not.toMatch(/;\s*Domain=/i)

  const cookie = (await context.cookies()).find((c) => c.name === 'mockbench_session')!
  expect(cookie.secure).toBe(false)
  expect(cookie.domain).not.toMatch(/^\./) // host-only

  // The next navigation is authenticated.
  await page.goto('/')
  await expect(page).toHaveURL(/\/w\/default$/)
})

test('Not found case: publish v2, X-Mock-Case selects it, rollback to v1 needs no restart', async ({
  page,
  context,
  request,
}) => {
  await signIn(context)
  const project = new ProjectPage(page)
  await page.goto(state.productsRouteUrl!)
  await project.expectCase('OK')

  await project.addCase('Not found')
  await project.setStatus('Not found', 404)
  await expect(page.getByRole('tab', { name: /Not found/ })).toContainText('404')
  state.notFoundCaseId = page.url().split('/').pop()
  // Give the debounced save time to land before the snapshot is taken.
  await expect(page.getByText(/saved/i).first()).toBeVisible()

  await project.publish({ deploy: true })
  await expect(project.livePill()).toContainText('v2')

  const notFound = await request.get(MOCK, { headers: { 'X-Mock-Case': 'Not found' } })
  expect(notFound.status()).toBe(404)
  expect(notFound.headers()['x-mock-case']).toBe('Not found')
  expect(notFound.headers()['x-mock-error']).toBeUndefined() // a mocked 404, not the server's own
  const dflt = await request.get(MOCK)
  expect(dflt.status()).toBe(200)
  expect(dflt.headers()['x-mock-version']).toBe('v2')
  const v2Body = await dflt.text()

  await project.openVersions()
  await project.deployVersion('v1', true)
  await expect(project.livePill()).toContainText('v1')

  const back = await request.get(MOCK)
  expect(back.status()).toBe(200)
  expect(back.headers()['x-mock-version']).toBe('v1')
  expect(await back.text()).toBe(v2Body) // same schema in both versions
  // v1 has no Not found case: the selector is now a 400.
  const gone = await request.get(MOCK, { headers: { 'X-Mock-Case': 'Not found' } })
  expect(gone.status()).toBe(400)
  expect((await gone.json()).error).toBe('case_not_found')
})

test('the topbar base URL carries the LAN host and no page text says localhost', async ({
  page,
  context,
}) => {
  await signIn(context)
  const project = new ProjectPage(page)
  await page.goto(state.productsRouteUrl!)
  await expect(project.baseUrl()).toContainText('mockbench.lan.test:' + new URL(ORIGIN).port)
  await expect(project.baseUrl()).toContainText(`/mock/${SLUG}`)

  const screens = [state.productsRouteUrl!, `/p/${SLUG}/versions`, '/w/default']
  for (const url of screens) {
    await page.goto(url)
    await expect(page.getByRole('banner')).toBeVisible()
    const visible = await page.evaluate(() => document.body.innerText)
    expect(visible.toLowerCase(), `visible text of ${url}`).not.toContain('localhost')
    expect(visible).not.toContain('127.0.0.1')
  }
})

// PRODUCT BUG (BLD-05 route editor): after "+ Case" or switching case tabs, the previous case's settings
// bar stays mounted under the new one (two "Case name" fields) until the page is reloaded.
// Repro: open any route, click "+ Case", name it, Create. Expected: one case bar.
test.fixme('switching case leaves exactly one case settings bar', async ({ page, context }) => {
  await signIn(context)
  await page.goto(state.productsRouteUrl!)
  await page.getByRole('tab', { name: /Not found/ }).click()
  await expect(page.getByLabel('Case name')).toHaveCount(1)
})

// BLD-12 (the Try-it panel) is not merged: the route editor has no curl snippet to scan. The criterion
// is "the topbar base URL and the Try-it curl both contain mockbench.lan.test:8080".
test.fixme('the Try-it curl contains the LAN host (BLD-12 Try-it panel is not built yet)', async () => {})

test('error paths: unknown slug, unmatched path, unknown case, unpublished project', async ({
  context,
  request,
}) => {
  await signIn(context)
  await seedProject(context, 'draft-api', [{ path: '/things' }], { deploy: false })

  const unknown = await request.get('/mock/no-such-project/anything')
  expect(unknown.status()).toBe(404)
  expect(unknown.headers()['x-mock-error']).toBe('true')
  expect((await unknown.json()).error).toBe('project_not_found')

  const unmatched = await request.get(`/mock/${SLUG}/nothing/here`)
  expect(unmatched.status()).toBe(404)
  expect(unmatched.headers()['x-mock-error']).toBe('true')
  const listed = await unmatched.json()
  expect(listed.error).toBe('route_not_found')
  expect(listed.routes).toContainEqual({ method: 'GET', path: '/products/:id' })

  const badCase = await request.get(MOCK, { headers: { 'X-Mock-Case': 'nope' } })
  expect(badCase.status()).toBe(400)
  expect(badCase.headers()['x-mock-error']).toBe('true')
  expect((await badCase.json()).error).toBe('case_not_found')

  const unpublished = await request.get('/mock/draft-api/things')
  expect(unpublished.status()).toBe(503)
  expect(unpublished.headers()['x-mock-error']).toBe('true')
  expect((await unpublished.json()).error).toBe('project_not_published')
})

test('OPTIONS gets 204 with permissive CORS, and a page on another hostname can read X-Mock-Version', async ({
  page,
  request,
}) => {
  const preflight = await request.fetch(MOCK, {
    method: 'OPTIONS',
    headers: { Origin: PROBE_ORIGIN, 'Access-Control-Request-Method': 'GET' },
  })
  expect(preflight.status()).toBe(204)
  expect(preflight.headers()['access-control-allow-origin']).toBe('*')
  expect(preflight.headers()['access-control-allow-methods']).toContain('GET')

  // A page served from a different origin: the stack answers on a sibling host name too (same
  // machine, different origin). Its own sign-in page is just the document to run the fetch from.
  await page.goto(`${PROBE_ORIGIN}/login`)
  expect(new URL(page.url()).origin).not.toBe(ORIGIN)
  const seen = await page.evaluate(async (url) => {
    const res = await fetch(url)
    return {
      status: res.status,
      version: res.headers.get('X-Mock-Version'),
      body: await res.text(),
    }
  }, `${ORIGIN}${MOCK}`)
  expect(seen.status).toBe(200)
  expect(seen.version).toBe('v1')
  expect(JSON.parse(seen.body)).toHaveProperty('name', 'name-1')
})

test('a text/html mock with an inline script does not run it (CSP sandbox)', async ({
  context,
  page,
  request,
}) => {
  await signIn(context)
  await seedProject(
    context,
    'csp-lab',
    [
      {
        path: '/page',
        headers: { 'Content-Type': 'text/html' },
        schema: {
          version: 1,
          components: {},
          root: { type: 'string', fixed: '<script>window.__pwned = true</script>' },
        },
      },
    ],
    { deploy: true },
  )
  const raw = await request.get('/mock/csp-lab/page')
  expect(raw.headers()['content-type']).toContain('text/html')
  expect(raw.headers()['content-security-policy']).toContain('sandbox')
  expect(raw.headers()['x-content-type-options']).toBe('nosniff')
  expect(await raw.text()).toContain('<script>window.__pwned = true</script>')

  await page.goto('/mock/csp-lab/page')
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned),
  ).toBeUndefined()
})

test.describe('AUTH-03 route guard', () => {
  test('a signed-out visit to a project goes to /login and returns there after sign-in', async ({
    page,
  }) => {
    const auth = new AuthPage(page)
    await page.goto(`/p/${SLUG}/versions`)
    await expect(page).toHaveURL(/\/login\?redirect=%2Fp%2Fshop-api%2Fversions/)
    // Nothing of the protected shell rendered.
    await expect(page.getByRole('banner')).toHaveCount(0)

    await auth.signIn(OWNER, page.url())
    await expect(page).toHaveURL(new RegExp(`/p/${SLUG}/versions$`))
    await expect(page.locator('[data-screen="versions/VersionsScreen"]')).toBeVisible()
  })

  test('only same-origin paths are honoured as a redirect target', async ({ page }) => {
    const auth = new AuthPage(page)
    await auth.signIn(OWNER, '/login?redirect=//evil.example/x')
    await expect(page).toHaveURL(/\/w\/default$/)
  })

  test('signing out ends the session', async ({ page, context }) => {
    await signInFresh(context)
    const auth = new AuthPage(page)
    await page.goto('/w/default')
    await auth.signOut()
    await page.goto(`/p/${SLUG}`)
    await expect(page).toHaveURL(/\/login\?redirect=/)
  })
})

test('BLD-05: the selected case lives in the URL (reload and back keep it)', async ({
  page,
  context,
}) => {
  await signIn(context)
  const project = new ProjectPage(page)
  await page.goto(state.productsRouteUrl!)
  // No case in the URL redirects to the default case.
  await expect(page).toHaveURL(/\/cases\/[^/]+$/)
  const okUrl = page.url()
  await project.expectCase('OK')

  await page.getByRole('tab', { name: /Not found/ }).click()
  await expect(page).toHaveURL(new RegExp(`/cases/${state.notFoundCaseId}$`))
  await project.expectCase('Not found')

  await page.reload()
  await expect(page).toHaveURL(new RegExp(`/cases/${state.notFoundCaseId}$`))
  await project.expectCase('Not found')

  await page.goBack()
  await expect(page).toHaveURL(okUrl)
  await project.expectCase('OK')

  // A case id that is not one of this route's cases is the not-found screen.
  await page.goto(`${state.productsRouteUrl}/cases/00000000-0000-7000-8000-000000000000`)
  await expect(page.locator('[data-screen="shell/NotFound"]')).toBeVisible()
})

test('RUN-09: publish without deploying leaves the live version alone; deploy then switches it', async ({
  page,
  context,
  request,
}) => {
  await signIn(context)
  const project = new ProjectPage(page)
  await page.goto(state.productsRouteUrl!)
  await expect(project.livePill()).toContainText('v1')

  await project.publish({ deploy: false })
  await expect(project.livePill()).toContainText('v1')
  expect((await request.get(MOCK)).headers()['x-mock-version']).toBe('v1')

  await project.openVersions()
  await project.deployVersion('v3', false)
  await expect(project.livePill()).toContainText('v3')
  expect((await request.get(MOCK)).headers()['x-mock-version']).toBe('v3')
})
