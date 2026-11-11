# RUN-03 — Deploy, rollback and deployment history API

Status: done
Phase: 2   Team: Runtime
Depends on: RUN-02
Size: S

## Goal
A version can be made live — or rolled back to — with one call, recorded in a history, and announced to the data-plane cache.

## In scope
Handlers for `deploy.create` and `deployments.list`; the single transaction (set `active_version_id`, insert `deployments` row with the label and actor); the post-commit `onVersionDeployed(projectId)` hook (FND-10) invocation.

## Out of scope
The cache itself (RUN-06), notifying other replicas (RUN-12), screens (RUN-09), "undeploy".

## Contract
Endpoints per API-CONTRACT §3.9 (`deploy.create`, `deployments.list`). Tables: `projects.active_version_id`, `versions`, `deployments`. Hook: `hooks.onVersionDeployed(projectId)` (no-op until RUN-06 registers).

## Acceptance criteria
- [x] `POST /deploy {versionId}` → `200 Deployment` with `versionLabel`, `deployedBy`; `projects.active_version_id` now equals `versionId`; one `deployments` row exists.
- [x] Deploying an older version (rollback) works with the same call and appends another row; the history shows both in newest-first order.
- [x] Deploying the already-active version → `200` with the latest existing deployment and **no** new row.
- [x] A `versionId` from another project, or random → `404 version_not_found`; no state changes.
- [x] The hook runs exactly once per state-changing deploy, **after** commit (a hook that reads the DB sees the new `active_version_id`), and not for the no-op case; a throwing hook does not fail the request or undo the deploy (logged).
- [x] Viewer → `403`; non-member → `404`.
- [x] After a version is later deleted, its `deployments` rows remain with `versionId: null` and `versionLabel` intact in `deployments.list`.
- [x] `deployments.list` paginates newest-first with `limit` and `nextCursor`.
- [x] Two simultaneous deploys of different versions end with exactly one active version and two history rows (last committed wins; no error).

## Tests
Role matrix; transaction + hook-ordering tests; pagination; concurrency test.

## Open questions
- Whether a deploy should be refused for a version whose `baked` is null in a project now configured differently (not applicable: settings are frozen in the snapshot, D7).
