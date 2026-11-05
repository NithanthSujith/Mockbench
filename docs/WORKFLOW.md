# Mockbench — how later sessions operate

This is the procedure for a session (or subagent) that has been handed a spec ID. It exists so that several agent teams can work in parallel without a conversation between them.

## The seven rules

1. **I name a spec ID. You read that spec, its dependencies' Contract sections, `CLAUDE.md`, `docs/API-CONTRACT.md` and the relevant part of `docs/DESIGN.md`. Nothing else.** Do not browse other teams' code to "get context"; the Contract sections are the interface.
2. **Before coding, confirm the spec is still accurate against the code as it actually stands, and raise anything that has drifted.** Check: do the tables/exports/endpoints the spec names exist as described? Did a dependency merge differently than its Contract says? If yes, stop and report the drift; do not quietly adapt.
3. **Implement only what is in scope.** Anything you discover that belongs elsewhere goes into that unit's spec (its *Open questions*) or a new draft spec in `docs/specs/` — not into this commit.
4. **Never edit a shared file your team does not own.** The list is in `docs/TEAMS.md` §2.1. Raise it instead: state the file, the exact change, and why the spec cannot be met without it.
5. **If a design decision comes up that DESIGN.md and API-CONTRACT.md do not cover, STOP and ask.** Record the answer as an ADR (`docs/decisions/NNNN-slug.md`) and amend the spec. Never decide it silently in code. This rule is **absolute for a subagent**: the person who delegated sees your result, not your reasoning, so a silent decision is invisible and cannot be corrected. Return with the question instead.
6. **DESIGN.md and API-CONTRACT.md are the source of truth.** If implementation forces a change to either, change the document **in the same commit** and say so in the commit body and the PR description. The registry in `packages/api-contract` and `docs/API-CONTRACT.md` are changed together — only from the main session.
7. **Update the spec's `Status:` and check off acceptance criteria as you go** (`draft → approved → in progress → done`). A unit is `done` only when every box is ticked and its dependencies are merged and exercised.

## Step by step

1. **Orient.** Read the inputs in rule 1. Note the unit's *Out of scope* — it is as binding as *In scope*.
2. **Check drift** (rule 2). Run `pnpm typecheck && pnpm test` on a clean checkout of `main` first, so you know the baseline is green.
3. **Branch.** `git worktree add ../mockbench-<id> -b team/<team>/<id>`. All work happens there.
4. **Test first where the spec names cases.** The acceptance criteria are written to be turned into tests directly.
5. **Implement inside your owned directories only** (`docs/TEAMS.md` §3). Wire handlers by filling your module's `handlers` map or your feature's screen components — never by editing the route tree or `app.ts`.
6. **Keep the app runnable.** End state: build green, `docker compose up` works, previous units' behaviour unchanged.
7. **Self-check against Definition of Done** (`docs/TEAMS.md` §2.5), then open the PR: title `feat(<team>): <ID> <title>`, body lists the ticked criteria, any drift found, any doc changes.
8. **Report** what you did, what you did not do (and why), and every question you stopped on.

## Conventions that apply to every unit

- **Contract first.** A request/response type comes from `packages/api-contract`; a MockSchema type from `schema-core`. If it is missing there, that is a contract change (rule 6), not a local type.
- **Errors** only through the shared `HttpError`; codes exactly as in API-CONTRACT.
- **Frontend**: tokens only (no hex), relative API URLs, no `localhost`, mock URL from `lib/mock-url.ts`, dark mode only, no new fetch outside `lib/api`.
- **Tests**: Vitest; DB tests run against a real Postgres 16 (the Phase-1 harness), not mocks.
- **Commits**: conventional commits; do not skip hooks.

## When you are blocked

| Situation | Do |
| --- | --- |
| Spec and code disagree | Report the drift (rule 2). Do not pick a side |
| Need a shared-file change | Raise it (rule 4) with the exact diff proposed |
| Decision DESIGN/CONTRACT don't cover | Stop and ask (rule 5) |
| A dependency isn't merged | Stub per `docs/TEAMS.md` §2.4; don't mark done |
| You found a bug in another team's area | Write it into that unit's *Open questions*; don't fix it |
| The spec's *In scope* needs more than ~3 sentences to describe what you actually did | The unit was too big: say so, and propose a split |

## Phase 1 is different

Phase 1 units (FND-*) are done in the main session, one at a time or in the parallel groups PLAN.md names. They are the only units allowed to touch shared files. After the last FND unit merges, the user reviews and approves the freeze; the main session then tags `contracts-v1`. No slice-team unit starts before that tag.
