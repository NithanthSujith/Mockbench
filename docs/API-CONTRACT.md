# Mockbench — HTTP API contract

Status: **proposed — frozen when Phase 1 is approved** (see `docs/PLAN.md` § Decisions needed). After the freeze, a change here is a change to `packages/api-contract` in the same commit, made only from the main session.

This document is the human-readable mirror of the Zod registry in `packages/api-contract` (FND-06/FND-07). Endpoint ids below (`auth.login`, …) are the registry keys. `pnpm contract:docs` fails CI if this file's endpoint table drifts from the registry. Where this file adds to or deviates from `docs/DESIGN.md`, the item is marked **⁺** (addition) or **Δ** (deviation) and listed in PLAN.md § Decisions needed.

Two surfaces are frozen here: the **control plane** (`/api/v1/*`, authenticated) and the **data plane** (`/mock/:slug/*`, what consumers call). Teams build against this file, not against each other.

---

## 1. Conventions (apply to every endpoint)

### 1.1 Transport

- Base path `/api/v1`. JSON in, JSON out, UTF-8. `Content-Type: application/json` on every request with a body, else `415 unsupported_media_type`.
- Body size limit 1 MiB (`413 payload_too_large`), except `projects.import` (10 MiB).
- Field names camelCase. IDs are UUID v7 strings. Timestamps are ISO-8601 UTC with milliseconds and `Z` (`2026-11-05T08:30:00.000Z`).
- The control plane sends **no CORS headers**. It is same-origin only (the SPA and API share one origin).
- Every response carries `X-Request-Id` (echoes an incoming one if present, else generated).
- **CSRF guard ⁺:** every non-safe request (`POST`/`PUT`/`PATCH`/`DELETE`) must carry the header `X-Mockbench-Client: <any non-empty value>`; otherwise `403 csrf_rejected`. The web client always sends `X-Mockbench-Client: web`. (A custom header forces a preflight that the control plane never approves, so other origins on the same host cannot drive it.)

### 1.2 Success status codes

| Operation | Status | Body |
| --- | --- | --- |
| Read / list | `200` | resource or `{ items, nextCursor }` |
| Create / publish / duplicate | `201` | the created resource |
| Update / action returning state (`deploy`, `default`) | `200` | the resource |
| Delete / flush / logout | `204` | none |

### 1.3 Error envelope

Every error from the control plane, with no exceptions:

```json
{ "error": "<machine_code>", "message": "<human sentence>", "details": [] }
```

- `error` — stable snake_case machine code. Clients branch on this, never on `message`.
- `message` — English, one sentence, safe to show a user.
- `details` — **always an array** (empty when unused). On `422 validation_failed` it is a list of `{ "path": (string|number)[], "code": string, "message": string }` (a Zod issue reduced to those three fields; `path` is relative to the request body, or `["query", "<name>"]` / `["params", "<name>"]`). Endpoint-specific shapes are given where used.

