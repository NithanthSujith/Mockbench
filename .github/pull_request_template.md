<!-- The PR title is the squash commit on main: a conventional commit, e.g. `feat(runtime): RUN-14 …` or `fix(builder): …`. -->

## What and why

<!-- Spec ID if there is one (docs/specs/<ID>-*.md), and which acceptance criteria this ticks. -->

## Checklist

- [ ] Tests added or updated for the behaviour this changes (Vitest; name the cases the spec names).
- [ ] If behaviour changed, the spec, `docs/API-CONTRACT.md` and `docs/DESIGN.md` are updated in this same PR (or nothing in them is affected).
- [ ] No edits to shared files outside my area (`docs/TEAMS.md`), or each one is called out below.
- [ ] A changeset is added (`pnpm changeset`), or this PR ships nothing user-visible.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm build` pass locally.
- [ ] Nothing new calls out to the network at runtime, loads assets from a CDN, or hardcodes `localhost`.

## Notes for the reviewer

<!-- Drift from the spec, shared-file changes, open questions. -->
