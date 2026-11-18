# 0020 — Release rulings: changesets, commit lint, RUN-12, password reset
Status: accepted      Date: 2026-11-18

## Context
Before the first release, four questions were open that DESIGN.md and API-CONTRACT.md do not answer:

1. REL-03 asks CI to fail a PR that "changes a published package without a changeset". Every workspace package is private and nothing goes to npm; only the `api` and `web` Docker images ship.
2. REL-03 asks for a commit-lint check. The repository squash-merges, so the PR title becomes the commit on `main`.
3. RUN-12 (Postgres `LISTEN`/`NOTIFY` cache fan-out) was optional, to be dropped if v1 is single-instance (PLAN D13). v1 is single-instance.
4. REL-01 has a criterion "a documented command resets a user's password without the UI", and no unit implements it.

## Decision
1. **Changesets cover anything shipped.** A PR that changes non-test, non-doc files under `apps/api`, `apps/web`, `packages/schema-core` or `packages/api-contract` needs a changeset or the `no-changeset` label. All workspace packages are one fixed version group, so a release tag has one changelog.
2. **Commit lint checks the PR title only.** Branch commits are free-form; the squash commit on `main` (the PR title) must be a conventional commit.
3. **RUN-12 is dropped.** v1 runs one api container. The `CACHE_FANOUT` variable, which nothing read, is removed from `config.ts`, the compose files and the docs. The migration advisory lock stays (DESIGN, "scaling to several api replicas").
4. **A CLI password reset is added as a small unit (AUTH-04)** before the first release.

## Consequences
- REL-03 implements 1 and 2. Docs-only, test-only and tooling PRs need no changeset.
- Running several api replicas is unsupported in v1: each would serve its own cache until restarted. The docs say one api container.
- AUTH-04 adds a `reset-password` entry to the api image. REL-01's criterion is met when AUTH-04 merges.

## Revisit if
Someone needs replicas (bring RUN-12 back, ADR 0007 still holds), or a package starts being published to npm.
