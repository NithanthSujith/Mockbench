// @playwright/test is installed under apps/web, so it is imported by relative path: that resolves to
// the same copy the runner uses (a second copy would make Playwright refuse to run).
import { expect, test as base } from '../apps/web/node_modules/@playwright/test/index.mjs'
import { ORIGIN, PROBE_ORIGIN } from './support/lan'

export { expect }
export { LAN_HOST, ORIGIN, OWNER, PROBE_ORIGIN } from './support/lan'

/**
 * Every browser request of every test must stay on the stack's own origin: no fonts, CDNs, analytics
 * or other hosts (CLAUDE.md, LAN-only threat model). It is registered per context, so popups are
 * covered too. The one exception is the sibling hostname of the stack that the CORS test opens a real
 * page on: it resolves to the same machine and is answered by the same stack.
 */
export const test = base.extend<{ offHostGuard: void }>({
  offHostGuard: [
    async ({ context }, use) => {
      const allowed = new Set([new URL(ORIGIN).host, new URL(PROBE_ORIGIN).host])
      const offHost: string[] = []
      context.on('request', (request) => {
        const url = request.url()
        if (/^(data|blob|about):/.test(url)) return
        if (!allowed.has(new URL(url).host)) offHost.push(url)
      })
      await use()
      expect(offHost, 'browser requests that left the stack').toEqual([])
    },
    { auto: true },
  ],
})