**Global codes** — any endpoint may return these; they are not repeated per endpoint:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json` | Body is not parseable JSON |
| 403 | `csrf_rejected` | Non-safe request without `X-Mockbench-Client` |
| 413 | `payload_too_large` | Over the body limit |
| 415 | `unsupported_media_type` | Body present, content type not JSON |
| 422 | `validation_failed` | Body, query or path params fail the Zod schema; unknown body keys count as failures |
| 429 | `rate_limited` | Rate limit hit; response has `Retry-After: <seconds>` |
| 500 | `internal_error` | Unhandled; `message` is generic, details empty |
| 501 | `not_implemented` | Endpoint registered in the contract but its owning unit has not merged (skeleton only; never ships in a release) |

**Auth legend** (used in every endpoint below):

| Auth | Means | Implicit errors (not repeated) |
| --- | --- | --- |
| `public` | No session needed | — |
| `session` | Any signed-in user | `401 unauthenticated` |
| `viewer` / `editor` / `owner` | Signed in **and** a member of the owning workspace with at least that role | `401 unauthenticated`; `404 not_found` if the resource does not exist **or the caller is not a member** (existence is never leaked); `403 forbidden` if a member but the role is too low |

Role permissions: **viewer** — every `GET`. **editor** — viewer + create projects, change a project/routes/cases/presets/components, publish, deploy/rollback, delete versions, flush cache, import a project. **owner** — editor + delete a project, rename/delete the workspace, manage members. Roles are per workspace; there is no instance-wide admin.

### 1.4 Cursor pagination

Every list endpoint returns `{ "items": T[], "nextCursor": string | null }`.

- **Paginated** lists (`projects.list`, `versions.list`, `deployments.list`, `requests.list`) accept `?limit=` (integer 1–200, default 50) and `?cursor=` (opaque string from a previous `nextCursor`). Order is by `(createdAt, id)` in the direction stated per endpoint; ties on `createdAt` broken by `id`. `nextCursor` is `null` on the last page. A malformed cursor → `400 invalid_cursor`. Cursors are opaque: clients never construct or parse them.
- **Unpaginated** lists (workspaces, members, routes, cases, presets) always return everything with `nextCursor: null`, and ignore `limit`/`cursor`. Their order is stated per endpoint.

### 1.5 PATCH semantics

`PATCH` is a partial update of one resource (JSON body, object).

- An **absent** key is left untouched. An **explicit `null`** clears the field, and is only legal for fields marked *nullable* in the endpoint's table; `null` on any other field → `422 validation_failed`.
- `{}` is a valid no-op: `200` with the unchanged resource, `updatedAt` not bumped.
- **Merge depth:** `settings` merges per key (one level: send `{"settings":{"mode":"seeded"}}` to change only `mode`). Every other object or array field — `headers`, `schema`, `components`, `rules` — is **replaced wholesale**.
- Unknown keys → `422 validation_failed`. Fields marked *read-only* (ids, slugs where immutable, timestamps, computed counts) → `422` with issue code `read_only`.
- **Concurrency:** v1 is last-write-wins. `If-Match`/ETag is reserved for a later additive change; clients must not send it.

### 1.6 Session cookie

| Property | Value |
| --- | --- |
| Name | `mockbench_session` |
| Value | 32 random bytes, base64url. Opaque; only an HMAC-SHA-256 of it (keyed by `SESSION_SECRET`) is stored (`sessions.token_hash`) |
| Attributes | `HttpOnly; SameSite=Lax; Path=/` |
| `Secure` | **absent by default** (plain HTTP on a LAN IP must work). Present only when env `COOKIE_SECURE=true` |
| `Domain` | **never set** (host-only cookie) |
| Lifetime | `Max-Age` = `SESSION_TTL_DAYS` (default 30). Sliding: the server extends `expires_at` and re-sends the cookie at most once per hour of activity |
| Set by | `auth.register`, `auth.login` |
| Cleared by | `auth.logout` (`Max-Age=0`), `auth.changePassword` (other sessions revoked, current one kept) |
| Invalid / expired / revoked | `401 unauthenticated`, and the response clears the cookie |

Rate limits: control plane **100 requests/minute per session** (unauthenticated requests are keyed by client IP); `auth.login` and `auth.register` **10/minute per client IP**. Client IP comes from `X-Forwarded-For` set by the web container's nginx (`TRUST_PROXY=1`).

### 1.7 Shared field rules

| Field | Rule |
| --- | --- |
| `slug` (project) | `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–40 chars, not reserved. **Reserved:** `api`, `mock`, `health`, `static`, `assets`, `admin`. Globally unique. **Immutable after creation** (D6) |
| `slug` (workspace) | same pattern, 2–40 chars, no reserved list. Globally unique. Immutable |
| `name` (workspace/project/preset) | 1–80 chars after trim |
| `description` | ≤ 500 chars; nullable |
| `email` | valid address, ≤ 254 chars, compared case-insensitively |
| `password` | 8–128 chars |
| route `method` | `GET` `POST` `PUT` `PATCH` `DELETE` |
| route `path` | Starts with `/`, ≤ 200 chars. Segments `/`-separated, none empty, no trailing `/` (except the root path `/`). A segment is static `[A-Za-z0-9._~-]+` or a param `:name` where `name` is `[A-Za-z_][A-Za-z0-9_]{0,39}`. Param names unique within the path. No `?`, `#`, `*`, no regex syntax |
| route collision | Two routes in a project may not share `method` + **normalised path**: static segments lowercased, every `:name` replaced by `{}`. `/Users/:id` ≡ `/users/:userId` ≡ `/users/{}` |
| case `name` | 1–60 chars after trim, no control characters, unique per route **case-insensitively** |
| case `statusCode` | one of `200 201 202 204 400 401 403 404 409 422 429 500 502 503` |
| case `delayMs` | integer 0–10 000, nullable. `null` = inherit project `defaultDelayMs`; `0` = explicitly none |
| case `headers` | `Record<string,string>`, ≤ 20 entries. Name `^[A-Za-z0-9-]{1,64}$`, value ≤ 1000 chars, no CR/LF. **Forbidden names** (issue code `reserved_header`): `content-length`, `transfer-encoding`, `connection`, `keep-alive`, `upgrade`, `host`, `te`, `trailer`, `proxy-*`, `x-mock-*`, `access-control-*` |
| `schema` | A MockSchema envelope (§2) that passes the `schema-core` validator including its limits. Failures are `422 validation_failed` with the validator's issue codes (`depth_exceeded`, `node_limit_exceeded`, `array_count_exceeded`, `leaf_limit_exceeded`, `unknown_ref`, `ref_cycle`, `duplicate_key`, `unsupported_schema_version`, …) |
| component names | `^[A-Za-z][A-Za-z0-9_]{0,63}$`, ≤ 100 per project |

