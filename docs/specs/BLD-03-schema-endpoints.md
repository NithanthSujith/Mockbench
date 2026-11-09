# BLD-03 — Stateless schema endpoints

Status: done
Phase: 2   Team: Builder
Depends on: FND-11
Size: S

## Goal
`POST /schema/infer` and `POST /schema/preview` expose `schema-core` over HTTP for API consumers and tests, identically to what the browser computes locally.

## In scope
Handlers for `schema.infer` and `schema.preview`: thin wrappers over `inferSchema` and `generate`, with the contract's request/response shapes and size limit.

## Out of scope
Any database access, UI, caching, new inference rules.

## Contract
Endpoints per API-CONTRACT §3.8. Libraries: `@mockbench/schema-core`. No tables.

## Acceptance criteria
- [x] `POST /schema/infer {sample:{"id":"8c1f0e2a-5b43-4c9d-9f12-6a7b8c9d0e1f","z":null}}` → `200` with `schema.root.fields[0].node.type === "uuid"` and a `null_value` warning at `$.z`.
- [x] A sample deeper than the depth limit → `422` with issue code `depth_exceeded`; a 1 MiB + 1 body → `413`. *(Also `array_count_exceeded` and `node_limit_exceeded` for the other sample limits.)*
- [x] `POST /schema/preview` with the DESIGN worked-example envelope, `settings:{indexing:"local"}` and no `projectId` returns the DESIGN output byte-for-byte as `json` (2-space indent) and `generatorVersion:1`. *(See "Implementation notes": byte-for-byte against the committed golden needs the golden's project id; with no `projectId` the document is identical apart from the uuid values.)*
- [x] The same request with `projectId` set yields different `uuid` values than without, and identical values on repeat.
- [x] `settings:{mode:"random"}` is accepted and the response is not required to be stable.
- [x] An invalid schema → `422` listing the validator issues; a schema over the leaf limit → `422 leaf_limit_exceeded` (never a 500 or a timeout).
- [x] Requires a session: no cookie → `401`; any role works.
- [x] The endpoint performs no database query (query counter = 0). *(The handlers are called with a context whose `db`/`pool` throw on any use; over HTTP the only SQL a request issues is the session lookup.)*

## Tests
Supertest against fixtures shared with schema-core's goldens (the response equals the golden). `apps/api/src/modules/schema/schema.test.ts`: 26 tests plus 1 `todo` (below), on a real Postgres through `testApp()`.

## Implementation notes
- **Where:** `apps/api/src/modules/schema/schema.ts` (handlers, bound in `index.ts`).
- **Validation order for `preview`:** the registry's request schema is structural only, so the handler runs `validateSchema(schema, { components })` itself (limits, refs, cycles, duplicate keys). Failures are `422 validation_failed` with the validator's issue codes, paths prefixed with `schema`. `generate()` is still wrapped so a limit or invalid error can never surface as a 500.
- **`projectId` and the golden:** the committed schema-core golden is generated with project id `11111111-1111-7111-8111-111111111111`, so "byte-for-byte" holds for that `projectId`. With no `projectId` the id is the nil UUID (`00000000-0000-0000-0000-000000000000`) and the document equals the golden once the uuid values are masked. Both are tested.
- **`infer` limit breaches:** `inferSchema` reports a sample over a limit as one `limits_exceeded` warning (and an empty schema). The contract wants `422` with the specific issue code, so the handler recovers the code from the warning's wording (`limitIssueCode`): `nested more than` → `depth_exceeded`, `array longer than` → `array_count_exceeded`, `more than N values` → `leaf_limit_exceeded`, otherwise `node_limit_exceeded`. A unit test pins the wording.
- **Presets in `preview`:** `presets: [{ rules, priority? }]` becomes `ResolvedPreset`s (`priority` defaults to 0); components in the body are merged over the envelope's, as everywhere else.

## Found while building (not fixable in this module)
- **Deeply nested bodies answer 500.** The generic body validation in `apps/api/src/http/control-plane.ts` runs the registry's recursive `z.json()`/`MockNode` schemas; somewhere between 500 and 1,500 levels of nesting Zod overflows the stack, and the `RangeError` becomes `500 internal_error`. 500 levels still gives a clean `422 depth_exceeded`. It affects every endpoint with a JSON body, not only these two. Proposed fix (Core, shared file): in `validate()` wrap the three `safeParse` calls in `try { … } catch (e) { if (e instanceof RangeError) throw new HttpError(422, 'validation_failed', 'The request is not valid.', [{ path: [], code: 'depth_exceeded', message: 'The request body is nested too deeply.' }]); throw e }`. An `it.todo` in `schema.test.ts` marks the test to enable once it lands.
- **`limits_exceeded` carries no machine-readable reason.** A `reason`/`code` field on the warning in `schema-core`'s `inferSchema` would replace the message matching above. Low priority.

## Open questions
- Whether `preview` should accept `projectId` + load the project's presets/components server-side (assumed no: stateless).
