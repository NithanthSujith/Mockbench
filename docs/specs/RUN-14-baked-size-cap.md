# RUN-14 — Total baked-size cap per version

Status: done
Phase: 4   Team: Runtime (+ main session for the contract)
Depends on: RUN-01, RUN-02, RUN-09
Size: S

## Goal
Publishing a deterministic project whose baked responses add up to more than 64 MiB fails cleanly with `422 baked_too_large`. It names the cases to shrink, instead of storing a version that every api process must hold in memory. Rulings: ADR 0017 (cap and name) and ADR 0021 (status, details, fixed limit).

## In scope
- **Main session (contract):**
  - add `{ status: 422, code: 'baked_too_large' }` to `versions.publish` in `packages/api-contract/src/endpoints.ts`;
  - add it to API-CONTRACT §3.9 with its details shape;
  - regenerate with `pnpm contract:docs`.
- **`modules/versions/snapshot.ts`:**
  - Export `MAX_BAKED_BYTES = 64 * 1024 * 1024` and a `BakedTooLargeError` that carries `totalBytes` and `largest` (the 10 largest cases, largest first: `{ routeId, method, path, caseId, caseName, bytes }`).
  - During the bake loop, keep a running total of each case's body size (`Buffer.byteLength(body, 'utf8')`) and the 10 largest so far.
  - Once the total passes the cap, stop keeping bodies but keep measuring, so the full total and the true top 10 are known without holding more than 64 MiB.
  - After the loop:
    - if any case failed to bake, `PublishInvalidError` wins;
    - otherwise, if the final serialized `baked` JSON is over the cap, throw `BakedTooLargeError`.
- **`modules/versions/service.ts`:**
  - map `BakedTooLargeError` to `HttpError(422, 'baked_too_large', <message>, largest)`;
  - the message reads: `The baked responses total <X.X> MiB; the limit is 64 MiB. Shrink the largest cases or switch the project to random mode.`;
  - no version row is created.
- **Web, `features/versions/PublishDialog.tsx`:**
  - on `baked_too_large`, show the message and list the entries with their sizes (KiB or MiB), reusing the `publish_invalid` offender list;
  - each entry links to its case, as `publish_invalid` entries do.

## Out of scope
- An environment variable for the limit (ADR 0021).
- A cap on `snapshotBytes`.
- Changing the per-response limits in schema-core.
- Showing sizes anywhere except the failed publish.

## Contract
- `versions.publish`: new error `422 baked_too_large`. Details are `{ routeId, method, path, caseId, caseName, bytes }[]`, at most 10 entries, largest first.
- The cap is measured as `bakedBytes`, the UTF-8 length of the stored `baked` JSON.
- No schema change; no new dependency.

## Acceptance criteria
- [x] A seeded-mode project whose bodies total just over 64 MiB:
  - `POST /versions` returns `422 baked_too_large`, and its details match the contract (`assertContract`);
  - there are at most 10 entries, sorted by `bytes` descending, and the first is the biggest case;
  - no row is added to `versions` and `projects.version_seq` does not change.
- [x] A project just under the cap publishes, with `bakedBytes` under 67,108,864.
- [x] The same oversized project in `random` mode publishes, with `baked` null and `bakedBytes` 0.
- [x] A project that both has an invalid case and is over the cap returns `publish_invalid`.
- [x] Bake memory stays bounded: the bodies kept in memory never exceed the cap plus one case. Test this by counting retained bytes, not by measuring the process.
- [x] The Publish dialog shows the message and the listed cases with human-readable sizes, and each entry links to its case (Testing Library, mocked client).
- [x] `pnpm contract:docs --check` passes with the new error in API-CONTRACT §3.9.

## Tests
- Unit tests on `buildVersionPayload`. Use a small test-only cap override (an optional parameter, not configuration) so the tests don't bake 64 MiB.
- One API test that crosses the real 64 MiB cap using schemas within the per-response limits (for example many cases near the 50,000-leaf limit). If that is too slow for CI, the test-only override covers the behaviour, and a separate test asserts that `MAX_BAKED_BYTES` is 67,108,864.
- A web test for the dialog.

## Open questions
- Whether a version already stored over 64 MiB, which can't happen today, should still load. Assumed yes: the cap applies at publish only.

## Implementation notes
- `snapshot.ts` measures the exact size of `JSON.stringify(bodies)` as it goes: braces, commas and each `"key":"body"` entry. It compares that number with the cap, so `bakedBytes` of a stored version is never over 64 MiB. `bytes` in the details is the body alone.
- Once the total passes the cap, bodies already kept are dropped and new ones are only measured. `BakedTooLargeError.retainedBytes` records the most held at once; the test asserts it stays at or under the cap plus one case.
- `buildVersionPayload` and `publishVersion` take an optional `{ maxBakedBytes }`. It is test-only and not configuration (ADR 0021).
- The real-cap API test publishes 5 cases of 14 MiB (`fixed` string values), which takes a few seconds against Postgres.
- The Publish dialog shows the server's message and lists the cases as links with sizes (`formatBytes`: B, KiB or MiB).