---

## 2. Shared types

Written in TypeScript notation. The authoritative definitions are the Zod schemas in `packages/api-contract` (resource types) and `packages/schema-core` (MockSchema types).

```ts
type Id = string                      // UUID v7
type Timestamp = string               // ISO-8601 UTC, ms, 'Z'
type Role = 'owner' | 'editor' | 'viewer'
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type UserRef = { id: Id; name: string }
type User = { id: Id; email: string; name: string; createdAt: Timestamp }

type Workspace = { id: Id; name: string; slug: string; role: Role /* the caller's */; createdAt: Timestamp; updatedAt: Timestamp }
type Member = { id: Id /* membership id */; userId: Id; email: string; name: string; role: Role; createdAt: Timestamp }

type ProjectSettings = {
  indexing: 'local' | 'path'            // default 'local'
  mode: 'deterministic' | 'seeded' | 'random'   // default 'deterministic'
  cors: '*' | 'off'                     // default '*'
  defaultDelayMs: number                // integer 0..10000, default 0
}
type MockSchemaEnvelope = { version: 1; components: Record<string, MockNode>; root: MockNode }   // schema-core
type Project = {
  id: Id; workspaceId: Id; name: string; slug: string; description: string | null
  settings: ProjectSettings
  components: Record<string, MockNode>  // project-level `ref` targets  ⁺
  activeVersion: { id: Id; label: string; deployedAt: Timestamp } | null
  routeCount: number; caseCount: number
  createdAt: Timestamp; updatedAt: Timestamp
}

type CaseSummary = { id: Id; name: string; statusCode: number; isDefault: boolean }
type Route = {
  id: Id; projectId: Id; method: Method; path: string; description: string | null
  cases: CaseSummary[]                  // sorted by sortOrder; the editor's case tabs  ⁺
  createdAt: Timestamp; updatedAt: Timestamp
}
type ResponseCase = {
  id: Id; routeId: Id; name: string; statusCode: number
  schema: MockSchemaEnvelope; headers: Record<string, string>
  delayMs: number | null; isDefault: boolean
  createdAt: Timestamp; updatedAt: Timestamp
}

type PresetRule = {
  match: { key?: string; path?: string; type?: string }   // ≥1 present
  // exactly one of:
  value?: unknown; values?: unknown[]; pattern?: string
}
type Preset = { id: Id; projectId: Id; name: string; rules: PresetRule[]; isEnabled: boolean; priority: number; createdAt: Timestamp; updatedAt: Timestamp }

type VersionSummary = {
  id: Id; projectId: Id; seq: number; label: string; notes: string | null
  createdBy: UserRef | null; createdAt: Timestamp
  routeCount: number; caseCount: number; bakedBytes: number; isActive: boolean
}
type Snapshot = {
  schemaVersion: 1; generatorVersion: number                  // Δ generatorVersion added
  project: { id: Id; slug: string; settings: ProjectSettings; components: Record<string, MockNode> }   // Δ id, components added
  routes: { id: Id; method: Method; path: string; description: string | null
            cases: { id: Id; name: string; statusCode: number; headers: Record<string,string>
                     delayMs: number | null; isDefault: boolean; schema: MockSchemaEnvelope }[] }[]   // Δ statusCode (DESIGN says `status`)
  presets: { id: Id; name: string; priority: number; rules: PresetRule[] }[]                         // enabled presets only
}
type Version = VersionSummary & { snapshot: Snapshot }        // baked payloads are never returned
type Deployment = { id: Id; projectId: Id; versionId: Id | null; versionLabel: string; deployedAt: Timestamp; deployedBy: UserRef | null }

type RequestLogEntry = {
  id: Id; projectId: Id; createdAt: Timestamp
  method: string; path: string; query: Record<string, string | string[]>
  statusCode: number; durationMs: number
  routePattern: string | null; caseName: string | null     // denormalised at write time
  versionId: Id | null; versionLabel: string | null
  mockError: string | null                                  // set when the *mock server* generated the response
  requestHeaders: Record<string, string>                    // authorization, cookie, proxy-authorization, x-api-key, set-cookie values replaced by "[redacted]"
  ip: string | null
}

type ProjectExport = {                                      // §3.11. No ids. Stable key order.
  formatVersion: 1
  project: { name: string; slug: string; description: string | null; settings: ProjectSettings; components: Record<string, MockNode> }
  presets: { name: string; rules: PresetRule[]; isEnabled: boolean; priority: number }[]
  routes: { method: Method; path: string; description: string | null
            cases: { name: string; statusCode: number; schema: MockSchemaEnvelope; headers: Record<string,string>; delayMs: number | null; isDefault: boolean }[] }[]
}

type Change = { field: string; before: unknown; after: unknown }
type SchemaChange = { path: string /* "$.address.city", arrays as "[*]" */; kind: 'added' | 'removed' | 'changed'; before?: unknown; after?: unknown }
type VersionDiff = {
  from: { id: Id; label: string }; to: { id: Id; label: string }
  settings: Change[]
  components: { added: string[]; removed: string[]; changed: string[] }
  presets: { added: string[]; removed: string[]; changed: string[] }          // by preset name
  routes: {
    added: { method: Method; path: string }[]
    removed: { method: Method; path: string }[]
    changed: { method: Method; path: string; fields: Change[]
               cases: { added: { name: string; statusCode: number }[]
                        removed: { name: string; statusCode: number }[]
                        changed: { name: string; fields: Change[]; schema: SchemaChange[] }[] } }[]
  }
}
```

