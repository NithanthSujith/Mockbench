# RUN-06 — Version cache, slug index, invalidation, flush

Status: done
Phase: 3   Team: Runtime
Depends on: RUN-04, RUN-03
Size: M

## Goal
The data plane gets compiled versions from a byte-bounded in-process cache with a slug index, stampede protection and negative caching, invalidated on deploy, deletion and manual flush — so the slug → project → version path never queries the database once warm.

## In scope
- `VersionCache.get(slug)` → `{status:'unknown'|'unpublished'|'live', version?}`; slug index map; byte-bounded LRU (`MOCK_CACHE_MAX_MB`); single-flight loads; 5 s negative cache for unknown slugs.
- Registration of `hooks.onVersionDeployed`, `hooks.onProjectDeleted` (FND-10); handler for `cache.flush`.

## Out of scope
Cross-replica fan-out (RUN-12), the HTTP handler (RUN-05), project creation hook (a new slug becomes visible within the negative-cache TTL or immediately on its first deploy).

## Contract
Endpoint `cache.flush` (API-CONTRACT §3.9). Tables read on a miss only: `projects` (id, slug, active_version_id), `versions` (snapshot, baked). Env: `MOCK_CACHE_MAX_MB` (default 256). Uses `compileVersion`.

## Acceptance criteria
- [x] A cold lookup runs at most 2 queries (project, version); the next 1,000 lookups run zero (query counter).
- [x] 50 concurrent cold lookups for one slug trigger exactly one load (single-flight).
- [x] A lookup for an unknown slug runs one query; repeats within 5 s run none; after 5 s it queries again; creating a project and deploying a version for that slug makes it `live` on the next lookup (deploy invalidates the negative entry).
- [x] After `deploy.create`, the next lookup returns the new version label with no restart; after a rollback it returns the old one.
- [x] After project deletion the slug becomes `unknown` on the next lookup.
- [x] `POST /projects/:id/cache/flush` → `204` and the next lookup reloads; as viewer → `403`.
- [x] With `MOCK_CACHE_MAX_MB=1` and three 600 KB versions loaded in turn, the least recently used is evicted, resident bytes never exceed the bound by more than the newest entry, and an evicted version reloads on demand with correct content.
- [x] A single version larger than the bound is served correctly and held as the sole entry (does not thrash on every request).
- [x] A project with no active version resolves to `unpublished` without loading any version.
- [x] A failed load (DB down) is not cached and surfaces as a 503 mock error to the caller, recovering when the DB returns.

## Implementation notes (RUN-06)
Code: `apps/api/src/modules/dataplane/version-cache.ts`; tests `version-cache.test.ts` (11). The versions module `init` creates one cache per app (keyed by the `Hooks` object, `versionCacheOf(hooks)`) and subscribes it to both hooks; `cache.flush` is bound in the versions module. RUN-05 gets the cache via `versionCacheOf(hooks)` (app.ts passes only a logger to the router today). `get` throws `VersionLoadError` on a failed load or `CompileError` (RUN-05 maps it to 503). Any deploy also clears all negative entries. Loads that straddle an invalidation return their result but do not store it. Byte accounting uses `CompiledVersion.bytes` (RUN-04 estimate), so the 600 KB criterion is tested with ~200K-char bodies (about 400 KB resident each).

## Tests
Query-counter and fake-timer tests; concurrency test; LRU bound test using synthetic snapshots.

## Open questions
- Whether resident-byte accounting should include the compiled tree overhead (assumed: baked bytes + 2× snapshot bytes estimate).
