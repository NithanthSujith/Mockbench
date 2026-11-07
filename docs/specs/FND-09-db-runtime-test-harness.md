# FND-09 — DB runtime: client, migrator behind an advisory lock, test harness

Status: approved
Phase: 1   Team: Core
Depends on: FND-08
Size: S

## Goal
The api can open a Drizzle/pg connection pool, apply migrations safely when several containers start at once, and every later test can get a fresh, isolated, real Postgres database in one call.

## In scope
- `createDb(url)` (pool + Drizzle), graceful close.
- `runMigrations(db)` using `drizzle-orm`'s programmatic migrator inside a session-level `pg_advisory_lock`, with connection retry for container start-up; a `bin/migrate` entry the Docker entrypoint will call.
- Vitest helper `withTestDb()` and a global setup that provisions a template database.

## Out of scope
The Docker entrypoint script (FND-14), query code, factories (FND-11).

## Contract
```ts
createDb(url: string): { db: Db; pool: Pool; close(): Promise<void> }
runMigrations(db: Db, opts?: { lockId?: bigint; retryMs?: number; timeoutMs?: number }): Promise<{ applied: number }>
withTestDb(): Promise<{ db: Db; url: string; drop(): Promise<void> }>     // env TEST_DATABASE_URL (default postgres://mock:mock@127.0.0.1:55432/postgres); NO testcontainers dependency
```
`bin/migrate`: exit 0 on success, non-zero with a one-line message on failure; honours `DATABASE_URL`. Lock id is a fixed constant documented in code.

## Acceptance criteria
- [ ] Two `runMigrations` calls started concurrently against one empty database both resolve, and the migrations table contains exactly one row per migration.
- [ ] If the process holding the lock is killed mid-migration, a new `runMigrations` acquires the lock within 5 s (session-level lock released on disconnect) and completes.
- [ ] `runMigrations` against an unreachable host retries for `timeoutMs` (default 30 s) and then rejects with an error whose message names the host, rather than hanging or exiting 0.
- [ ] `bin/migrate` with a bad `DATABASE_URL` exits non-zero in under `timeoutMs + 2 s`; with a good one exits 0 and prints the number applied.
- [ ] The runtime dependency list of `apps/api` contains no `drizzle-kit` (dev only), asserted by a test over `package.json`.
- [ ] If Postgres is unreachable, `withTestDb()` rejects with a message that names the URL and the exact `docker run` command to start a matching container (never a downstream `undefined` error), and `drop()` is safe to call on a failed setup.
- [ ] Two parallel test files each calling `withTestDb()` see isolated data (a row inserted in one is invisible in the other).

## Tests
Concurrency test (two migrators), kill test (child process), unreachable-host test, harness isolation test.

## Open questions
- Resolved 2026-11-07: no testcontainers. Local runs use a plain `postgres:16-alpine` container on 55432 (documented in the error message); CI uses a service container (ci.yml sets `TEST_DATABASE_URL`).
