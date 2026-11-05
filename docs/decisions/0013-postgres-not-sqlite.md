# 0013 — PostgreSQL, not SQLite
Status: accepted      Date: 2026-11-05

## Context
SQLite promises a single-binary story but gives up `jsonb` operators, real concurrent writes (editor plus request logging) and `LISTEN`/`NOTIFY`.

## Decision
PostgreSQL 16 in its own container; `pgdata` is the one named volume.

## Consequences
- `jsonb`, partial unique indexes, generated columns, advisory locks (migrations) and `NOTIFY` (optional fan-out) are all available.
- `docker compose up` runs a second container.

## Revisit if
A genuine single-file distribution becomes a goal and the above features are no longer needed.
