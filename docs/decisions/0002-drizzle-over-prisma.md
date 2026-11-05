# 0002 — Drizzle over Prisma
Status: accepted      Date: 2026-11-05

## Context
We need typed Postgres access with `jsonb`, partial unique indexes, a generated column and triggers, shipped in a small image.

## Decision
Drizzle ORM with checked-in SQL migrations. Hand-written SQL migrations are allowed (and expected) for triggers and generated columns. Migrations at runtime use `drizzle-orm`'s programmatic migrator, not the `drizzle-kit` CLI, so the runtime image needs no dev dependencies.

## Consequences
- SQL-shaped queries, tiny runtime, no generated client in the build, lighter image.
- Triggers and partial indexes are not captured by `drizzle-kit generate`; FND-08 includes a drift test.
- Weaker DX than Prisma for contributors who know Prisma.

## Revisit if
Contributors consistently trip on Drizzle and a heavier image becomes acceptable.
