import { expect, OWNER, test } from './fixtures'
import { AuthPage } from './pages/auth.page'

// XC-01: run against a separate fresh stack with SEED_DEMO=true (E2E_STACK=seed). RUN-11 (the demo
// seed) is not merged yet, so the first test is fixme until it is. The registrant test passes today.
test.describe.configure({ mode: 'serial' })

test.fixme('GET /mock/demo/users answers before anyone has registered (RUN-11 demo seed is not built yet)', async ({
  request,
}) => {
  const res = await request.get('/mock/demo/users')
  expect(res.status()).toBe(200)
  expect(res.headers()['x-mock-version']).toBeDefined()
})

test('the first registrant owns workspace default', async ({ page }) => {
  await new AuthPage(page).register(OWNER)
  await expect(page).toHaveURL(/\/w\/default$/)
  const me = await page.evaluate(() => fetch('/api/v1/auth/me').then((r) => r.json()))
  expect(me.workspaces).toEqual([expect.objectContaining({ slug: 'default', role: 'owner' })])
})
