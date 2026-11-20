import { expect, OWNER, test } from './fixtures'
import { API_HEADERS, firstWorkspace, signInAsOwner } from './support/owner'

/**
 * WS-04 against the real API. Testing Library covers the table and the optimistic updates with a
 * mocked client; only the stack can show the server's own `user_not_found`, `already_member` and
 * last-owner refusals arriving as the screen's three messages, and the member list surviving a reload.
 *
 * The second account is a later registrant, so by the D3 rule it owns no workspace until it is added.
 */
test.describe.configure({ mode: 'serial' })

const MEMBER = { name: 'Devin Okafor', email: 'devin@example.test', password: 'correct-horse-9' }

test('an owner adds a member, is refused twice, and cannot drop the last owner', async ({
  page,
}) => {
  // Register the second account first: this replaces the context's cookie, so sign in as OWNER after.
  const registered = await page.context().request.post('/api/v1/auth/register', {
    headers: API_HEADERS,
    data: MEMBER,
  })
  expect([201, 409]).toContain(registered.status())
  await page.context().clearCookies()
  await signInAsOwner(page.context())
  const workspace = await firstWorkspace(page.context())
  expect(workspace.role).toBe('owner')

  await page.goto(`/w/${workspace.slug}/members`)
  const screen = page.locator('[data-screen="workspaces/MembersScreen"]')
  await expect(screen).toBeVisible()

  const form = page.getByRole('form', { name: 'Add member' })
  const email = form.getByLabel('Email')

  // An address with no account: the server says user_not_found, the screen says what to do about it.
  await email.fill('nobody@example.test')
  await form.getByRole('button', { name: 'Add member' }).click()
  await expect(
    page.getByText('No account with that email — they need to register first'),
  ).toBeVisible()

  // The real account is appended without a reload.
  await email.fill(MEMBER.email)
  await form.getByRole('button', { name: 'Add member' }).click()
  const memberRow = page.getByRole('row').filter({ hasText: MEMBER.email })
  await expect(memberRow).toBeVisible()
  await expect(memberRow).toContainText('editor')

  // Adding them again is already_member.
  await email.fill(MEMBER.email)
  await form.getByRole('button', { name: 'Add member' }).click()
  await expect(page.getByText('Already a member')).toBeVisible()

  // The owner is the only owner, so demoting themselves is refused and the select goes back.
  const ownerSelect = page.getByLabel(`Role for ${OWNER.name}`)
  await ownerSelect.click()
  await page.getByRole('option', { name: 'editor' }).click()
  await expect(page.getByText('A workspace needs at least one owner')).toBeVisible()
  await expect(ownerSelect).toContainText('owner')

  // The addition really is on the server, not only in the cache.
  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: MEMBER.email })).toBeVisible()
})

test('removing a member asks first, names them, and empties the row', async ({ page }) => {
  await signInAsOwner(page.context())
  const workspace = await firstWorkspace(page.context())

  await page.goto(`/w/${workspace.slug}/members`)
  const memberRow = page.getByRole('row').filter({ hasText: MEMBER.email })
  await expect(memberRow).toBeVisible()

  await memberRow.getByRole('button', { name: `Remove ${MEMBER.name}` }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(MEMBER.name)
  await expect(dialog).toContainText(MEMBER.email)
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('row').filter({ hasText: MEMBER.email })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('row').filter({ hasText: MEMBER.email })).toHaveCount(0)
})
