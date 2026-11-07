# FND-09 — DB runtime: client, migrator behind an advisory lock, test harness

Status: done
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

### As built (clarifications recorded by the implementation; none changes the contract above)
- **Files:** `src/db/client.ts` (`createDb`, `Db`), `src/db/migrate.ts` (`runMigrations`, `MIGRATION_LOCK_ID = 0x4d4f434b42454e43n`, `defaultMigrationsFolder`), `src/bin/migrate.ts`, `src/db/testing.ts` (`withTestDb`), `src/db/vitest-global-setup.ts`, `apps/api/vitest.config.ts`.
- **One dedicated connection:** `runMigrations` takes only the connection *config* from `db`; it opens its own `pg.Client` and runs the lock, the drizzle migrator and the bookkeeping on that single connection, so killing the process releases the lock at once. It also sets `client_connection_check_interval = 1000` (best effort; Linux servers) so Postgres notices a dead client even *during* a long statement. Without it a killed process holding a 60 s `pg_sleep` migration would keep the lock until the statement ended.
- **Additive options:** `runMigrations` also accepts `lockTimeoutMs` (wait for another migrator; default 300 000 ms; `timeoutMs` covers only connecting) and `migrationsFolder`. The lock is acquired by polling `pg_try_advisory_lock` every `retryMs` (default 500 ms).
- **`bin/migrate` env:** `DATABASE_URL` (required), `MIGRATE_TIMEOUT_MS` (connect budget, default 30 000), `MIGRATIONS_DIR` (override, needed when bundled). Exit codes: 0 success, 1 failure, 2 misconfiguration. Output `migrate: applied N migration(s)` / `migrate: failed: <reason>`. `main(env)` takes its environment as a parameter; FND-10 may route it through `config.ts`.
- **`withTestDb` options:** `{ migrate?, adminUrl?, connectTimeoutMs? }`; returns `{ name, url, db, pool, drop }`. The global setup migrates one template database per run (`MB_TEST_TEMPLATE_DB`) so each call is a template copy (retrying on 55006); with no Postgres it stays silent and each test that needs one fails with the actionable message. The error redacts the password.
- **"drop() is safe on a failed setup" means:** a failed `withTestDb()` drops any database it already created before rejecting, `drop()` is idempotent, and test files use `afterAll(() => t?.drop())` — the missing `?.` is what produced the unhelpful "reading 'drop'" error in the first CI run.
- **Child-process tests** run the TypeScript sources with Node's built-in type stripping (`--experimental-strip-types`) plus a test-only resolver hook (`__tests__/fixtures/`), so no TS runner dependency is needed. Consequence: `client.ts`, `migrate.ts` and `bin/migrate.ts` (and what they import) must stay *erasable* TypeScript (no enums, namespaces or parameter properties). On Windows `--import` needs a `file://` URL.
- The FND-08 test helper now only adds row factories/SQLSTATE helpers on top of `withTestDb` (`testDb()`); FND-11 will supersede the factories.

## Acceptance criteria
- [x] Two `runMigrations` calls started concurrently against one empty database both resolve, and the migrations table contains exactly one row per migration.
- [x] If the process holding the lock is killed mid-migration, a new `runMigrations` acquires the lock within 5 s (session-level lock released on disconnect) and completes.
- [x] `runMigrations` against an unreachable host retries for `timeoutMs` (default 30 s) and then rejects with an error whose message names the host, rather than hanging or exiting 0.
- [x] `bin/migrate` with a bad `DATABASE_URL` exits non-zero in under `timeoutMs + 2 s`; with a good one exits 0 and prints the number applied.
- [x] The runtime dependency list of `apps/api` contains no `drizzle-kit` (dev only), asserted by a test over `package.json`.
- [x] If Postgres is unreachable, `withTestDb()` rejects with a message that names the URL and the exact `docker run` command to start a matching container (never a downstream `undefined` error), and `drop()` is safe to call on a failed setup.
- [x] Two parallel test files each calling `withTestDb()` see isolated data (a row inserted in one is invisible in the other).

## Tests
Concurrency test (two migrators), kill test (child process), unreachable-host test, harness isolation test.

## Open questions
- `pnpm db:migrate` is still `drizzle-kit migrate` (dev only). Running `bin/migrate` from source needs a TS runner or a build step; the production path is the compiled output (FND-10/FND-14 build). Needs a decision when FND-14 designs the image build.
- Resolved 2026-11-07: no testcontainers. Local runs use a plain `postgres:16-alpine` container on 55432 (documented in the error message); CI uses a service container (ci.yml sets `TEST_DATABASE_URL`).
