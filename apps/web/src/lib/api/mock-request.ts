// The one browser call to the data plane (/mock/:slug/*), used by the Try-it panel. It lives here
// because this folder is the only place the web app may call fetch. The URL is relative, so it goes
// to whatever origin the app was loaded from (LAN requirement).

export type MockResponse = {
  status: number
  /** Only the `X-Mock-*` headers, names in their canonical form. */
  mockHeaders: [string, string][]
  body: string
  /** Wall-clock milliseconds from sending to the body being read. */
  ms: number
  /** True when the mock server itself answered with an error (`X-Mock-Error: true`). */
  isMockError: boolean
}

/** fetch lowercases header names; show them the way the server sends them. */
const canonicalHeader = (name: string) =>
  name.replace(/(^|-)([a-z])/g, (_, dash: string, c: string) => dash + c.toUpperCase())

export async function sendMockRequest(
  path: string,
  method: string,
  headers: Record<string, string>,
): Promise<MockResponse> {
  const started = performance.now()
  const res = await fetch(path, { method, headers, cache: 'no-store' })
  const body = method === 'HEAD' ? '' : await res.text()
  const ms = Math.round(performance.now() - started)
  const mockHeaders: [string, string][] = []
  res.headers.forEach((value, name) => {
    if (name.toLowerCase().startsWith('x-mock-')) mockHeaders.push([canonicalHeader(name), value])
  })
  return {
    status: res.status,
    mockHeaders,
    body,
    ms,
    isMockError: res.headers.get('x-mock-error') === 'true',
  }
}
