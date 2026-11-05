# RUN-12 — Postgres LISTEN/NOTIFY cache fan-out (optional)

Status: approved
Phase: 4   Team: Runtime
Depends on: RUN-06
Size: S

## Goal
With several api replicas, a deploy, deletion or flush on one instance evicts the cached entry on all of them within a second — with no Redis. **Optional: skip entirely if v1 is single-instance (PLAN D13).**

## In scope
- A dedicated (non-pool) connection that `LISTEN`s on channel `mockbench_cache`, with reconnect + full-cache flush on reconnect.
- `NOTIFY` after commit on deploy, project deletion and manual flush, payload `{projectId, slug}`.

## Out of scope
Any other cross-replica concern (rate limits and logs are per instance).

## Contract
Channel `mockbench_cache`; JSON payload ≤ 1 KB; plugs into the RUN-06 invalidation functions; started/stopped with the app lifecycle.

## Acceptance criteria
- [ ] Two app instances against one database: deploying on A makes B return the new version label on its next lookup within 1 s, with no flush call.
- [ ] Deleting a project on A makes B's slug `unknown` within 1 s; a manual flush on A flushes B's entry for that project only.
- [ ] Killing the listener connection (`pg_terminate_backend`) results in a reconnect within 5 s and a full flush of the local cache, so no stale entry survives the gap.
- [ ] A malformed notification payload is ignored and logged once.
- [ ] A single-instance run behaves identically with the feature enabled (the instance receiving its own notification does a harmless second eviction).
- [ ] Shutdown closes the listener and exits within 10 s.
- [ ] With the feature disabled by config, no extra connection is opened.

## Tests
Two-instance integration test; connection-kill test.

## Open questions
- Whether to enable by default (assumed on; disabling flag `CACHE_FANOUT=false`).
