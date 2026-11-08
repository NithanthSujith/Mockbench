// The ONLY place a mock URL is built. It is derived from window.location at runtime, never from a
// build-time constant, so someone who opened the app at http://192.168.1.24:8080 sees that address
// in every curl snippet and base-URL display (LAN requirement; CLAUDE.md).

/** `http://<host:port the browser reached the app on>/mock/<slug>` */
export function getMockBaseUrl(slug: string): string {
  return `${window.location.origin}/mock/${slug}`
}

/** `<host:port the browser reached the app on>`, e.g. `192.168.1.24:8080`. */
export function getMockHost(): string {
  return window.location.host
}
