// A `401 unauthenticated` anywhere means the session ended. The app registers ONE handler that
// sends the user to /login; this module guarantees it fires once per expiry, not once per request
// (a screen often has several requests in flight), and never loops.
let handler: (() => void) | undefined
let fired = false

/** Registers the single handler (the app router does this). Returns an unregister function. */
export function setUnauthenticatedHandler(fn: (() => void) | undefined): () => void {
  handler = fn
  fired = false
  return () => {
    if (handler === fn) handler = undefined
  }
}

/** Called by the client for a 401 with code `unauthenticated`. Fires the handler at most once until reset. */
export function notifyUnauthenticated(): void {
  if (fired || !handler) return
  fired = true
  handler()
}

/** Re-arms the notifier (called once the user is on /login, or signed in again). */
export function resetUnauthenticated(): void {
  fired = false
}
