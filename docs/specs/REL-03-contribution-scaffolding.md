# REL-03 — Contribution scaffolding, Changesets, CodeQL

Status: approved
Phase: 5   Team: Core
Depends on: FND-01
Size: S

## Goal
An outside contributor can set up locally in five minutes, file a useful issue, open a well-formed PR, and trust the repo's automation.

## In scope
`CONTRIBUTING.md` (five-minute local setup, the two ways to run — all in Docker, or Postgres in Docker with apps on the host — conventional commits, how specs/ADRs work), `CODE_OF_CONDUCT.md` (Contributor Covenant), issue templates (bug, feature), PR template, Changesets config, `codeql.yml` (PR + weekly), and a short list of real `good first issue` candidates drafted for labelling.

## Out of scope
Governance documents, funding files, bots.

## Contract
Conventional commits; Changesets for the changelog; CodeQL for JavaScript/TypeScript.

## Acceptance criteria
- [ ] Following only CONTRIBUTING.md on a clean machine yields a running dev environment (`pnpm install`, Postgres in Docker, `pnpm dev`, UI on the Vite port proxying to the API) — verified by running the documented commands in CI.
- [ ] Issue templates render and require version, steps and expected/actual; the PR template includes the checklist: tests added, spec/contract/DESIGN updated in the same commit if behaviour changed, no shared-file edits outside the owning area.
- [ ] `pnpm changeset` works and CI fails a PR that changes a published package without a changeset (or an explicit `no-changeset` label).
- [ ] `codeql.yml` runs on PRs and on a weekly schedule and completes green on `main`.
- [ ] A commit message that is not conventional fails a commit-lint check in CI.
- [ ] A list of at least five concrete `good first issue` candidates exists in `docs/` with file pointers and acceptance criteria.

## Tests
CI runs of each workflow; a script verifying CONTRIBUTING commands.

## Open questions
- Whether to require signed commits / DCO (assumed no).
