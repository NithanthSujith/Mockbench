# XC-01 — End-to-end first-release loop in CI

Status: in progress
Phase: 3   Team: Core
Depends on: AUTH-03, PRJ-04, BLD-09, BLD-11, RUN-05, RUN-09, FND-14
Size: M

## Goal
A Playwright suite, run in CI against the real `docker compose` stack, proves the product loop end to end — register, create a project, build a route and a schema, publish, deploy, call the mock from outside the browser — and doubles as the project's best documentation. Passing it is the **first usable release gate** (DESIGN M3).

## In scope
- `e2e/` Playwright project and the `e2e.yml` workflow (PR trigger): brings up the compose stack, waits for healthy, runs the specs, uploads traces on failure.
- Specs: the golden loop; LAN-address checks; error paths; rollback.
- A page-object layer shared by later teams' e2e additions (`e2e/<area>/`).

## Out of scope
Unit/integration tests (owned by each unit), performance testing, cross-browser matrix beyond Chromium.

## Contract
Entry: `pnpm e2e`. The browser is launched with `--host-resolver-rules="MAP mockbench.lan.test 127.0.0.1"` and navigates to `http://mockbench.lan.test:8080`; non-browser calls use `APIRequestContext` against the same host. Env: `SEED_DEMO=false` for the loop spec (and a second spec with `true` for the seed).

## Acceptance criteria
- [x] **Golden loop:** on a fresh stack the suite registers the first user (lands in workspace `Default`), creates project `shop-api`, creates `GET /products/:id`, edits the OK case's schema in the JSON tab to the worked example, sees the preview text equal the golden, publishes with "Deploy immediately", then `GET http://mockbench.lan.test:8080/mock/shop-api/products/42` (outside the browser) returns `200` with a body byte-equal to the preview and headers `X-Mock-Version: v1`, `X-Mock-Route: GET /products/:id`. _Verified as: the preview equals the golden with UUIDs masked, and the data-plane body equals the compact form of the preview (Notes 1 and 2)._
- [x] Adds a `Not found` 404 case, publishes v2 and deploys it; `X-Mock-Case: Not found` → `404`; the default call is still `200`; deploying v1 again (rollback) restores v1's body on the next request without a restart.
- [ ] The topbar base URL and the Try-it curl both contain `mockbench.lan.test:8080`, and no occurrence of `localhost` appears in the page text (asserted by scanning the visible text). _Topbar half passes; the Try-it half is `test.fixme` until BLD-12 merges (Note 3)._
- [x] The session cookie set by sign-in has no `Secure` and no `Domain` attribute and is accepted over plain HTTP (the next navigation is authenticated).
- [x] Error paths: unknown slug → `404` with `X-Mock-Error: true`; unmatched path → `404` listing routes; `X-Mock-Case: nope` → `400 case_not_found`; unpublished project → `503`.
- [x] `OPTIONS` to a mock URL with an `Origin` header returns `204` and permissive CORS headers; a cross-origin `fetch` from a page on another hostname to the mock succeeds and can read `X-Mock-Version`.
- [x] A case that sets `Content-Type: text/html` with an inline `<script>` payload, opened as a top-level navigation, does not execute the script (CSP sandbox) — the `window.__pwned` probe stays undefined.
- [ ] With `SEED_DEMO=true`, a separate run shows `GET /mock/demo/users` answering before anyone has registered, and the first registrant owning workspace `default`. _First-registrant half passes; the demo-answers half is `test.fixme` until RUN-11 merges (Note 4)._
- [x] The workflow fails if any browser request goes to a host other than the stack's (no external requests: fonts, CDNs, analytics).
- [x] The whole suite finishes in under 6 minutes on a standard runner and leaves no containers running. _Local run: 2m11s including an image build from cache, no containers or volumes left; CI: whole e2e job 2m04s, including install, browser install and the no-containers-left check._

## Tests
This unit is tests. Each criterion is one named spec.

## Also covered (cases earlier units skipped)
AUTH-03 guard and redirect (including an open-redirect target and sign-out), BLD-05 selected case in the URL (default redirect, reload, back, unknown case id), RUN-09 publish without deploy then deploy.

## Notes from the first implementation
1. **Preview vs golden.** UUID values are v5 over the project id, so a preview in a newly created project cannot equal the committed golden (fixed project id) byte for byte. The test masks UUIDs and compares everything else exactly.
2. **"Body byte-equal to the preview".** The preview is 2-space indented; the data plane serves compact JSON (API-CONTRACT 4.3). The test asserts `body === JSON.stringify(JSON.parse(preview))`, which also proves the UUIDs match.
3. **Try-it curl.** BLD-12 is not in `Depends on` and is not merged, so there is no curl snippet. Add BLD-12 to `Depends on` (and make this criterion check it) or move the clause to BLD-12.
4. **Demo seed.** The `demo` project comes from RUN-11, also not in `Depends on` and not merged. Same remedy.
5. **Port and host.** The port is `E2E_PORT` (default 8080). Node-side requests resolve `mockbench.lan.test` through a `dns.lookup` and `dns.promises.lookup` shim in `e2e/support/lan.ts`, the counterpart of Chromium's `--host-resolver-rules`.
6. **Product bug (BLD-05), fixed.** After "+ Case" or selecting another case tab, the previous case's settings bar stayed in the DOM under the new one. Root cause in `RouteEditorScreen`: `CaseBar` and `SchemaEditorSlot` were siblings with the same `key={selected.id}`; duplicate sibling keys make React's reconciler lose one old child, so the old bar was never removed. Fixed with distinct key prefixes; the `test.fixme` is now a live test.
7. **Rate limits shape the suite.** The control plane allows 100 requests a minute per session, and the SPA is chatty enough that one session for the whole run hits `429`. The suite shares a session across three tests at a time (sign-in is 10 a minute per IP).

## Open questions
- Whether to run the suite also on `linux/arm64` via emulation (assumed no; build-only in FND-14).
