import { expect, test } from '../apps/web/node_modules/@playwright/test/index.mjs'

// The app is opened at a host name that is not localhost. Everything it needs must come from that
// same origin: the SPA, its assets (relative URLs) and the API (relative /api/v1/... URLs).
//
// All requests are made from inside the page. Playwright's Node-side `page.request` client does not
// use the browser's host-resolver mapping, and a real teammate's browser is the thing under test.
test.describe('the stack served at a LAN-style host name', () => {
  test('SPA, relative assets and /api/v1/instance all come from that origin', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin
    expect(origin).not.toContain('localhost')

    const requested: string[] = []
    page.on('request', (r) => requested.push(r.url()))

    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    await page.waitForLoadState('networkidle')

    // The page really is on the mapped host, not on localhost.
    expect(new URL(page.url()).hostname).toBe(new URL(origin).hostname)

    // Built asset references are relative or same-origin: nothing absolute to another host.
    const assetRefs = await page.evaluate(() =>
      [...document.querySelectorAll('script[src], link[href]')].map(
        (el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '',
      ),
    )
    expect(assetRefs.length).toBeGreaterThan(0)
    for (const ref of assetRefs) expect(ref, `asset ref ${ref}`).not.toMatch(/^(https?:)?\/\//)

    // A relative API call made from the page reaches the api through nginx.
    const instance = await page.evaluate(async () => {
      const res = await fetch('/api/v1/instance')
      return { status: res.status, body: await res.json() }
    })
    expect(instance.status).toBe(200)
    expect(instance.body).toMatchObject({ name: 'Mockbench' })
    expect(typeof instance.body.allowSignup).toBe('boolean')

    // A deep client-side route is served by the SPA fallback.
    const deep = await page.evaluate(async () => {
      const res = await fetch('/p/some-project/routes/abc')
      return { status: res.status, type: res.headers.get('content-type') ?? '' }
    })
    expect(deep.status).toBe(200)
    expect(deep.type).toContain('text/html')

    // Nothing left the host: every request (page, assets, fonts, API) targets the mapped origin.
    const offHost = requested.filter(
      (u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'),
    )
    expect(offHost, `requests that left ${origin}`).toEqual([])
    expect(requested.some((u) => u.includes('localhost') || u.includes('127.0.0.1'))).toBe(false)
  })

  test('a mock URL on the same origin is answered by the api, including OPTIONS', async ({
    page,
  }) => {
    await page.goto('/')
    const options = await page.evaluate(async () => {
      const res = await fetch('/mock/anything/at/all', { method: 'OPTIONS' })
      return {
        status: res.status,
        mockError: res.headers.get('x-mock-error'),
        type: res.headers.get('content-type') ?? '',
      }
    })
    // Phase 1: the data-plane stub answers 501 with X-Mock-Error. It must come from the api, not nginx.
    expect(options.mockError).toBe('true')
    expect(options.type).toContain('application/json')
  })
})
