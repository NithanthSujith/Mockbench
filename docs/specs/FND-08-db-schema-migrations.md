# FND-08 — Database schema and migrations (frozen)

Status: done
Phase: 1   Team: Core
Depends on: FND-01
Size: L

## Goal
The complete PostgreSQL 16 schema — eleven tables with keys, indexes, constraints, triggers and the UUID v7 default — exists as a Drizzle schema plus checked-in SQL migrations that apply from an empty database, and is proven by constraint tests against a real Postgres.

## In scope
- Drizzle table definitions in `apps/api/src/db/schema.ts` and migrations in `apps/api/src/db/migrations/` (generated for tables, hand-written SQL for the extensions, the `uuid_v7()` function, generated column and triggers).
- Constraint/trigger tests and a drift test (Drizzle schema ≙ migrated database).

## Out of scope
The DB client, migrator and test harness (FND-09). Any query code, seed data (RUN-11).

## Contract
Extensions: `citext`. Function `uuid_v7()` (plpgsql, time-ordered, version nibble 7) used as every `id` default. Enums: `workspace_role('owner','editor','viewer')`. All `created_at`/`updated_at` are `timestamptz not null default now()` where listed; `updated_at` is maintained by a shared `set_updated_at()` trigger. Cascade rules in brackets.

| Table | Columns (beyond `id uuid pk default uuid_v7()`) | Keys, indexes, constraints |
| --- | --- | --- |
| `users` | `email citext not null`, `password_hash text not null`, `name text not null`, `is_active bool not null default true`, `created_at`, `updated_at` | unique `email` |
| `sessions` | `user_id` → users [cascade], `token_hash text not null`, `expires_at timestamptz not null`, `last_used_at timestamptz not null default now()`, `user_agent text`, `ip text`, `created_at` | unique `token_hash`; index `(user_id)`; index `(expires_at)` |
| `workspaces` | `name text not null`, `slug text not null`, `created_at`, `updated_at` | unique `slug`; check slug pattern + length 2–40 |
| `workspace_members` | `workspace_id` → workspaces [cascade], `user_id` → users [cascade], `role workspace_role not null`, `created_at`, `updated_at` | unique `(workspace_id, user_id)`; index `(user_id)` |
| `projects` | `workspace_id` → workspaces [**restrict**], `name`, `slug text not null`, `description text`, `settings jsonb not null default '{}'`, `components jsonb not null default '{}'`, `version_seq int not null default 0`, `active_version_id uuid` → versions [set null], `created_at`, `updated_at` | unique `slug`; check slug pattern `^[a-z0-9]+(-[a-z0-9]+)*$` and length 3–40; index `(workspace_id, created_at, id)` |
| `routes` | `project_id` → projects [cascade], `method text not null`, `path text not null`, `normalized_path text generated always as (…) stored`, `description text`, `sort_order int not null default 0`, `created_at`, `updated_at` | check `method in ('GET','POST','PUT','PATCH','DELETE')`; unique `(project_id, method, normalized_path)`; index `(project_id, sort_order)`. `normalized_path` = `lower(regexp_replace(path, ':[A-Za-z_][A-Za-z0-9_]*', '{}', 'g'))` |
| `response_cases` | `route_id` → routes [cascade], `name text not null`, `status_code int not null`, `schema jsonb not null`, `headers jsonb not null default '{}'`, `delay_ms int`, `is_default bool not null default false`, `sort_order int not null default 0`, `created_at`, `updated_at` | check status in the 14-code list; check `delay_ms is null or between 0 and 10000`; **unique `(route_id, lower(name))`**; **partial unique `(route_id) where is_default`**; index `(route_id, sort_order)` |
| `data_presets` | `project_id` → projects [cascade], `name`, `rules jsonb not null default '[]'`, `is_enabled bool not null default true`, `priority int not null default 0`, `created_at`, `updated_at` | index `(project_id)` |
| `versions` | `project_id` → projects [cascade], `seq int not null`, `label text not null`, `notes text`, `snapshot jsonb not null`, `baked text`, `route_count int not null`, `case_count int not null`, `snapshot_bytes int not null`, `baked_bytes int not null default 0`, `created_by` → users [set null], `created_at` (**no `updated_at`**) | unique `(project_id, seq)`; unique `(project_id, label)`; index `(project_id, created_at desc)`; **trigger raising on any `UPDATE`** |
| `deployments` | `project_id` → projects [cascade], `version_id` → versions [set null], `version_label text not null`, `deployed_by` → users [set null], `created_at` (**no `updated_at`**) | index `(project_id, created_at desc, id desc)` |
| `request_logs` | `project_id` → projects [cascade], `version_id` → versions [**restrict**], `method text not null`, `path text not null`, `matched_route_id uuid`, `matched_case_id uuid` (plain, **no FK**), `route_pattern text`, `case_name text`, `status_code int not null`, `duration_ms int not null`, `mock_error text`, `request_headers jsonb not null default '{}'`, `query jsonb not null default '{}'`, `ip text`, `created_at` (**no `updated_at`**) | index `(project_id, created_at desc, id desc)` |

