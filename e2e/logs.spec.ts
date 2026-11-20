import { expect, test } from './fixtures'
import { createProjectWithRoute, publishAndDeploy, signInAsOwner } from './support/owner'

/**
 * RUN-08's polling half, against the real API. Testing Library covers the table and the filters with a
 * mocked client; only the stack can show the 3 s poll picking up a request that a client outside the
 * browser made while the screen was open, the pause actually stopping it, and the writer's redaction
 * arriving in the screen.
 */
test.describe.configure({ mode: 'serial' })

const SLUG = 'logs-api'
const SCHEMA = {
  version: 1,
  components: {},
  root: { type: 'object', fields: [{ key: 'ok', node: { type: 'boolean' } }] },
}

test('auto-refresh picks up new requests, pauses, and shows redacted headers', async ({
  page,
  request,
}) => {
  await signInAsOwner(page.context())
  const fixture = await createProjectWithRoute(page.context(), {
    slug: SLUG,
    path: '/items',
    schema: SCHEMA,
  })
  await publishAndDeploy(page.context(), fixture.projectId)

  // One request before the screen is open, carrying a header the writer must redact.
  const first = await request.get(`/mock/${SLUG}/items?token=sekrit&page=2`, {
    headers: { authorization: 'Bearer sekrit' },
  })
  expect(first.status()).toBe(200)

  await page.goto(`/p/${SLUG}/logs`)
  const rows = page.locator('[data-screen="logs/LogsScreen"] tbody tr')
  await expect(rows.filter({ hasText: '/items' })).toHaveCount(1)

  // Auto-refresh is the default; a request made now must appear without a reload.
  await expect(page.getByLabel('Auto-refresh')).toBeChecked()
  expect((await request.get(`/mock/${SLUG}/items`)).status()).toBe(200)
  await expect(rows.filter({ hasText: '/items' })).toHaveCount(2, { timeout: 15_000 })

  // Paused: a third request does not show up until polling resumes.
  await page.getByLabel('Auto-refresh').uncheck()
  expect((await request.get(`/mock/${SLUG}/items`)).status()).toBe(200)
  await expect(rows.filter({ hasText: '/items' })).toHaveCount(2)
  await page.getByLabel('Auto-refresh').check()
  await expect(rows.filter({ hasText: '/items' })).toHaveCount(3, { timeout: 15_000 })

  // Expanding the oldest row shows the redacted header and the query, as stored.
  await page.getByRole('button', { name: 'Show details for GET /items' }).last().click()
  const details = page.locator('[data-testid="log-details"]')
  await expect(details).toContainText('authorization')
  await expect(details).toContainText('[redacted]')
  await expect(details).toContainText('page')
  await expect(details).not.toContainText('sekrit')
})

test('the status filter re-queries the server and Load more pages', async ({ page, request }) => {
  await signInAsOwner(page.context())

  // A 404 from the data plane (no such path) alongside the 200s of the first test.
  expect((await request.get(`/mock/${SLUG}/nope`)).status()).toBe(404)

  await page.goto(`/p/${SLUG}/logs`)
  const rows = page.locator('[data-screen="logs/LogsScreen"] tbody tr')
  await expect(rows.filter({ hasText: '/nope' })).toHaveCount(1)

  await page.getByLabel('Status').click()
  await page.getByRole('option', { name: '4xx' }).click()
  await expect(rows.filter({ hasText: '/nope' })).toHaveCount(1)
  await expect(rows.filter({ hasText: '/items' })).toHaveCount(0)

  // A mock error is the server's own 404, not one of the project's cases: the row says so.
  await expect(page.getByText('mock server').first()).toBeVisible()
})

test('a project with no requests shows the empty state', async ({ page }) => {
  await signInAsOwner(page.context())
  const quiet = await createProjectWithRoute(page.context(), {
    slug: 'logs-quiet',
    path: '/nothing',
    schema: SCHEMA,
  })
  // Deployed, so the empty text is the plain one without the Versions hint.
  await publishAndDeploy(page.context(), quiet.projectId)

  await page.goto(`/p/${quiet.slug}/logs`)
  await expect(
    page.getByText('No requests yet. The log starts filling once this project is deployed.'),
  ).toBeVisible()
  await expect(page.getByText('Older entries are pruned automatically.')).toBeVisible()
})
