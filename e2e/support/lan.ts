import dns from 'node:dns'

// The browser is pointed at a name that exists nowhere in DNS with Chromium's --host-resolver-rules.
// Node-side clients (APIRequestContext, i.e. "outside the browser") do not see that rule, so the
// same mapping is applied to dns.lookup here. Every call then goes to http://mockbench.lan.test:<port>.
export const LAN_HOST = 'mockbench.lan.test'
/** A second hostname on the same machine, used as the "other origin" for the CORS check. */
export const PROBE_HOST = `probe.${LAN_HOST}`
export const PORT = process.env.E2E_PORT ?? '8080'
export const ORIGIN = `http://${LAN_HOST}:${PORT}`
export const PROBE_ORIGIN = `http://${PROBE_HOST}:${PORT}`

type Cb = (...args: unknown[]) => void
const realLookup = dns.lookup.bind(dns) as unknown as (...args: unknown[]) => unknown
const patched = (hostname: string, ...rest: unknown[]): unknown => {
  if (hostname === LAN_HOST || hostname === PROBE_HOST) {
    const cb = rest[rest.length - 1] as Cb
    const options = rest.length > 1 ? rest[0] : undefined
    if (typeof options === 'object' && options !== null && (options as { all?: boolean }).all) {
      cb(null, [{ address: '127.0.0.1', family: 4 }])
    } else {
      cb(null, '127.0.0.1', 4)
    }
    return {}
  }
  return realLookup(hostname, ...rest)
}
dns.lookup = patched as unknown as typeof dns.lookup

// Playwright's APIRequestContext resolves through dns.promises.lookup(host, { all: true, family }).
const realPromisesLookup = dns.promises.lookup.bind(dns.promises) as unknown as (
  ...args: unknown[]
) => Promise<unknown>
dns.promises.lookup = (async (hostname: string, ...rest: unknown[]) => {
  if (hostname === LAN_HOST || hostname === PROBE_HOST) {
    const options = rest[0] as { all?: boolean; family?: number } | undefined
    if (options?.family === 6) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
    return options?.all
      ? [{ address: '127.0.0.1', family: 4 }]
      : { address: '127.0.0.1', family: 4 }
  }
  return realPromisesLookup(hostname, ...rest)
}) as unknown as typeof dns.promises.lookup

/** The first account the loop registers on a fresh stack. */
export const OWNER = {
  name: 'Priya Nair',
  email: 'priya@example.test',
  password: 'correct-horse-9',
}
