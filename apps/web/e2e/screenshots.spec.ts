import { test } from '@playwright/test'

// Captures the gallery at the prototype's three layout widths so the owner can compare with
// design-reference/prototype.html. Output is git-ignored: apps/web/gallery-screenshots/.
for (const width of [1440, 1000, 390]) {
  test(`gallery screenshot at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({
      path: `gallery-screenshots/gallery-${width}.png`,
      fullPage: true,
    })
  })
}
