# RUN-09 — Versions screen, publish dialog, deploy and rollback

Status: approved
Phase: 3   Team: Runtime
Depends on: RUN-02, RUN-03, BLD-04
Size: M

## Goal
At `/p/$projectSlug/versions` a user publishes the draft, sees every version and the deploy history, deploys or rolls back with one confirmed click, and the topbar always shows what is live.

## In scope
- Versions table (TanStack Table): version, label, published, routes, cases, state, actions; "Load more".
- Publish dialog (label, notes, **Deploy immediately** checked by default → publish then deploy as two calls); `publish_invalid` errors listed as links to the offending route/case.
- Deploy/rollback with confirmation; delete version; deployments history panel; the `<LivePill/>` and `<PublishButton/>` topbar slots.

## Out of scope
Diff (RUN-10, adds a Compare action here), server endpoints, the request log.

## Contract
Endpoints `versions.list`, `versions.publish`, `versions.delete`, `deploy.create`, `deployments.list`, `projects.get` (`activeVersion`). UI route `/p/$projectSlug/versions`; slots from FND-13.

## Acceptance criteria
- [ ] The LIVE version row shows the LIVE pill and no Deploy button; others show "Deploy"; a project with no versions shows "Nothing published yet. Publishing freezes every route and case into a snapshot; deploying points the URL at it."
- [ ] Publishing with "Deploy immediately" calls `versions.publish` then `deploy.create`, then the topbar pill shows `LIVE vN` without a reload; with it unchecked only the first call is made and the pill is unchanged.
- [ ] If publish succeeds but deploy fails, the dialog reports "Published v4, but it could not be deployed" with a Retry deploy button (no duplicate publish on retry).
- [ ] A `422 publish_invalid` renders one row per offending case — `METHOD /path › case name — message` — each a link that opens that case in the editor; no version appears in the table.
- [ ] `empty_project` shows "Add at least one route before publishing"; `label_taken` shows the message under the label field.
- [ ] Deploying an older version asks "Roll back to vN? The URL will answer from vN immediately." and on success updates the pill and the deployment history.
- [ ] Delete is hidden for the active version and, on `version_referenced`, shows "Recent requests still reference this version".
- [ ] The Publish button is in the topbar on every project screen, opens the same dialog, and is hidden for viewers.
- [ ] The versions table and history refresh via Query invalidation after publish/deploy/delete; labels are mono.
- [ ] Layout holds at 360 px (the table scrolls in its card).

## Tests
Testing Library for dialog branches (including the partial-failure path); Playwright publish → deploy → rollback in MSW mode and, once available, the real stack in XC-01.

## Open questions
- Label suggestions (e.g. prefilling `v<next>`) — placeholder only, the server assigns the default.
