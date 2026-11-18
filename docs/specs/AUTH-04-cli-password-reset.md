# AUTH-04 — CLI password reset

Status: in review
Phase: 5   Team: Auth (+ main session for the build entry)
Depends on: AUTH-02, FND-14
Size: S

## Goal
An operator with shell access to the host can reset any user's password without the UI. This is the only recovery path when the only owner forgets their password. There is no email reset (ADR 0020).

## In scope
- `apps/api/src/modules/auth/reset-password.ts`: `resetPassword(db, { email, password })` sets the Argon2id hash (same parameters as AUTH-02) and deletes **every** session of that user, in one transaction. The email lookup is case-insensitive (`citext`). It does not change `is_active`.
- `apps/api/src/bin/reset-password.ts`: the CLI entry, shaped like `bin/migrate.ts` (`main(env, argv, stdin)` returns `{ code, stdout, stderr }`; a thin entry guard calls it).
  - `reset-password <email>` generates a random 20-character password (`node:crypto`, alphabet without look-alikes), sets it and prints it **once** on stdout as `reset-password: new password for <email>: <password>`.
  - `reset-password <email> --password-stdin` reads the password from stdin instead and prints no password.
  - Exit 0 on success. Exit 1 with one line `reset-password: failed: <reason>` for an unknown email, a password outside 8–128 characters, or a database error. Exit 2 for usage errors or a missing `DATABASE_URL`.
- Main session: add the entry to `apps/api/build.mjs` so the image has `dist/reset-password.js`.
- Docs: `docs/site/backup-and-restore.md` (replace the "does not exist" paragraph) and the README's operations section:
  `docker compose exec api node dist/reset-password.js you@example.com`.

## Out of scope
Email resets, a UI for admins to reset other users, unlocking rate limits, creating users from the CLI.

## Contract
No HTTP or schema change. New image entry `dist/reset-password.js`. Reuses `users`, `sessions` and the AUTH-02 password rules (8–128 characters).

## Acceptance criteria
- [x] `reset-password a@x.io` against a user `A@x.io` exits 0, prints a 20-character password once, and that password logs in through `auth.login`. The old password gets `401 invalid_credentials`.
- [x] Every existing session of the user is gone afterwards (a request with an old cookie gets `401`). Other users' sessions survive.
- [x] `--password-stdin` sets the piped password and prints no password.
- [x] Unknown email: exit 1, `reset-password: failed: no user with that email`, no rows changed. A 7-character stdin password: exit 1, nothing changed.
- [x] No arguments, or no `DATABASE_URL`: exit 2 with a usage line.
- [x] In the built api image, `docker compose exec api node dist/reset-password.js <email>` works as the non-root `node` user (lan-smoke or readme-smoke step).
- [x] REL-01's password-reset criterion is ticked.

## Tests
Unit tests for `resetPassword` with the DB test harness (FND-09); `main()` tests for every exit path; one compose smoke step.

## Implementation notes
- Tests: `apps/api/src/bin/__tests__/reset-password.test.ts` (12 cases, every exit path, through `main()` against the FND-09 test database). The container criterion is a step at the end of `scripts/readme-smoke.sh` (it checks the container user is `node`, both modes, the old session gets 401 and the new passwords log in); it passed locally against freshly built images.
- The password rule is the contract's `PasswordField` (8–128), not a copy.
- The hash is computed before the transaction opens, so no row lock is held during Argon2id.
- One trailing newline on stdin is stripped (`echo` and heredocs add one); anything else is part of the password.
- `--password-stdin` prints `reset-password: password set for <email>; all sessions signed out`.

## Open questions
- Whether a deactivated user should be reactivated by a reset. Assumed no (deactivation is a separate act); a test pins it.
