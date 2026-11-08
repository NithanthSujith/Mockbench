import { readdirSync, readFileSync, statSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'

// Runs against the PRODUCTION build served by `vite preview`.

const DIST = join(import.meta.dirname, '..', 'dist')
const PREVIEW_PORT = 4173

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

/** A non-loopback IPv4 address of this machine, i.e. what a colleague on the LAN would use. */
function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const nic of list ?? []) {
      if (nic.family === 'IPv4' && !nic.internal) return nic.address
    }
  }
  return undefined
}

test.describe('production preview (vite preview --host)', () => {
  test('is reachable from the machine LAN address and the app loads there', async ({
    page,
    request,
  }) => {
    const ip = lanAddress()
    test.skip(!ip, 'no non-loopback IPv4 address on this machine')
    const base = `http://${ip}:${PREVIEW_PORT}`

    const res = await request.get(`${base}/`)
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('id="root"')

    await page.goto(`${base}/login`)
    await expect(page.locator('[data-screen]').first()).toHaveAttribute(
      'data-screen',
      'auth/LoginScreen',
    )
  })

  test('the production build excludes MSW, the mock service worker and the UI-kit gallery', () => {
    const files = walk(DIST)
    expect(files.filter((f) => /mockServiceWorker/i.test(f))).toEqual([])
    const text = files
      .filter((f) => /\.(js|css|html)$/.test(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    expect(text).not.toMatch(/mockServiceWorker|setupWorker|@mswjs|HttpResponse/)
    expect(text).not.toContain('Mockbench UI kit') // the gallery heading
  })

  test('the built page loads nothing from outside its own origin and has no hard-coded loopback address', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf8')
    expect(html).not.toMatch(/https?:\/\//)
    const js = walk(DIST)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    expect(js).not.toMatch(/127\.0\.0\.1|localhost:\d/)
  })

  test('the production bundle carries no Zod (the client uses a generated endpoint table)', () => {
    const js = walk(DIST)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    expect(js).not.toMatch(/ZodError|\$ZodType|ZodObject/)
  })

  test('reports the bundle size and keeps the entry chunk under budget', () => {
    const chunks = walk(join(DIST, 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => ({ name: f.split(/[\\/]/).pop()!, gzip: gzipSync(readFileSync(f)).length }))
      .sort((a, b) => b.gzip - a.gzip)
    const entry = chunks.find((c) => c.name.startsWith('index-'))!
    const total = chunks.reduce((n, c) => n + c.gzip, 0)
    console.log(
      `bundle (gzip): entry ${entry.gzip} B, all JS ${total} B, largest: ${chunks
        .slice(0, 3)
        .map((c) => `${c.name} ${c.gzip}`)
        .join(', ')}`,
    )
    expect(entry.gzip).toBeLessThan(110 * 1024)
  })
})
