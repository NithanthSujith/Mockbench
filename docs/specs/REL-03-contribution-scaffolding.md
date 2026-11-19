# REL-03 — Contribution scaffolding, Changesets, CodeQL

Status: done (one criterion awaits an owner check)
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
- [x] Following only CONTRIBUTING.md on a clean machine yields a running dev environment (`pnpm install`, Postgres in Docker, `pnpm dev`, UI on the Vite port proxying to the API) — verified by running the documented commands in CI. *(`contributing-smoke` job, `scripts/contributing-smoke.sh`, green on #56 and on `main`)*
- [ ] Issue templates render and require version, steps and expected/actual; the PR template includes the checklist: tests added, spec/contract/DESIGN updated in the same commit if behaviour changed, no shared-file edits outside the owning area. *(PR template in use since #57. The bug and feature forms require version, steps, expected and actual; that they render on GitHub needs an owner to open New issue, since the chooser page needs a login.)*
- [x] `pnpm changeset` works and CI fails a PR that changes a published package without a changeset (or an explicit `no-changeset` label). *(`pr-checks.yml` `changeset` job; failing cases in `scripts/check-pr-checks.test.ts`; passed on #58 with `.changeset/cli-password-reset.md`)*
- [x] `codeql.yml` runs on PRs and on a weekly schedule and completes green on `main`. *(green on `main` after #56, #57 and #58)*
- [x] A commit message that is not conventional fails a commit-lint check in CI. *(Per ADR 0020 the check is on the PR title, which becomes the squash commit: `pr-checks.yml` `title` job, `scripts/check-pr-title.mjs`.)*
- [x] A list of at least five concrete `good first issue` candidates exists in `docs/` with file pointers and acceptance criteria. *(`docs/good-first-issues.md`, seven items)*

## Tests
CI runs of each workflow; a script verifying CONTRIBUTING commands.

## Open questions
- Whether to require signed commits / DCO (assumed no).
