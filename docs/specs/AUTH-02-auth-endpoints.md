# AUTH-02 — Register, login, logout, me, change password, instance

Status: approved
Phase: 2   Team: Auth
Depends on: AUTH-01
Size: M

## Goal
The six auth/instance endpoints behave exactly as API-CONTRACT §3.1–3.2 specifies, with Argon2id password hashing that builds on alpine arm64, the first-user bootstrap, and the login/register rate limit.

## In scope
- Handlers for `auth.register`, `auth.login`, `auth.logout`, `auth.me`, `auth.changePassword`, `system.instance`.
- Argon2id hashing/verification (an implementation with prebuilt musl/arm64 binaries or WASM — proven in the image build) and a dummy verification for unknown emails to equalise timing.
- First-user bootstrap in one transaction guarded against races; per-IP limiter on login and register using `LOGIN_RATE_LIMIT`.

## Out of scope
Screens (AUTH-03). Password reset by email (does not exist). Account deletion or profile edit.

## Contract
Endpoints `auth.register`, `auth.login`, `auth.logout`, `auth.me`, `auth.changePassword`, `system.instance` (API-CONTRACT §3.1–3.2). Tables: `users`, `workspaces`, `workspace_members`, `sessions`. Env: `ALLOW_SIGNUP`, `LOGIN_RATE_LIMIT`. Registration rule (D3): the first user becomes `owner` of workspace `{name:"Default", slug:"default"}` — **joining it if it already exists with zero members** (the demo seed, RUN-11, creates it), otherwise creating it; later registrants get no workspace.

## Acceptance criteria
- [ ] First `POST /auth/register` returns `201` with `user` and `workspaces:[{slug:"default", role:"owner"}]` and a `mockbench_session` cookie; the stored hash begins `$argon2id$`.
- [ ] If an ownerless workspace `default` already exists (seeded), the first registrant becomes its `owner` and **no second** workspace is created; if `default` exists *with* members, the first registrant gets a new workspace with a suffixed slug.
- [ ] A second registration with `ALLOW_SIGNUP=true` returns `201` with `workspaces: []`; with `ALLOW_SIGNUP=false` and ≥1 user it returns `403 signup_disabled` and creates no row; with zero users and `ALLOW_SIGNUP=false` it still succeeds (`setupRequired`).
- [ ] Two simultaneous first registrations with `ALLOW_SIGNUP=false` → exactly one `201`, one `403`, exactly one `default` workspace.
- [ ] Registering `A@x.io` after `a@x.io` → `409 email_taken`, no rows added. A 7-char and a 129-char password → `422` with the offending path.
- [ ] `auth.login` with a wrong password and with an unknown email return the **identical** `401 invalid_credentials` body, and a deactivated account is also `401 invalid_credentials`. Successful login revokes the session the request arrived with, if any.
- [ ] The 11th `auth.login` or `auth.register` from one IP in a minute → `429 rate_limited` with `Retry-After`; a different `X-Forwarded-For` is unaffected (with `TRUST_PROXY=1`).
- [ ] `auth.logout` returns `204`, clears the cookie, and the session row is gone; calling it again (no cookie) returns `204`.
- [ ] `auth.me` returns the user and every workspace with the caller's `role`; without a cookie → `401`.
- [ ] `auth.changePassword` with the wrong current password → `403 wrong_password`; with the right one → `204`, the old password no longer logs in, the current session survives, and the user's other sessions are revoked.
- [ ] `system.instance` returns `allowSignup` per env and `setupRequired: true` only while zero users exist; it requires no cookie.
- [ ] The api Docker image builds on `linux/arm64` and `linux/amd64` with no compiler toolchain installed, and hashing works in the container (CI step).

## Tests
Handler tests via `testApp()` for each criterion; a concurrency test for the first-user race; a timing-equality smoke test (loose bound) for unknown email vs wrong password.

## Open questions
- Argon2 parameters (m/t/p) — placeholder `m=19 MiB, t=2, p=1` (OWASP minimum); confirm.
- Whether login limiter should also key on email (PLAN concern on shared Docker-Desktop IPs).
