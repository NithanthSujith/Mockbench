# Good first issues

Real, small gaps in Mockbench, each one sized for a first contribution. Maintainers open them as GitHub issues labelled `good first issue`. Comment on the issue before you start so two people don't do the same one.

Read [`CONTRIBUTING.md`](../CONTRIBUTING.md) first. Items marked **shared file** touch a file only maintainers change; the PR is welcome, it just gets a maintainer review of that file.

## 1. Playwright test: paste JSON and infer a schema

The JSON tab's "infer from pasted JSON" flow (BLD-09) is covered by Testing Library only, not in a real browser.

- Files: `e2e/first-release.spec.ts` (or a new `e2e/builder/infer.spec.ts`), page objects in `e2e/pages/project.page.ts`. The UI is in `apps/web/src/features/schema-builder/InferPanel.tsx` and `JsonTab.tsx`.
- Done when: a test pastes `{"id": 1, "email": "a@b.co", "tags": ["x"]}`, accepts the inferred schema, sees `integer`, `email` and `array` rows in the Builder tab, and the preview shows an `email` value. It passes in the `e2e` CI job.

## 2. Playwright test: the request log updates by itself

The request-log screen polls while the tab is visible (`LOG_POLL_MS` in `apps/web/src/features/logs/queries.ts`). No browser test proves a new request appears without a reload.

- Files: `e2e/first-release.spec.ts` or a new `e2e/runtime/logs.spec.ts`; the screen is in `apps/web/src/features/logs/screens/`.
- Done when: with the log screen open, a test calls the mock from outside the browser (Playwright's `request`) and the new row appears within the poll interval plus 2 s, with no reload.

## 3. Playwright test: members against the real API

The members screen (WS-04) is tested against MSW fixtures only.

- Files: a new `e2e/workspaces/members.spec.ts`; the screen is in `apps/web/src/features/workspaces/screens/`.
- Done when: the owner adds a second registered user as `editor`, changes them to `viewer`, then removes them, and each change shows after a reload. Note the sign-in rate limit of 10 per minute per IP (see `e2e/fixtures.ts` for how the suite shares sessions).

## 4. The project list at 360 px

PRJ-04 has an unticked criterion: the layout holds at 360 px and the table scrolls inside its card. WS-04's members table has the same gap.

- Files: `apps/web/src/features/projects/screens/` and `apps/web/src/features/workspaces/screens/`; a Playwright test with `viewport: { width: 360, height: 740 }`.
- Done when: at 360 px wide the page has no horizontal scroll (`document.documentElement.scrollWidth <= 360`) and the table's own container scrolls. Tick the criterion in `docs/specs/PRJ-04-project-list-switcher.md`.

## 5. Let compose pass the rate-limit variables through (shared file)

`apps/api/src/config.ts` reads `CONTROL_RATE_LIMIT` and `LOGIN_RATE_LIMIT`, but `docker-compose.yml` and `docker-compose.pull.yml` do not pass them to the `api` service, so setting them in `.env` does nothing under compose. `docs/site/environment-variables.md` says so today.

- Files: both compose files (the `api.environment` block, next to `MOCK_RATE_LIMIT`), `.env.example` (commented lines), `docs/site/environment-variables.md`.
- Done when: `CONTROL_RATE_LIMIT=5` in `.env` makes the sixth control-plane request in a minute return `429` under `docker compose up`, unset keeps the defaults (600 and 10), and the docs no longer carry the caveat.

## 6. A `danger` button variant (shared file)

There is no destructive button style. The delete actions use `variant="ghost"` with `border-bad text-bad` classes, in three places.

- Files: `apps/web/src/components/ui/button.tsx` (add the variant, token classes only, no hex), `apps/web/src/components/ui/gallery.tsx` (show it at `/_dev/ui`), and the three call sites: `features/projects/DeleteProjectDialog.tsx`, `features/projects/screens/SettingsScreen.tsx`, `features/presets/screens/PresetsScreen.tsx`.
- Done when: the call sites use `variant="danger"`, no component keeps the ad-hoc classes, and `ui.test.tsx` covers the variant.

## 7. Typecheck the end-to-end suite

`e2e/` is outside the root typecheck, so a type error in a Playwright test only shows up when the suite runs.

- Files: a new `e2e/tsconfig.json` extending `@mockbench/tsconfig/node.json`, and the root `typecheck` script in `package.json` (**shared file**).
- Done when: `pnpm typecheck` checks `e2e/**/*.ts`, a deliberate type error in `e2e/fixtures.ts` fails it, and `main` passes as it is.
