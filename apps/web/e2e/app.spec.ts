import { expect, test, type Page } from '@playwright/test'

// Runs against `vite --mode mock`: the whole app with every /api/v1 call answered by MSW from the
// contract examples, no backend at all.

const screenOf = (page: Page) => page.locator('[data-screen]').first()

test.describe('mock mode (dev:mock)', () => {
  test('serves contract examples with no backend, and the shell renders against them', async ({
    page,
  }) => {
    await page.goto('/login')
    await expect(screenOf(page)).toHaveAttribute('data-screen', 'auth/LoginScreen')

    // The worker is controlling the page: API calls are answered from the registry examples.
    const instance = await page.evaluate(() => fetch('/api/v1/instance').then((r) => r.json()))
    expect(instance).toMatchObject({ name: 'Mockbench', setupRequired: false })
    const me = await page.evaluate(() => fetch('/api/v1/auth/me').then((r) => r.status))
    expect(me).toBe(200)
    const created = await page.evaluate(() =>
      fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Mockbench-Client': 'web' },
        body: '{}',
      }).then((r) => r.status),
    )
    expect(created).toBe(201)

    // A protected screen renders: the guard's session probe (auth.me) is mocked too.
    await page.goto('/w/alps')
    await expect(screenOf(page)).toHaveAttribute('data-screen', 'projects/ProjectListScreen')
    await expect(page.getByRole('banner')).toBeVisible()
  })

  const ROUTES: [string, string][] = [
    ['/w/alps/members', 'workspaces/MembersScreen'],
    // Lands on the first route (the example project has one), so the editor is what renders.
    ['/p/billing-api', 'routes/RouteEditorScreen'],
    ['/p/billing-api/routes/r1', 'routes/RouteEditorScreen'],
    ['/p/billing-api/routes/r1/cases/c1', 'routes/RouteEditorScreen'],
    ['/p/billing-api/versions', 'versions/VersionsScreen'],
    ['/p/billing-api/presets', 'presets/PresetsScreen'],
    ['/p/billing-api/logs', 'logs/LogsScreen'],
    ['/p/billing-api/settings', 'projects/SettingsScreen'],
  ]
  for (const [path, screenName] of ROUTES) {
    test(`${path} renders ${screenName} inside the shell`, async ({ page }) => {
      await page.goto(path)
      await expect(screenOf(page)).toHaveAttribute('data-screen', screenName)
      await expect(page.getByRole('banner')).toBeVisible()
    })
  }

  test('the top bar shows the mock base URL of the open project, derived from the address bar', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/p/billing-api/versions')
    await expect(page.locator('[data-slot="base-url"]')).toContainText(
      `${new URL(baseURL!).origin}/mock/billing-api`,
    )
  })

  test('an unknown path shows the not-found screen inside the shell', async ({ page }) => {
    await page.goto('/p/billing-api/nothing-here')
    await expect(screenOf(page)).toHaveAttribute('data-screen', 'shell/NotFound')
    await expect(page.getByRole('banner')).toHaveCount(1)
  })

  test('the project rail links navigate between project screens without a reload', async ({
    page,
  }) => {
    await page.goto('/p/billing-api')
    await page.getByRole('link', { name: 'Versions' }).click()
    await expect(page).toHaveURL(/\/p\/billing-api\/versions$/)
    await expect(screenOf(page)).toHaveAttribute('data-screen', 'versions/VersionsScreen')
  })

  // The prototype's responsive rules: three columns, then two (response drops below), then one.
  const tracks = (page: Page, selector: string) =>
    page
      .locator(selector)
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)

  for (const [width, editorTracks, wideTracks] of [
    [1440, 3, 2],
    [1000, 2, 2],
    [390, 1, 1],
  ] as const) {
    test(`layout at ${width}px: route editor ${editorTracks} column(s), other project screens ${wideTracks}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 })

      await page.goto('/p/billing-api/routes/r1')
      await expect(screenOf(page)).toHaveAttribute('data-screen', 'routes/RouteEditorScreen')
      expect(await tracks(page, '[data-shell="editor"]')).toBe(editorTracks)
      if (width < 1240) {
        // The response column drops below the editor: it spans the full row.
        const [editor, response] = await Promise.all([
          page.locator('[data-column="editor"]').boundingBox(),
          page.locator('[data-column="response"]').boundingBox(),
        ])
        expect(response!.y).toBeGreaterThan(editor!.y)
      }
      await page.screenshot({ path: `gallery-screenshots/shell-editor-${width}.png` })

      await page.goto('/p/billing-api/versions')
      await expect(screenOf(page)).toHaveAttribute('data-screen', 'versions/VersionsScreen')
      expect(await tracks(page, '[data-shell="wide"]')).toBe(wideTracks)
      await page.screenshot({ path: `gallery-screenshots/shell-wide-${width}.png` })

      // No horizontal scroll at any width.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    })
  }

  test('below 860px the base URL moves to its own full-width row in the top bar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto('/p/billing-api/versions')
    const [bar, url] = await Promise.all([
      page.getByRole('banner').boundingBox(),
      page.locator('[data-slot="base-url"]').boundingBox(),
    ])
    expect(url!.width).toBeGreaterThan(bar!.width - 40)
  })
})

test.describe('project shell and route rail (mock mode)', () => {
  test('a project the user cannot see shows not-found and no rail', async ({ page }) => {
    await page.goto('/p/missing')
    await expect(screenOf(page)).toHaveAttribute('data-screen', 'shell/NotFound')
    await expect(page.getByRole('navigation', { name: 'Project' })).toHaveCount(0)
  })

  test('creating a colliding route shows the collision message with a link to the route', async ({
    page,
  }) => {
    await page.goto('/p/billing-api')
    await page.getByRole('button', { name: 'New route' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Path').fill('/orders')
    await dialog.getByRole('button', { name: 'Create route' }).click()
    await expect(dialog.getByText('A GET route with this path already exists')).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Open it' })).toBeVisible()
  })
})
