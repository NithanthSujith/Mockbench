# 0007 — No Redis
Status: accepted      Date: 2026-11-05

## Context
The data plane needs the live version in memory. With one api container nothing else is needed; with several replicas, cache invalidation must fan out.

## Decision
No Redis, no extra container. A single api process holds the cache. For replicas, publish a Postgres `NOTIFY` on deploy and have each replica `LISTEN` and drop its entry (RUN-12, optional).

## Consequences
- Fewer moving parts for a self-hosted tool; "one stateful volume" stays true.
- Multi-replica fan-out is possible but not required for v1.

## Revisit if
The operator already runs Redis and wants it, or fan-out needs exceed what `LISTEN`/`NOTIFY` can carry.
