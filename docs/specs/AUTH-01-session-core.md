# AUTH-01 — Session core and middleware

Status: approved
Phase: 2   Team: Auth
Depends on: FND-11
Size: M

## Goal
Sessions have a complete lifecycle — issue, resolve with sliding expiry, revoke one or all-but-current, sweep expired — and `requireSession` is hardened, so every authenticated endpoint rests on one correct implementation.

## In scope
- `sessionService`: `issue(userId, req) → { token, expiresAt }`, `revoke(sessionId)`, `revokeOthers(userId, keepSessionId)`, `touch` (extend `expires_at` and refresh the cookie at most once per hour), `sweepExpired()` run on an interval inside the api.
- Cookie helpers implementing API-CONTRACT §1.6 (`setSessionCookie`, `clearSessionCookie`) honouring `COOKIE_SECURE` and `SESSION_TTL_DAYS`.
- Harden `modules/auth/session-middleware.ts` (keeping the seeded signature `req.auth = { userId, sessionId }`): reject deactivated users, clear the cookie on any invalid/expired/revoked token.

## Out of scope
Register/login/logout/me endpoints and password hashing (AUTH-02). Screens (AUTH-03). Rate limiting.

## Contract
- Consumes: `sessions`, `users` tables; `hashSessionToken` (FND-11); env `SESSION_TTL_DAYS`, `COOKIE_SECURE`, `SESSION_SECRET`.
- Exports (module-internal to `modules/auth`, used by AUTH-02): `sessionService`, cookie helpers. Other modules use only `req.auth`.
- Cookie: exactly as API-CONTRACT §1.6.

## Acceptance criteria
- [ ] `issue()` stores only the HMAC of the token: a search of the `sessions` table for the raw token returns nothing; the returned token is 32 bytes base64url.
- [ ] A request with a valid cookie sets `req.auth`; a request whose session has `expires_at` in the past gets `401 unauthenticated` **and** a `Set-Cookie` with `Max-Age=0`; the same for a revoked row and a token that was never issued.
- [ ] A session belonging to a user with `is_active = false` gets `401`.
- [ ] A request at 61 minutes after the last touch extends `expires_at` by the TTL and re-sends the cookie; a request at 59 minutes does not write to the database (query counter).
- [ ] With `COOKIE_SECURE=false` the cookie has `HttpOnly; SameSite=Lax; Path=/`, no `Secure`, no `Domain`; with `true` it adds `Secure`. `Max-Age` equals `SESSION_TTL_DAYS` in seconds.
- [ ] `revokeOthers(userId, keep)` deletes every session of that user except `keep`, and none of another user's.
- [ ] `sweepExpired()` deletes only rows with `expires_at < now()`; it is scheduled once at startup and every hour, and is cleared on shutdown (no open handle keeps the process alive).
- [ ] The seeded signature is unchanged: a compile-time test asserts `req.auth` is `{ userId: string; sessionId: string }`.

## Tests
Service tests against the FND-09 harness with a controllable clock; middleware tests through `testApp()`.

## Open questions
- Whether to cap concurrent sessions per user (assumed no).
