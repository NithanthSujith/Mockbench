import { expect, OWNER, test } from './fixtures'
import { AuthPage } from './pages/auth.page'

// XC-01: run against a separate fresh stack with SEED_DEMO=true (E2E_STACK=seed). The first test needs the RUN-11 demo seed; the second needs the first-registrant hand-off.
test.describe.configure({ mode: 'serial' })

test('GET /mock/demo/users answers before anyone has registered (RUN-11 demo seed)', async ({
  request,
}) => {
  const res = await request.get('/mock/demo/users')
  expect(res.status()).toBe(200)
  expect(res.headers()['x-mock-version']).toBe('v1')
  expect(await res.json()).toHaveLength(3)
})

test('the first registrant owns workspace default', async ({ page }) => {
  await new AuthPage(page).register(OWNER)
  await expect(page).toHaveURL(/\/w\/default$/)
  const me = await page.evaluate(() => fetch('/api/v1/auth/me').then((r) => r.json()))
  expect(me.workspaces).toEqual([expect.objectContaining({ slug: 'default', role: 'owner' })])
})
