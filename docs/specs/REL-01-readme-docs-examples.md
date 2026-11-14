# REL-01 — README, docs site, examples

Status: in review
Phase: 5   Team: Core
Depends on: XC-01, RUN-11
Size: M

## Goal
A stranger can understand the product, run it on their LAN in three commands, and make their first mock call from the README alone.

## In scope
- `README.md` in DESIGN's order: one sentence, an animated GIF (build a route, call it), three-command quickstart, a `curl` example with its response, short feature list, **bold** threat-model statement (no authentication on mock URLs; trusted private network), the "Run it on your LAN" section (URL form, finding the IP, firewall note, Docker Desktop IP caveat), then architecture and a comparison with Mockoon/WireMock/Prism/json-server/Beeceptor.
- Docs site source under `docs/site/` (so planning docs and ADRs are not published): getting started, concepts (workspace, project, route, case, version), schema format and generation rules, case selection and headers, environment variables, backup and restore of `pgdata`, resetting a password from the CLI.
- `examples/`: ≥3 exported projects (`*.mockbench.json`) and sample payloads.

## Out of scope
Animations beyond the single GIF, translations, hosting the docs.

## Contract
Documents the behaviour in API-CONTRACT §4 and the env table in FND-10. Examples must import via `projects.import`.

## Acceptance criteria
- [x] Following only the README on a clean machine (clone, `cp .env.example .env`, `docker compose up`, open the URL, register) reaches a callable mock; the quickstart commands are copy-paste exact and are exercised by CI (`scripts/readme-smoke.sh`). *(`scripts/readme-smoke.sh` runs in CI as the `readme-smoke` job: it brings the stack up from `.env.example`, compares the demo curls with the README blocks, registers a user over the API. Registering in the browser UI is not exercised by it.)*
- [x] The README states the LAN URL form `http://<this-machine's-LAN-IP>:8080` explicitly and that the user may need to allow the port through the host firewall.
- [x] The threat-model sentence is in bold above the fold and repeated in the docs. *(checked by `scripts/docs-check.test.ts`)*
- [ ] Every `examples/*.mockbench.json` imports cleanly through `projects.import` in CI and its `curl` snippet in the README matches a real response. *(Blocked: `projects.import` is still `501 not_implemented` until PRJ-06 merges. Done meanwhile: every example parses as `ProjectExport` and every schema validates (`scripts/docs-check.test.ts`); `scripts/readme-smoke.sh` has the import-publish-deploy-call step and skips it on a 501, which must become a hard failure when PRJ-06 merges. The README curl snippets use the seeded `demo` project and are compared with real responses.)*
- [x] Every env var in `.env.example` appears in the docs env table with default and meaning, and a CI check fails when one is undocumented. *(`scripts/docs-check.test.ts`; also covers every variable `config.ts` reads)*
- [x] The docs describe `case_not_found` vs a mocked error (`X-Mock-Error`) and list every diagnostic header.
- [ ] A documented command resets a user's password without the UI (see Open questions).
- [x] No page loads external assets (fonts, scripts) — the docs site is also offline-capable. *(`scripts/docs-check.test.ts`)*

## Tests
README smoke script in CI; link checker; import-all-examples test; env-documentation check.

## Open questions
- **Not done, awaiting an owner decision:** the CLI password reset (criterion above) does not exist; `docs/site/backup-and-restore.md` states that plainly. Add a small unit or drop the criterion.
- **Not done:** the animated GIF of building a route and calling it (needs a browser recording). The README has no placeholder for it.
- Docs site generator: none chosen. `docs/site/` is plain Markdown that reads offline; a generator can be added later without changing the sources.
- `CONTROL_RATE_LIMIT` and `LOGIN_RATE_LIMIT` are read by `config.ts` but not passed through by `docker-compose.yml`, so setting them in `.env` does nothing under compose. The env docs say so.
- `CACHE_FANOUT` is read by `config.ts` but nothing uses it yet (RUN-12).
- The CLI password reset does not exist in any unit (PLAN § 9, "no account lifecycle"); either add a small unit before release or drop this criterion.
- Docs site generator (assumed a static, dependency-light one).
