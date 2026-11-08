import { expect, test } from '@playwright/test'

test.describe('design system in a real browser', () => {
  test('uses IBM Plex Mono for mono text and Archivo for UI text, both actually loaded', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Mockbench UI kit' })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    const mono = await page
      .getByTestId('mono-sample')
      .evaluate((el) => getComputedStyle(el).fontFamily)
    const body = await page
      .getByTestId('body-sample')
      .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(mono.startsWith('"IBM Plex Mono"')).toBe(true)
    expect(body.startsWith('Archivo')).toBe(true)

    const loaded = await page.evaluate(() => ({
      mono: document.fonts.check('400 14px "IBM Plex Mono"'),
      ui: document.fonts.check('400 14px "Archivo"'),
      faces: Array.from(document.fonts)
        .filter((f) => f.status === 'loaded')
        .map((f) => f.family.replace(/"/g, '')),
    }))
    expect(loaded.mono).toBe(true)
    expect(loaded.ui).toBe(true)
    expect(loaded.faces).toContain('IBM Plex Mono')
    expect(loaded.faces).toContain('Archivo')
  })

  test('every network request on page load is same-origin (nothing external, nothing failing)', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin
    const requested: string[] = []
    const failed: string[] = []
    page.on('request', (r) => requested.push(r.url()))
    page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`))

    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    await page.waitForLoadState('networkidle')

    const external = requested.filter((u) => !u.startsWith(origin) && !u.startsWith('data:'))
    expect(external).toEqual([])
    expect(requested.some((u) => /fonts\.(googleapis|gstatic)\.com/.test(u))).toBe(false)
    expect(requested.some((u) => /\.woff2?$/.test(new URL(u).pathname))).toBe(true)
    expect(failed).toEqual([])
  })

  test('is dark only: color-scheme is dark and a light OS preference changes nothing', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, colorScheme: 'light' })
    const page = await context.newPage()
    await page.goto('/')
    const info = await page.evaluate(() => ({
      scheme: getComputedStyle(document.documentElement).colorScheme,
      bg: getComputedStyle(document.body).backgroundColor,
      ink: getComputedStyle(document.body).color,
      htmlClass: document.documentElement.className,
    }))
    expect(info.scheme).toBe('dark')
    expect(info.bg).toBe('rgb(12, 15, 19)')
    expect(info.ink).toBe('rgb(232, 236, 242)')
    expect(info.htmlClass).not.toMatch(/dark|light/)
    await context.close()
  })

  test('keyboard focus shows the focus ring on every kind of control', async ({ page }) => {
    await page.goto('/')
    const ring = async () =>
      page.evaluate(() => {
        const cs = getComputedStyle(document.activeElement!)
        return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor }
      })

    await page.keyboard.press('Tab')
    expect(await ring()).toEqual({ style: 'solid', width: '2px', color: 'rgb(124, 160, 255)' })

    // Tab through the first twenty stops: each focused element must show the same ring.
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab')
      const r = await ring()
      expect(r.style).toBe('solid')
      expect(r.width).toBe('2px')
      expect(r.color).toBe('rgb(124, 160, 255)')
    }
  })

  test('hover changes the primary button, and reduced motion removes transitions', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto('/')
    const primary = page.getByRole('button', { name: 'Default' }).first()
    await expect(primary).toHaveCSS('opacity', '1')
    await primary.hover()
    await expect(primary).toHaveCSS('opacity', '0.9')
    expect(await primary.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s')
    await context.close()
  })

  test('the layout does not scroll horizontally at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
