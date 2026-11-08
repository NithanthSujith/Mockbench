// Session tokens are opaque random values; only an HMAC-SHA-256 of the token, keyed by
// SESSION_SECRET (D8), is stored in `sessions.token_hash`. Shared by the session middleware (read
// path), AUTH-01 (issuing) and FND-11's test-session helper, so they can never disagree.
import { createHmac } from 'node:crypto'

/** Hex HMAC-SHA-256 of `token` keyed by `secret`. Deterministic per secret; differs across secrets. */
export function hashSessionToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex')
}

/** `hashSessionToken` bound to one secret. */
export function createTokenHasher(secret: string): (token: string) => string {
  return (token) => hashSessionToken(token, secret)
}
