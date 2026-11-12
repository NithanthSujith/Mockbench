import type { ResponseCase, Route } from '@mockbench/api-contract'
import { getMockBaseUrl } from '../../lib/mock-url'

/** Sample values for path params, matching the prototype: `:id` is 42, anything else 7. */
export function samplePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => (name === 'id' ? '42' : '7'))
}

/**
 * The value of the `X-Mock-Case` header: the case name, or the case id when the name cannot be
 * put inside a single-quoted shell string or an HTTP header (non-printable-ASCII or `'`).
 */
export function caseSelector(c: Pick<ResponseCase, 'id' | 'name'>): string {
  const name = c.name.trim()
  return name !== '' && /^[\x20-\x7e]+$/.test(name) && !name.includes("'") ? name : c.id
}

/** The header Send and the curl both use, or null for the default case. */
export function caseHeader(c: Pick<ResponseCase, 'id' | 'name' | 'isDefault'>): string | null {
  return c.isDefault ? null : caseSelector(c)
}

/** Path part after the origin, e.g. `/mock/shop-api/products/42`. */
export function mockRequestPath(slug: string, route: Pick<Route, 'path'>): string {
  return `/mock/${slug}${samplePath(route.path)}`
}

/** The exact curl command for this route and case, addressed at the host the browser reached. */
export function buildCurl(
  slug: string,
  route: Pick<Route, 'method' | 'path'>,
  c: Pick<ResponseCase, 'id' | 'name' | 'isDefault'>,
): string {
  const lines = [`curl -i ${getMockBaseUrl(slug)}${samplePath(route.path)}`]
  if (route.method !== 'GET') lines.push(`-X ${route.method}`)
  const header = caseHeader(c)
  if (header !== null) lines.push(`-H 'X-Mock-Case: ${header}'`)
  return lines.join(' \\\n  ')
}
