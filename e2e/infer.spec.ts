import { expect, test } from './fixtures'
import { createProjectWithRoute, publishAndDeploy, signInAsOwner } from './support/owner'
import { ProjectPage } from './pages/project.page'

/**
 * BLD-09, against the real API. Testing Library already covers the panel's own behaviour with a mocked
 * client; what only the stack can show is that an accepted inference autosaves, survives a reload, and
 * reaches the data plane — and that a schema the validator rejects is never saved.
 */
test.describe.configure({ mode: 'serial' })

const SAMPLE = '{"role":"admin","tags":["a","b"],"meta":null}'

test('infer from an example fills the builder, flags the null, autosaves and reaches the mock', async ({
  page,
  request,
}) => {
  await signInAsOwner(page.context())
  const fixture = await createProjectWithRoute(page.context(), {
    slug: 'infer-api',
    path: '/profile',
  })

  await page.goto(fixture.caseUrl)
  await page.getByRole('tab', { name: 'JSON' }).click()
  await page.getByRole('button', { name: 'Infer from example' }).click()
  await page.getByLabel('Example JSON').fill(SAMPLE)
  await page.getByRole('button', { name: 'Infer schema' }).click()

  // The notice is always shown: inference is a starting point, not an answer.
  await expect(page.getByRole('note')).toContainText('Inference is a starting point')

  const fields = page.getByRole('list', { name: 'Inferred fields' })
  await expect(fields.getByRole('listitem').filter({ hasText: 'role' })).toContainText('string')
  await expect(fields.getByRole('listitem').filter({ hasText: 'tags' })).toContainText(
    'array count 2',
  )
  // A null sample cannot say what the type is; it defaults to string and is flagged.
  const meta = fields.getByRole('listitem').filter({ hasText: 'meta' })
  await expect(meta).toContainText('string nullable')
  await expect(meta).toHaveAttribute('data-flagged', 'true')

  await page.getByRole('button', { name: 'Use this schema' }).click()

  // Accepting switches to the Builder tab and carries the amber flag over.
  await expect(
    page.getByRole('tablist', { name: 'Schema view' }).getByRole('tab', { selected: true }),
  ).toContainText('Builder')
  await expect(page.getByText('Real type unknown (was null)')).toBeVisible()

  // The real-API half: the accepted schema is autosaved, not just held in the store.
  await expect(page.getByText('Saved')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Field name').first()).toHaveValue('role')
  const stored = await (await page.context().request.get(`/api/v1/cases/${fixture.caseId}`)).json()
  expect(stored.schema.root.fields.map((f: { key: string }) => f.key)).toEqual([
    'role',
    'tags',
    'meta',
  ])

  // And it generates: publish, deploy, then call the mock from outside the browser.
  await publishAndDeploy(page.context(), fixture.projectId)
  const res = await request.get(`/mock/${fixture.slug}/profile`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(Object.keys(body).sort()).toEqual(['meta', 'role', 'tags'])
  expect(Array.isArray(body.tags)).toBe(true)
  expect(body.tags).toHaveLength(2)
})

test('a schema the validator rejects in the JSON tab is never saved', async ({ page }) => {
  await signInAsOwner(page.context())
  const fixture = await createProjectWithRoute(page.context(), {
    slug: 'infer-reject',
    path: '/thing',
    schema: {
      version: 1,
      components: {},
      root: { type: 'object', fields: [{ key: 'ok', node: { type: 'string' } }] },
    },
  })
  const project = new ProjectPage(page)

  await page.goto(fixture.caseUrl)
  await project.setSchemaJson(
    '{"version":1,"components":{},"root":{"type":"object","fields":[{"key":"nope","node":{"type":"not-a-type"}}]}}',
  )

  // The problems list names the offending path and the store keeps the previous schema. The list
  // declares role="alert", which overrides the implicit list role.
  const problems = page.getByRole('alert', { name: 'Schema problems' })
  await expect(problems).toBeVisible()
  await expect(problems).toContainText('root.fields[0].node')
  await expect(
    page.getByText('The Builder keeps the last valid schema until this is fixed.'),
  ).toBeVisible()
  const stored = await (await page.context().request.get(`/api/v1/cases/${fixture.caseId}`)).json()
  expect(stored.schema.root.fields.map((f: { key: string }) => f.key)).toEqual(['ok'])
})
