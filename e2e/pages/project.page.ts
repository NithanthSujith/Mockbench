import type { Page } from '../../apps/web/node_modules/@playwright/test/index.mjs'
import { expect } from '../fixtures'

/** Project list, project shell, route editor, publish dialog and versions screen. */
export class ProjectPage {
  constructor(private readonly page: Page) {}

  async create(name: string, slug: string) {
    await this.page.getByRole('button', { name: 'New project' }).first().click()
    const dialog = this.page.getByRole('dialog')
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByLabel('Slug').fill(slug)
    await dialog.getByRole('button', { name: 'Create project' }).click()
    await expect(this.page).toHaveURL(new RegExp(`/p/${slug}`))
  }

  async createRoute(method: string, path: string) {
    await this.page.getByRole('button', { name: 'New route' }).first().click()
    const dialog = this.page.getByRole('dialog')
    if (method !== 'GET') {
      await dialog.getByLabel('Method').click()
      await this.page.getByRole('option', { name: method }).click()
    }
    await dialog.getByLabel('Path').fill(path)
    await dialog.getByRole('button', { name: 'Create route' }).click()
    await expect(this.page).toHaveURL(/\/routes\/[^/]+\/cases\/[^/]+$/)
  }

  /** Replaces the selected case's schema through the JSON tab and waits for the autosave. */
  async setSchemaJson(json: string) {
    await this.page.getByRole('tab', { name: 'JSON' }).click()
    const editor = this.page.getByLabel('Schema JSON')
    await editor.click()
    await this.page.keyboard.press('ControlOrMeta+A')
    // insertText skips the editor's auto-indent and auto-closing of brackets.
    await this.page.keyboard.insertText(json)
    // The JSON tab applies its text on blur.
    await this.page.getByRole('heading', { name: 'Response body' }).click()
  }

  previewText() {
    return this.page.getByLabel('Response preview')
  }

  async addCase(name: string) {
    await this.page.getByRole('button', { name: 'Case', exact: true }).click()
    const dialog = this.page.getByRole('dialog')
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByRole('button', { name: 'Create case' }).click()
    await this.expectCase(name)
  }

  /**
   * The settings bar of the case with this name (filtered by its name input, which also asserts
   * that the bar belongs to the selected case).
   */
  caseBar(name: string) {
    return this.page.locator('[data-screen="routes/CaseBar"]').filter({
      has: this.page.locator(`input[value="${name}"]`),
    })
  }

  /** The selected tab, and so the case in the URL, is `name`. */
  async expectCase(name: string) {
    await expect(
      this.page
        .getByRole('tablist', { name: 'Response cases' })
        .getByRole('tab', { selected: true }),
    ).toContainText(name)
    await expect(this.caseBar(name)).toBeVisible()
  }

  async setStatus(caseName: string, code: number) {
    await this.caseBar(caseName).getByLabel('Status').click()
    await this.page.getByRole('option', { name: String(code), exact: true }).click()
  }

  /** Publishes from the topbar; returns after the dialog closes. */
  async publish(options: { deploy: boolean; label?: string } = { deploy: true }) {
    await this.page.locator('[data-slot="publish"]').click()
    const dialog = this.page.getByRole('dialog')
    if (options.label) await dialog.getByLabel('Label').fill(options.label)
    const deploy = dialog.getByLabel('Deploy immediately')
    if ((await deploy.isChecked()) !== options.deploy) await deploy.setChecked(options.deploy)
    await dialog.getByRole('button', { name: 'Publish' }).click()
    await expect(dialog).toBeHidden()
  }

  async openVersions() {
    await this.page.getByRole('link', { name: 'Versions' }).click()
    await expect(this.page.locator('[data-screen="versions/VersionsScreen"]')).toBeVisible()
  }

  async deployVersion(label: string, rollback: boolean) {
    const row = this.page.getByRole('row').filter({
      has: this.page.getByRole('cell', { name: label, exact: true }),
    })
    await row.getByRole('button', { name: 'Deploy' }).click()
    const dialog = this.page.getByRole('dialog')
    await dialog.getByRole('button', { name: rollback ? 'Roll back' : 'Deploy' }).click()
    await expect(dialog).toBeHidden()
    await expect(row.getByText('LIVE')).toBeVisible()
  }

  livePill() {
    return this.page.locator('[data-slot="live-pill"]')
  }

  baseUrl() {
    return this.page.locator('[data-slot="base-url"]')
  }
}