**Implementation notes (FND-08, recorded where the spec was silent or self-contradictory):**
- Migration layout: `0000_extensions_and_functions` (hand-written: `citext`, `uuid_v7()`, `set_updated_at()`, `versions_reject_update()`), `0001_tables` (generated by drizzle-kit from `schema.ts`), `0002_triggers` (hand-written). Applied at runtime only by drizzle-orm's programmatic migrator.
- **Clarification of the versions trigger.** `versions.created_by` is `ON DELETE SET NULL`, and PostgreSQL executes that referential action as an `UPDATE` of `versions`, which a trigger rejecting *every* update would block - deleting any user who ever published would fail. The trigger therefore rejects every `UPDATE` except the single change `created_by: <uuid> -> NULL` with all other columns identical. Any other change raises `restrict_violation` (SQLSTATE `23001`), for every role including a superuser.
- `set_updated_at()` uses `clock_timestamp()` (not `now()`) so repeated updates inside one transaction still advance `updated_at`.
- `uuid_v7()` is time-ordered at millisecond resolution; values within the same millisecond are random (not monotonic), which matches "generated 2 ms apart sort ascending".
- `pnpm db:generate` is drizzle-kit (dev time); `pnpm db:migrate` runs `drizzle-kit migrate` for developers only until FND-09 ships the runtime migrator.
- The drift test compares tables, columns (type, nullability, default, generated), indexes (unique/partial), check-constraint names and foreign keys (columns, target, delete action). Check-constraint *bodies* are covered by the behavioural tests, not the drift comparison.

`baked` holds a JSON object `{ "<routeId>:<caseId>": "<body string>" }` serialised as text; it is null for `random`-mode versions. Decisions D7/D10 are encoded here.

## Acceptance criteria
- [x] `drizzle-orm`'s migrator applies all migrations to an empty `postgres:16` database; running it a second time is a no-op.
- [x] A drift test fails when the Drizzle schema and the migrated database disagree (introspection compare), including indexes and check constraints.
- [x] Inserting a second `is_default = true` case in the same route fails with unique violation `23505`; two cases `Not found` and `NOT FOUND` in one route fail the same way; the same names in different routes succeed.
- [x] Inserting a case with `status_code = 418` fails the check constraint; `delay_ms = 10001` fails; `delay_ms = NULL` and `0` succeed.
- [x] Inserting route `/Users/:id/orders/:oid` stores `normalized_path = '/users/{}/orders/{}'`; a second `GET /users/:userId/orders/:x` in the same project fails `23505`; the same path with method `POST` succeeds; the same path in another project succeeds.
- [x] `UPDATE versions SET label = 'x'` raises an exception whatever the role; `DELETE` of an inactive, unreferenced version succeeds.
- [x] Deleting a version that `projects.active_version_id` references sets it to NULL; deleting one that a `request_logs` row references fails `23503`; deleting one referenced only by `deployments` succeeds and sets `deployments.version_id` NULL while `version_label` remains.
- [x] Deleting a project cascades to routes, cases, presets, versions, deployments, request_logs; deleting a workspace that has projects fails `23503`.
- [x] Deleting a route succeeds when a `request_logs` row holds its id in `matched_route_id`.
- [x] `users.email` uniqueness is case-insensitive (`A@x.io` conflicts with `a@x.io`); project slug `Api`, `ab`, `a--b` are rejected by check; `a-b` accepted.
- [x] `uuid_v7()` values generated 2 ms apart sort ascending as text and have version nibble `7`.
- [x] `set_updated_at()` advances `updated_at` on UPDATE for tables that have it.

## Tests
One Vitest file per table under `apps/api/src/db/__tests__/`, using the FND-09 harness against real Postgres.

## Open questions
- Whether `sessions.ip` should be `inet` rather than `text` (text assumed: proxies can yield odd values).
- Whether to add a DB-level reserved-slug check (assumed no: the list is an app/contract concern).
- Whether at-least-one-case-per-route needs a deferred constraint trigger (assumed enforced in app, since `routes.create` makes the first case in the same transaction and `case_is_default` blocks removing the last).
