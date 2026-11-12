import { expect, test } from '@playwright/test'

// Runs against `vite --mode mock`: every /api/v1 call is answered by MSW from the contract examples.

test.describe('project settings (mock mode)', () => {
  test('delete needs the slug typed exactly', async ({ page }) => {
    await page.goto('/p/billing-api/settings')
    await page.getByRole('button', { name: 'Delete project' }).click()
    const dialog = page.getByRole('dialog')
    const confirm = dialog.getByRole('button', { name: 'Delete project' })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel('Type billing-api to confirm').fill('billing-ap')
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel('Type billing-api to confirm').fill('billing-api')
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(page).toHaveURL(/\/w\/[^/]+$/)
  })
})
