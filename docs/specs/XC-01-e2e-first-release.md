# XC-01 — End-to-end first-release loop in CI

Status: approved
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
- [ ] **Golden loop:** on a fresh stack the suite registers the first user (lands in workspace `Default`), creates project `shop-api`, creates `GET /products/:id`, edits the OK case's schema in the JSON tab to the worked example, sees the preview text equal the golden, publishes with "Deploy immediately", then `GET http://mockbench.lan.test:8080/mock/shop-api/products/42` (outside the browser) returns `200` with a body byte-equal to the preview and headers `X-Mock-Version: v1`, `X-Mock-Route: GET /products/:id`.
- [ ] Adds a `Not found` 404 case, publishes v2 and deploys it; `X-Mock-Case: Not found` → `404`; the default call is still `200`; deploying v1 again (rollback) restores v1's body on the next request without a restart.
- [ ] The topbar base URL and the Try-it curl both contain `mockbench.lan.test:8080`, and no occurrence of `localhost` appears in the page text (asserted by scanning the visible text).
- [ ] The session cookie set by sign-in has no `Secure` and no `Domain` attribute and is accepted over plain HTTP (the next navigation is authenticated).
- [ ] Error paths: unknown slug → `404` with `X-Mock-Error: true`; unmatched path → `404` listing routes; `X-Mock-Case: nope` → `400 case_not_found`; unpublished project → `503`.
- [ ] `OPTIONS` to a mock URL with an `Origin` header returns `204` and permissive CORS headers; a cross-origin `fetch` from a page on another hostname to the mock succeeds and can read `X-Mock-Version`.
- [ ] A case that sets `Content-Type: text/html` with an inline `<script>` payload, opened as a top-level navigation, does not execute the script (CSP sandbox) — the `window.__pwned` probe stays undefined.
- [ ] With `SEED_DEMO=true`, a separate run shows `GET /mock/demo/users` answering before anyone has registered, and the first registrant owning workspace `default`.
- [ ] The workflow fails if any browser request goes to a host other than the stack's (no external requests: fonts, CDNs, analytics).
- [ ] The whole suite finishes in under 6 minutes on a standard runner and leaves no containers running.

## Tests
This unit is tests. Each criterion is one named spec.

## Open questions
- Whether to run the suite also on `linux/arm64` via emulation (assumed no; build-only in FND-14).
