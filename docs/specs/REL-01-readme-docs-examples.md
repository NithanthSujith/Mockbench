# REL-01 — README, docs site, examples

Status: approved
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
- [ ] Following only the README on a clean machine (clone, `cp .env.example .env`, `docker compose up`, open the URL, register) reaches a callable mock; the quickstart commands are copy-paste exact and are exercised by CI (`scripts/readme-smoke.sh`).
- [ ] The README states the LAN URL form `http://<this-machine's-LAN-IP>:8080` explicitly and that the user may need to allow the port through the host firewall.
- [ ] The threat-model sentence is in bold above the fold and repeated in the docs.
- [ ] Every `examples/*.mockbench.json` imports cleanly through `projects.import` in CI and its `curl` snippet in the README matches a real response.
- [ ] Every env var in `.env.example` appears in the docs env table with default and meaning, and a CI check fails when one is undocumented.
- [ ] The docs describe `case_not_found` vs a mocked error (`X-Mock-Error`) and list every diagnostic header.
- [ ] A documented command resets a user's password without the UI (see Open questions).
- [ ] No page loads external assets (fonts, scripts) — the docs site is also offline-capable.

## Tests
README smoke script in CI; link checker; import-all-examples test; env-documentation check.

## Open questions
- The CLI password reset does not exist in any unit (PLAN § 9, "no account lifecycle"); either add a small unit before release or drop this criterion.
- Docs site generator (assumed a static, dependency-light one).
