# AUTH-01 — Session core and middleware

Status: done
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
- [x] `issue()` stores only the HMAC of the token: a search of the `sessions` table for the raw token returns nothing; the returned token is 32 bytes base64url.
- [x] A request with a valid cookie sets `req.auth`; a request whose session has `expires_at` in the past gets `401 unauthenticated` **and** a `Set-Cookie` with `Max-Age=0`; the same for a revoked row and a token that was never issued.
- [x] A session belonging to a user with `is_active = false` gets `401`.
- [x] A request at 61 minutes after the last touch extends `expires_at` by the TTL and re-sends the cookie; a request at 59 minutes does not write to the database (query counter).
- [x] With `COOKIE_SECURE=false` the cookie has `HttpOnly; SameSite=Lax; Path=/`, no `Secure`, no `Domain`; with `true` it adds `Secure`. `Max-Age` equals `SESSION_TTL_DAYS` in seconds.
- [x] `revokeOthers(userId, keep)` deletes every session of that user except `keep`, and none of another user's.
- [x] `sweepExpired()` deletes only rows with `expires_at < now()`; it is scheduled once at startup and every hour, and is cleared on shutdown (no open handle keeps the process alive).
- [x] The seeded signature is unchanged: a compile-time test asserts `req.auth` is `{ userId: string; sessionId: string }`.

## Implementation notes (AUTH-01)
- Files: `modules/auth/{sessions,cookies,session-middleware}.ts` plus tests. `createSessionService({db, config, now?})` exposes `issue(userId, req)`, `revoke`, `revokeOthers`, `touch`, `sweepExpired`; `startSessionSweeper({service, logger?, intervalMs?})` runs once at start and then hourly with an unref'd timer and returns a stop function.
- `createSessionAuth` keeps its FND-10 call shape (`{ db, config }`); `config` now also needs `sessionTtlDays` (the app already passes the full config) and an optional `now` clock is accepted for tests. It also returns `service` and `resolveSession`.
- A cookie that does not resolve is cleared by the OPTIONAL step, on every endpoint (including public ones such as login), exactly once. A later handler that sets a new cookie must use `res.append` (the cookie helpers do), so the new `Set-Cookie` follows the clearing one and wins. `requireSession` no longer re-resolves a cookie the optional step already rejected (that cleared it twice).
- Touch: a session idle for one hour or more is refreshed by a single guarded UPDATE (`last_used_at <= now - 1h`), so of several concurrent requests exactly one extends the session and re-sends the cookie. Within the hour a request does no write.
- **Wiring requested from the main session (server.ts is a shared file):** after `createApp`, `const stopSweeper = startSessionSweeper({ service: createSessionService({ db: handle.db, config }), logger })`, and call `stopSweeper()` in the shutdown path before the pool closes (for example `closeDb: async () => { stopSweeper(); await handle.close() }`). Imports come from `./modules/auth/sessions`.

## Tests
Service tests against the FND-09 harness with a controllable clock; middleware tests through `testApp()`.

## Open questions
- Whether to cap concurrent sessions per user (assumed no).