Route identity in a diff is `method` + normalised path; case identity is the case name (case-insensitive).

---

## 3. Control-plane endpoints

Format: **`id` — METHOD path** · Auth · Request · Response · Errors (endpoint-specific, in addition to the global codes and the auth legend's implicit ones).

### 3.1 System

| `id` | Endpoint | Auth | Response | Errors |
| --- | --- | --- | --- | --- |
| `system.instance` ⁺ | `GET /instance` | public | `200 { name: "Mockbench", version: string, allowSignup: boolean, setupRequired: boolean }`. `setupRequired` is true while zero users exist (registration is then open regardless of `ALLOW_SIGNUP`). Lets the login screen decide what to show | — |
| `system.healthz` | `GET /healthz` and `GET /api/v1/healthz` | public | `200 { status: "ok" }`. Liveness only | — |
| `system.readyz` | `GET /readyz` and `GET /api/v1/readyz` | public | `200 { status: "ok", db: "up" }` | `503 not_ready` (database unreachable) |
| `system.openapi` | `GET /api/v1/openapi.json` | public | `200` OpenAPI 3.1 document generated from the registry. Covers the control plane only | — |

`/healthz` and `/readyz` at the root exist for container healthchecks; the `/api/v1/…` aliases exist because the web container only proxies `/api` and `/mock`.

### 3.2 Auth

| `id` | Endpoint | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `auth.register` | `POST /auth/register` | public | `{ email, password, name }` | `201 AuthState` + `Set-Cookie` | `403 signup_disabled` (users exist and `ALLOW_SIGNUP=false`) · `409 email_taken` · `429` |
| `auth.login` | `POST /auth/login` | public | `{ email, password }` | `200 AuthState` + `Set-Cookie` (any existing session cookie on the request is revoked) | `401 invalid_credentials` (unknown email, wrong password **and** deactivated account — indistinguishable) · `429` |
| `auth.logout` | `POST /auth/logout` | public | none | `204` + clearing `Set-Cookie`. Idempotent: no or stale session is still `204` | — |
| `auth.me` | `GET /auth/me` | session | — | `200 AuthState` | — |
| `auth.changePassword` ⁺ | `POST /auth/password` | session | `{ currentPassword, newPassword }` | `204`. All of the user's *other* sessions are revoked | `403 wrong_password` |

```ts
type AuthState = { user: User; workspaces: Workspace[] }    // workspaces carry the caller's role
```

Registration rules (D3): the **first** user ever registered becomes `owner` of the workspace `{ name: "Default", slug: "default" }` — joining it if it already exists with no members (the demo seed creates it), otherwise creating it. Every later registrant is created **with no workspace**; an owner adds them by email (`members.add`) or they create their own (`workspaces.create`).

### 3.3 Workspaces

| `id` | Endpoint | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `workspaces.list` | `GET /workspaces` | session | — | `200 { items: Workspace[], nextCursor: null }` — only the caller's, ordered by `name` asc | — |
| `workspaces.create` | `POST /workspaces` | session | `{ name, slug? }` (slug derived from name when omitted; collisions get a numeric suffix only in the derived case) | `201 Workspace` (caller is `owner`) | `409 slug_taken` (explicit slug only) |
| `workspaces.get` ⁺ | `GET /workspaces/:workspaceId` | viewer | — | `200 Workspace` | — |
| `workspaces.update` ⁺ | `PATCH /workspaces/:workspaceId` | owner | `{ name? }` (`slug` read-only) | `200 Workspace` | — |
| `workspaces.delete` ⁺ | `DELETE /workspaces/:workspaceId` | owner | — | `204` | `409 workspace_not_empty` (still has projects) |
| `members.list` | `GET /workspaces/:workspaceId/members` | viewer | — | `200 { items: Member[], nextCursor: null }` ordered by `createdAt` asc | — |
| `members.add` | `POST /workspaces/:workspaceId/members` | owner | `{ email, role }` — the user must already exist | `201 Member` | `404 user_not_found` · `409 already_member` |
| `members.update` | `PATCH /workspaces/:workspaceId/members/:memberId` | owner | `{ role? }` | `200 Member` | `409 last_owner` (would leave the workspace with no owner) |
| `members.remove` | `DELETE /workspaces/:workspaceId/members/:memberId` | owner, **or any member removing their own membership** | — | `204` | `409 last_owner` |

### 3.4 Projects

| `id` | Endpoint | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `projects.list` | `GET /projects?workspaceId=<id>&limit&cursor` | viewer of `workspaceId` | `workspaceId` **required** | `200 { items: Project[], nextCursor }` ordered by `createdAt` **asc** | `400 invalid_cursor` |
| `projects.create` | `POST /projects` | editor of `workspaceId` | `{ workspaceId, name, slug, description?, settings? }` (`settings` partial; defaults fill the rest) | `201 Project` | `409 slug_taken` · `422 slug_reserved` |
| `projects.getBySlug` ⁺ | `GET /projects/by-slug/:slug` | viewer | — | `200 Project` | — (`404 not_found` also when the caller is not a member of the owning workspace) |
| `projects.get` | `GET /projects/:projectId` | viewer | — | `200 Project` | — |
| `projects.update` | `PATCH /projects/:projectId` | editor | `{ name?, description? (nullable), settings?, components? }`. `slug`, `workspaceId` read-only | `200 Project` | — |
| `projects.delete` | `DELETE /projects/:projectId` | **owner** | — | `204`. Cascades routes, cases, presets, versions, deployments, request logs; evicts the data-plane cache | — |

`projects.update` with `components` validates every component against `schema-core` and rejects a change that would leave a stored case with an unresolved `ref` (`422 validation_failed`, issue code `component_in_use`). Changing `settings` or `components` affects only the **next publish** (D7): live data-plane behaviour comes from the deployed version's snapshot.

### 3.5 Presets

| `id` | Endpoint | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `presets.list` | `GET /projects/:projectId/presets` | viewer | — | `200 { items: Preset[], nextCursor: null }` ordered by `priority` desc, `createdAt` asc | — |
| `presets.create` | `POST /projects/:projectId/presets` | editor | `{ name, rules, isEnabled?=true, priority?=0 }` | `201 Preset` | — |
| `presets.update` | `PATCH /presets/:presetId` | editor | `{ name?, rules?, isEnabled?, priority? }` | `200 Preset` | — |
| `presets.delete` | `DELETE /presets/:presetId` | editor | — | `204` | — |

`rules` is validated by the `schema-core` preset validator: each rule has ≥1 of `match.key | match.path | match.type` and exactly one of `value | values | pattern`; `pattern` uses `{n}`, `{n:0N}`, `{key}`. Preset export/import is client-side JSON (a download of `{ name, rules, priority }` and a `presets.create` call) — no dedicated endpoint.

### 3.6 Routes

| `id` | Endpoint | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `routes.list` | `GET /projects/:projectId/routes` | viewer | — | `200 { items: Route[], nextCursor: null }` ordered by `sortOrder` asc (creation order; no reorder endpoint in v1) | — |
| `routes.create` | `POST /projects/:projectId/routes` | editor | `{ method, path, description? }`. Also creates one default case `{ name: "OK", statusCode: 200, schema: empty-object envelope, headers: {}, delayMs: null }` in the same transaction | `201 Route` | `409 route_conflict` (details: `[{ routeId }]` of the existing route) |
| `routes.get` | `GET /routes/:routeId` | viewer | — | `200 Route` | — |
| `routes.update` | `PATCH /routes/:routeId` | editor | `{ method?, path?, description? (nullable) }` | `200 Route` | `409 route_conflict` |
| `routes.delete` | `DELETE /routes/:routeId` | editor | — | `204` (cascades cases) | — |
| `routes.duplicate` | `POST /routes/:routeId/duplicate` | editor | `{ method?, path? }`. When both are omitted the server derives a free path: same method; append `-copy` to a static last segment, or `/copy` when the last segment is a param; then `-copy-2`, `-copy-3`, … until unique | `201 Route` (a deep copy of every case; the default case stays default) | `409 route_conflict` (explicit `method`/`path` collide) |

The empty-object envelope is `{ "version": 1, "components": {}, "root": { "type": "object", "fields": [] } }`.

### 3.7 Cases

| `id` | Endpoint | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `cases.list` | `GET /routes/:routeId/cases` | viewer | — | `200 { items: ResponseCase[], nextCursor: null }` ordered by `sortOrder` asc | — |
| `cases.create` | `POST /routes/:routeId/cases` | editor | `{ name, statusCode, schema?, headers?, delayMs?, isDefault? }`. `schema` defaults to the empty-object envelope. `isDefault: true` atomically demotes the previous default | `201 ResponseCase` | `409 case_name_taken` |
| `cases.get` | `GET /cases/:caseId` | viewer | — | `200 ResponseCase` | — |
| `cases.update` | `PATCH /cases/:caseId` | editor | `{ name?, statusCode?, schema?, headers?, delayMs? (nullable) }`. `isDefault` is read-only here (use `cases.setDefault`) | `200 ResponseCase` | `409 case_name_taken` |
| `cases.delete` | `DELETE /cases/:caseId` | editor | — | `204` | `409 case_is_default` (a default case cannot be deleted — make another case the default first; therefore a route's last case can never be deleted) |
| `cases.setDefault` | `POST /cases/:caseId/default` | editor | none | `200 ResponseCase` (now default; previous default demoted in one transaction). Idempotent | — |

A `204` case ignores any body schema: its payload is empty and no body is sent.

### 3.8 Schema helpers (stateless — no database access)

| `id` | Endpoint | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `schema.infer` | `POST /schema/infer` | session | `{ sample: <any JSON value> }` | `200 { schema: MockSchemaEnvelope, warnings: { path: string, code: string, message: string }[] }` (rules from DESIGN § Inferring a schema) | `422 validation_failed` with issue code `depth_exceeded` / `node_limit_exceeded` when the sample exceeds the MockSchema limits |
| `schema.preview` | `POST /schema/preview` | session | `{ schema: MockSchemaEnvelope, settings?: Partial<ProjectSettings>, components?: Record<string, MockNode>, presets?: { rules: PresetRule[], priority?: number }[], projectId?: Id }` (`projectId` feeds UUID v5 generation; default is the all-zero UUID) | `200 { json: string, generatorVersion: number }` — `json` is the generated body serialised with 2-space indent, **key order preserved** | `422 validation_failed` (schema invalid or over limits) |

The browser normally calls `schema-core` directly; these endpoints exist for API consumers and tests.

### 3.9 Versions, deploy, cache

| `id` | Endpoint | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `versions.list` | `GET /projects/:projectId/versions` | viewer | — | `200 { items: VersionSummary[], nextCursor }` ordered by `createdAt` **desc** | `400 invalid_cursor` |
| `versions.publish` | `POST /projects/:projectId/versions` | editor | `{ label?, notes? }`. `label` 1–80 chars, free text; default `v<seq>` where `seq` is the project's next sequence number. Publishing does **not** deploy | `201 Version` | `409 label_taken` · `422 empty_project` (no routes) · `422 publish_invalid` — details: `{ routeId, method, path, caseId, caseName, issues: ValidationIssue[] }[]`, one per offending case; no version is created |
| `versions.get` | `GET /versions/:versionId` | viewer | — | `200 Version` (with `snapshot`) | — |
| `versions.delete` | `DELETE /versions/:versionId` | editor | — | `204` | `409 version_active` · `409 version_referenced` (a retained request-log row still references it) |
| `versions.diff` | `GET /versions/:fromId/diff/:toId` | viewer of both (must be the same project) | — | `200 VersionDiff` | `422 versions_different_projects` |
| `deploy.create` | `POST /projects/:projectId/deploy` | editor | `{ versionId }` | `200 Deployment`. Sets `active_version_id`, appends a `deployments` row, evicts the data-plane cache entry. Rollback is the same call with an older id. Deploying the version that is already active is a no-op: `200` with the latest existing `Deployment`, no new row | `404 version_not_found` (also when it belongs to another project) |
| `deployments.list` | `GET /projects/:projectId/deployments` | viewer | — | `200 { items: Deployment[], nextCursor }` ordered by `createdAt` **desc** | `400 invalid_cursor` |
| `cache.flush` | `POST /projects/:projectId/cache/flush` | editor | none | `204`. Drops the project's cache entry and slug index on this instance | — |

### 3.10 Request log

| `id` | Endpoint | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `requests.list` | `GET /projects/:projectId/requests` | viewer | Query: `limit`, `cursor`, plus filters (all optional, ANDed): `status` (`200`, or a class `2xx`/`4xx`/`5xx`), `method`, `path` (case-insensitive substring), `since` (timestamp), `mockError` (`true` = only mock-server-generated responses) | `200 { items: RequestLogEntry[], nextCursor }` ordered by `createdAt` **desc** | `400 invalid_cursor` |

Retention (env `LOG_RETENTION_DAYS`=7, `LOG_RETENTION_ROWS`=1000 per project; whichever removes more) is applied by a job inside the api process.

### 3.11 Project export / import

| `id` | Endpoint | Auth | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `projects.export` | `GET /projects/:projectId/export` | viewer | — | `200 ProjectExport` with `Content-Disposition: attachment; filename="<slug>.mockbench.json"`. Key order is fixed (as declared in §2); routes in `sortOrder`, cases in `sortOrder`. Contains the **draft** and presets, never versions or ids | — |
| `projects.import` | `POST /projects/import` | editor of `workspaceId` | `{ workspaceId, document: ProjectExport, slug?, name? }` — `slug`/`name` override the document's. Creates the project, presets, routes and cases in one transaction, minting new ids | `201 Project` | `409 slug_taken` · `422 import_invalid` — details: `ValidationIssue[]` (schema failures and route-collision issues; nothing is created) · `422 slug_reserved` |

`POST /projects/import` is registered before `POST /projects/:projectId/...` routes; `import` is not a UUID so it never collides with `:projectId`.

---

## 4. Data plane

`ANY /mock/:slug/*` — unauthenticated, no body validation, read-only. Mounted on the same origin and port as the SPA (web container proxies `/mock/` to the api). Not in the OpenAPI document.

### 4.1 Lifecycle (in order)

1. **`OPTIONS`** is answered first, before slug resolution and route matching. See §4.4.
2. **Resolve the project** by slug from an in-process slug index (never a DB query on the hot path once warm). Unknown slug → `404 project_not_found`.
3. **Load the live version** from the in-process cache. Project has no active version → `503 project_not_published`.
4. **Match** method + path against the version's radix tree. `HEAD` matches the `GET` route and sends no body. A static segment beats a param (`/users/me` over `/users/:id`). Matching is **case-insensitive on static segments**, ignores a trailing slash and the query string, and params match one non-empty segment. No match → `404 route_not_found` listing the routes that exist.
5. **Select the case** (§4.2). Not found → `400 case_not_found` listing available names.
6. **Delay:** wait `case.delayMs ?? snapshot.project.settings.defaultDelayMs`.
7. **Respond** (§4.3). In `random` mode the body is generated here instead of baked.
8. **Log** asynchronously after the response is flushed.

### 4.2 Case selection

First match wins; **no fall-through** — if a selector is present but matches nothing, the answer is `400 case_not_found`.

| Order | Selector | Matches |
| --- | --- | --- |
| 1 | request header `X-Mock-Case` | case `id`, or case `name` (trimmed, case-insensitive) |
| 2 | query parameter `__case` | same as above |
| 3 | request header `X-Mock-Status` | the first case (by `sortOrder`) whose `statusCode` equals it |
| 4 | — | the route's default case |

### 4.3 Response

- Status = case `statusCode`. Body = the baked JSON string (compact, key order = field order). A `204` case sends **no body**.
- `Content-Type: application/json; charset=utf-8` unless the case sets its own `Content-Type` header.
- Case headers are merged over the defaults. Reserved names were rejected at write time (§1.7).
- **Diagnostic headers on every mock response:** `X-Mock-Version: <version label>`, `X-Mock-Route: <method> <route pattern>`, `X-Mock-Case: <case name>`.
- **Hardening ⁺ (D9):** every data-plane response also carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox` so mock content, which is user-authored and served from the same origin as the editor, cannot script the editor.

### 4.4 CORS

Per-project `settings.cors` (frozen into the snapshot): `"*"` (default) or `"off"`.

- `"*"`: every response, **including mock-server errors and `OPTIONS`**, carries `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: X-Mock-Version, X-Mock-Route, X-Mock-Case, X-Mock-Error` plus the names of the case's custom headers. `OPTIONS` returns `204` with `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS`, `Access-Control-Allow-Headers` echoing `Access-Control-Request-Headers` (or `*` if absent), `Access-Control-Max-Age: 600`.
- `"off"`: no CORS headers on any response; `OPTIONS` returns `204` bare, so browser preflights fail (that is the feature).
- `OPTIONS` for an **unknown slug** or unpublished project is answered permissively, so the browser can then read the real `404`/`503` body.

### 4.5 Errors generated by the mock server itself

Every one carries `X-Mock-Error: true` and `Content-Type: application/json`, and has the body `{ "error": "<code>", "message": "<sentence>", "hint": "<what to do>" }`. A *mocked* error (a user-defined 404 or 500 case) never carries `X-Mock-Error`.

| Status | `error` | Extra body fields |
| --- | --- | --- |
| 404 | `project_not_found` | `slug` |
| 503 | `project_not_published` | `slug` |
| 404 | `route_not_found` | `routes: { method, path }[]` |
| 400 | `case_not_found` | `cases: { name, statusCode, isDefault }[]` |
| 429 | `rate_limited` | only when `MOCK_RATE_LIMIT` is set; `Retry-After` header |
| 500 | `mock_internal_error` | — (e.g. random-mode generation failure) |

### 4.6 Request log record

One `request_logs` row per request that reached a known project (unknown-slug requests are not logged). Sensitive request headers are redacted before storage (see `RequestLogEntry`). Logging failures never affect the response.
