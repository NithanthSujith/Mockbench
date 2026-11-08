# Mockbench — Design

Design reference for the Mockbench project. Source of truth for all specs and work units.

## Overview

A self-hosted mock API server: a team defines routes, response shapes and status codes in a web UI, publishes a version, and anyone on the network can call the resulting endpoints over plain HTTP. One `docker compose up` brings up the database, the API and the UI, with state persisted in a named volume.

The design below assumes Node 22 + TypeScript with Express on the backend, Postgres 16, React + Vite + TanStack on the frontend, workspace-scoped accounts, and path-prefixed mock URLs (`/mock/<project-slug>/...`) — the four choices you made.

**There is no hosted version, and there is not going to be one.** This is a tool you clone and run yourself — on a laptop, or on one box on your office LAN that the whole team points at. Everything below follows from that: no billing, no quotas, no telemetry, no outbound calls at runtime, and a threat model that assumes a trusted private network rather than the public internet.

**Who it is for.** Frontend and mobile developers blocked on a backend that does not exist yet; QA engineers who need a 401 or a 500 on demand; integration teams who have an OpenAPI spec but no running service.

**Goals**

1. Define a route (method + path) and one or more response cases (status code + body shape) entirely through the UI, with no code and no config file.
2. Build a response body two ways — a visual key/type builder or pasted JSON — both producing the same internal format. Importing an OpenAPI spec is a third route, deferred past v1.
3. Generate predictable, readable sample data from the shape alone, so a field named `role` returns `role-1` and never a random word a developer has to decode.
4. Snapshot a project into an immutable version and choose which version is live, with instant rollback.
5. Run entirely offline on one machine, one command, with state surviving a container restart.

**Non-goals for v1.** Each of these is a real request you will get; saying no now keeps the data model small.

| Not in v1 | Why | Revisit |
| --- | --- | --- |
| Stateful mocks (a POST that makes a later GET return the new record) | Needs a per-consumer store, TTLs and reset semantics; roughly doubles runtime complexity | v2, as an opt-in stateful route type |
| Matching a case on request body or query values | Case selection by header covers most of the need at a fraction of the cost | v1.1 |
| Proxy / record-and-replay against a real upstream | A different product shape; competes with mitmproxy and Mockoon | Later, if asked for |
| gRPC, GraphQL, WebSocket, SSE | Each needs its own schema model and transport | Not planned |
| Hosted multi-tenant SaaS | There is no hosted version. The project ships as something you run yourself, and nothing in it phones home | Never |
| Scripting hooks (custom JS per response) | Powerful, but turns a declarative tool into a sandbox-security problem | Only with a hard sandbox |

**Working name.** mockbench, mocksmith, apiforge, stubyard. Check npm, the GitHub org and the domain before committing — all four are plausible enough that at least one is probably taken.

## Object model

Six objects, nested: a **Workspace** owns **Projects**, a Project owns **Routes**, a Route owns **Response Cases**, and publishing a Project freezes all of it into a **Version** that a **Deployment** points at. Fix this vocabulary now — it shows up in the database, the API, the UI and the docs.

| Object | What it is | Key fields | Owned by |
| --- | --- | --- | --- |
| Workspace | A team boundary. Users belong to it with a role. | name, slug | — |
| User | An account. Belongs to one or more workspaces. | email, password hash, name | — |
| Project | One mock API. Its slug is the URL prefix. | name, slug, settings (CORS, default latency, generation mode) | Workspace |
| Route | Method + path pattern. The unit a consumer calls. | method, path, description | Project |
| Response Case | One possible answer for a Route: a status code and a body shape. | name, status code, schema, headers, delay, is\_default | Route |
| Version | An immutable snapshot of every Route and Case in a Project. | label, snapshot JSON, baked payloads, created\_by | Project |
| Deployment | The pointer that says which Version is live. | version\_id, deployed\_at, deployed\_by | Project |

**Why a Route has many Cases rather than one.** Your requirement — "if this is successful we can send 200 or 201, or they can make this an error and decide which error" — is exactly a one-to-many. `GET /users/:id` carries a `200 Found`, a `404 Not found` and a `500 Server error` side by side, each with its own schema. One is marked default; a caller picks a different one with a header (see *Mock serving runtime*).

**Why versions sit on the Project, not the Route.** You asked to pick "the response version to make live". Versioning each route's schema separately sounds lighter, but it means a consumer can hit a half-upgraded API — route A on v3 and route B still on v1 — which is the exact bug a mock server exists to rule out. A Project-level snapshot gives one coherent API surface, one thing to roll back, and a shareable "we are on v4" between frontend and backend. The cost is that a one-field fix produces a new version number; that is cheap, and version labels can be free text.

**Path patterns.** A Route path is `/users/:id/orders/:orderId` — colon params, Express style. Params are matched and captured but, in v1, nothing in the response body reads them (see the request-derived values note under *Generation engine*). Two routes in a project cannot share the same method plus normalised path, where normalisation replaces every param name with a placeholder: `/users/:id` and `/users/:userId` collide and the API rejects the second with a 409.

## Architecture and stack

&#91;embedded content: architecture · 4 containers, two request planes\]

One Node process serves two workloads that have almost nothing in common, and keeping them conceptually separate is the single most important structural decision here.

- **Control plane** (`/api/v1/*`) — authenticated, low traffic, write-heavy, rich validation. This is the editor talking to the database.
- **Data plane** (`/mock/:slug/*`) — unauthenticated, potentially high traffic, read-only, and must answer in single-digit milliseconds. It reads an in-memory cache of the live version and, in the common case, touches the database not at all.

They ship in the same container (one less thing to run) but live in separate Express routers mounted on one app, with their own middleware stacks, error handlers and logging. Splitting them into two processes later is then a packaging change, not a rewrite.

### Stack

| Layer | Choice | Why this one |
| --- | --- | --- |
| Runtime | Node 22 LTS, TypeScript 5.x, ESM | Your pick; same language end to end, so the schema and generator code is shared verbatim with the browser |
| HTTP framework | Express 5 | Plain Express on plain Node, no framework layered on top. It is the HTTP layer every Node developer already knows, which matters more for a tool people fork and modify than raw throughput does. Express 5, not 4 — it handles async handler errors natively, which the two error-handling trees rely on. No NestJS. The honest trade-off: a faster router would win microseconds per request, but the data plane writes a pre-baked string to the socket, so the framework is nowhere near the bottleneck |
| Database | PostgreSQL 16 | `jsonb` for schemas and baked payloads, with real indexing and constraints. SQLite is tempting for a single-binary story but gives up `jsonb` operators and concurrent writes |
| Query layer | Drizzle ORM + drizzle-kit migrations | SQL-shaped, tiny runtime, migrations are plain checked-in SQL. Prisma is the alternative — better DX, but a heavier image and a generated client in the build |
| Validation | Zod 4 (ADR 0016), in a shared package | One schema definition validates the API request, types the TypeScript, and powers the browser-side form validation |
| Auth | Argon2id password hash, opaque session token in an httpOnly cookie, sessions table in Postgres | Revocable on logout, no JWT expiry/refresh dance, and it is the right default for a self-hosted tool. JWT only becomes worth it if the data plane ever needs to verify tokens without a DB hit |
| Cache / fan-out | None in v1 | A single api container holds the live version in process memory. For multiple replicas, use Postgres `LISTEN`/`NOTIFY` on publish rather than adding a Redis container — fewer moving parts for a tool people self-host |
| Frontend | React 19 + Vite + TanStack Router / Query / Table / Form, Tailwind, shadcn/ui | Your pick. Served as static files by nginx |
| Logging | pino, JSON to stdout | Docker-native; no log files, no volume |

### The shared package is the heart of it

`packages/schema-core` holds the MockSchema type, its Zod validator and the data generator — and is imported by **both** the API and the browser. The payoff: the schema builder shows a live preview of the exact JSON the server will return, computed locally with zero network round-trips, and there is no second implementation to drift. Treat this package as the project's public contract and version it carefully.

## Data model

Eleven tables (`deployments` added: DESIGN specified a deploy history but gave it no table; PLAN D10). Every id is a UUID v7 (time-sortable, so it indexes like a sequence but is safe to expose); PostgreSQL 16 has no `uuidv7()`, so a `uuid_v7()` SQL function is the column default. Every table carries `created_at` and `updated_at` as `timestamptz` **except** the immutable or append-only tables (`versions`, `deployments`, `request_logs`), which carry `created_at` only.

| Table | Columns beyond id and timestamps | Notes |
| --- | --- | --- |
| `users` | email (citext, unique), password\_hash, name, is\_active | Argon2id hash |
| `sessions` | user\_id, token\_hash, expires\_at, last\_used\_at, user\_agent, ip | Opaque token; only an HMAC of it (keyed by `SESSION_SECRET`) is stored |
| `workspaces` | name, slug (unique) |  |
| `workspace_members` | workspace\_id, user\_id, role (owner / editor / viewer) | Composite unique on (workspace\_id, user\_id) |
| `projects` | workspace\_id, name, slug (unique globally, immutable), description, settings jsonb, components jsonb, version\_seq, active\_version\_id | The global slug uniqueness is what makes `/mock/<slug>` unambiguous |
| `routes` | project\_id, method, path, normalized\_path, description, sort\_order | Unique on (project\_id, method, normalized\_path) |
| `response_cases` | route\_id, name, status\_code, schema jsonb, headers jsonb, delay\_ms (nullable: null inherits the project default; 0 to 10000), is\_default, sort\_order | Partial unique index enforcing exactly one default per route; unique on (route\_id, lower(name)) |
| `data_presets` | project\_id, name, rules jsonb, is\_enabled, priority | Predefined values, see *Generation engine* |
| `versions` | project\_id, seq, label, notes, snapshot jsonb, baked **text** (a JSON map of baked bodies; a string so serving needs no re-serialisation), route\_count, case\_count, snapshot\_bytes, baked\_bytes, created\_by | Immutable after insert; unique on (project\_id, seq) and (project\_id, label) |
| `deployments` | project\_id, version\_id (set null on version delete), version\_label, deployed\_by | The deploy history; append-only |
| `request_logs` | project\_id, version\_id (restrict), method, path, matched\_route\_id and matched\_case\_id (plain ids, no foreign key), route\_pattern, case\_name, mock\_error, status\_code, duration\_ms, request\_headers jsonb (sensitive values redacted), query jsonb, ip | Append-only, pruned on a schedule; unknown-slug requests are not logged |

### Constraints worth writing down

- `projects.active_version_id` is a nullable FK to `versions` with `ON DELETE SET NULL`. A project with no active version returns `503` from the data plane with a message saying it has not been published yet — a far better developer experience than a bare 404.
- Exactly one default case per route: `CREATE UNIQUE INDEX ON response_cases (route_id) WHERE is_default;`
- `routes.normalized_path` is a generated/trigger-maintained column: `/users/:id/orders/:oid` becomes `/users/{}/orders/{}`. It is what the uniqueness constraint and the collision check run against.
- `versions` cannot be updated: a trigger raises on any `UPDATE`, whatever role issues it. The one permitted change is `created_by` going from a user id to `NULL`, which is what `ON DELETE SET NULL` performs when that user is deleted. Changing a published version is the one thing that would quietly break a consumer, so it is structurally impossible rather than a code convention.
- `request_logs.version_id` is `ON DELETE RESTRICT`: a version still referenced by retained log rows cannot be deleted, which is exactly the "never delete a referenced version" rule. Deleting a version that was ever deployed keeps its `deployments` rows (`version_id` becomes null, `version_label` remains).
- `response_cases.status_code` is constrained to a curated list in v1 — 200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503 — matching your "limit this to a few". Widen it to `CHECK (status_code BETWEEN 100 AND 599)` when someone asks; the UI keeps the curated list as the dropdown and offers an "other" field.

### Indexes

`projects(slug)`, `routes(project_id)`, `response_cases(route_id)`, `versions(project_id, created_at DESC)`, `request_logs(project_id, created_at DESC)`, `sessions(token_hash)`. The data plane does not query any of these on the hot path — it reads from the in-process cache — so these serve the editor and the logs view.

### Retention

`request_logs` grows without limit otherwise. Keep the last 1,000 rows per project or 7 days, whichever is smaller, pruned by a `pg_cron`-free approach: a small interval job inside the api process, since adding a scheduler container for one `DELETE` is not worth it. Both numbers are env-configurable.

## MockSchema: the one internal format

Both authoring routes — the visual builder and pasted JSON — compile to the same tree, called **MockSchema**. Nothing downstream knows or cares which route produced it. If you get this format right, the rest of the project is plumbing.

It is deliberately *not* JSON Schema. JSON Schema is a validation language with `allOf`, `patternProperties` and recursion; this is a generation language, and it needs an ordered field list (so the builder UI and the output key order are stable) and semantic types like `email` that JSON Schema only expresses as a loose `format` hint.

### Node types

| Type | Extra attributes | Generates |
| --- | --- | --- |
| `string` | — | `"<key>-<n>"` |
| `number` | `min`, `max` | a decimal |
| `integer` | `min`, `max` | an integer |
| `boolean` | — | `true` / `false` |
| `null` | — | `null` |
| `email` | — | `"<key>-<n>@example.com"` |
| `uuid` | — | a deterministic UUID v5 |
| `url` | — | `"https://example.com/<key>-<n>"` |
| `phone` | — | a +91 number in the reserved test range |
| `date` | — | `"YYYY-MM-DD"` |
| `datetime` | — | ISO 8601 with offset |
| `enum` | `values[]` | one of the values, picked by index |
| `object` | `fields[]` (ordered) | a nested object |
| `array` | `items` (a node), `count` (default 3) | a list |
| `ref` | `name` | whatever that named component generates |

Every node also accepts `nullable`, `description`, `fixed` (a literal that overrides generation entirely) and `examples[]` (a pool to cycle through by index). `fixed` is detected by the presence of the key, so `""`, `0`, `false` and `null` are valid pins (PLAN D5). `nullable` is documentary in v1: generation never emits `null` because of it; pin `fixed: null` to force one. The root of a schema may be any node type, so a bare array response is valid (PLAN D2).

`array` + `items: { type: "object" }` is your "array of objects" — it needs no special case. `ref` exists so a `User` shape defined once can appear in `GET /users`, `GET /users/:id` and `POST /users` without being retyped; components live at the project level.

### Envelope and a worked example

```json
{
  "version": 1,
  "components": {},
  "root": {
    "type": "object",
    "fields": [
      { "key": "id",          "node": { "type": "uuid" } },
      { "key": "name",        "node": { "type": "string" } },
      { "key": "email",       "node": { "type": "email" } },
      { "key": "role",        "node": { "type": "string" } },
      { "key": "is_active",   "node": { "type": "boolean" } },
      { "key": "branch_list", "node": { "type": "array", "count": 3,
                                        "items": { "type": "string" } } },
      { "key": "address",     "node": { "type": "object", "fields": [
          { "key": "city",    "node": { "type": "string" } },
          { "key": "pincode", "node": { "type": "integer" } } ] } },
      { "key": "orders",      "node": { "type": "array", "count": 2,
          "items": { "type": "object", "fields": [
            { "key": "order_id", "node": { "type": "uuid" } },
            { "key": "total",    "node": { "type": "number" } } ] } } }
    ]
  }
}
```

That compiles to the response in the next section.

### Inferring a schema from pasted JSON

The "paste a JSON example" path walks the sample and guesses a node per value. Rules, in order:

1. `null` → `string` with `nullable: true`, flagged amber in the UI because the real type is unknowable.
2. A string matching an email, UUID, ISO date, ISO datetime or URL pattern → that semantic type; otherwise `string`.
3. A number with no fractional part → `integer`; otherwise `number`.
4. An array → infer from element 0, set `count` to the sample's length. If elements disagree in shape, take the union of keys, mark the differing ones `nullable` (MockSchema has no separate optional flag) with an `optional_key` warning, and warn.
5. An object → recurse, preserving key order.

Inference is a starting point, not an answer — the builder opens on the inferred tree so the user can correct `role` from `string` to `enum` before saving. Say so in the UI; silent wrong guesses are worse than visible ones.

### Limits

Depth capped at 10, total node count at 2,000, and `count` at 1,000 per array with a product cap of 50,000 generated leaves per response. Without these, one nested `count: 1000` inside another produces a million-element payload at publish time and the container gets OOM-killed.

## Generation engine

One rule produces every value: **`value = f(key, type, ordinal)`**, where `ordinal` is the 1-based position of the nearest enclosing array element, defaulting to 1. That is the whole thing. It is deterministic, it needs no seed, and it gives you exactly the behaviour you described — `role` becomes `role-1`, and a `branch_list` of three strings becomes `branch_list-1`, `branch_list-2`, `branch_list-3`.

The design value here is not realism, it is **legibility**. A developer looking at a response can read `address.city: "city-1"` and instantly know which field they are looking at in a nested payload. Faker-style output (`"Lake Gracielaview"`) looks better in a screenshot and is worse to debug against.

### The example from the previous section, generated

```json
{
  "id": "8c1f0e2a-5b43-5c9d-9f12-6a7b8c9d0e1f",
  "name": "name-1",
  "email": "email-1@example.com",
  "role": "role-1",
  "is_active": true,
  "branch_list": ["branch_list-1", "branch_list-2", "branch_list-3"],
  "address": { "city": "city-1", "pincode": 1 },
  "orders": [
    { "order_id": "3d4e5f60-...", "total": 1.5 },
    { "order_id": "7a8b9c0d-...", "total": 2.5 }
  ]
}
```

Note what `orders` does: the ordinal increments per element and flows down into every field of that element, so `total` is `1.5` then `2.5`. An object that is *not* inside an array inherits the ordinal of whatever contains it — `address.city` is `city-1` because the whole response is ordinal 1.

### Per-type rules

| Type | Value at ordinal `n` |
| --- | --- |
| `string` | `<key>-<n>` |
| `email` | `<key>-<n>@example.com` |
| `url` | `https://example.com/<key>-<n>` |
| `integer` | starts at `min` (default 1) and counts up with the ordinal, stopping at `max` |
| `number` | `n + 0.5`, offset from `min` when set |
| `boolean` | `n` is odd |
| `enum` | `values[(n - 1) mod values.length]` |
| `uuid` | UUID v5 over `projectId + JSON pointer + n` — stable across restarts and rebuilds |
| `date` | a fixed base date plus `n` days |
| `datetime` | the same, at 00:00:00+05:30 |
| `phone` | `+91 90000 0000<n>`, inside a reserved test range |
| `null` | `null` |

### Nested arrays and the indexing mode

An array inside an array element resets the ordinal by default — `users[2].tags` generates `["tags-1", "tags-2"]`, not `["tags-3", "tags-4"]`. This is `indexing: "local"`, the project default, and it keeps values short.

Set `indexing: "path"` on the project when uniqueness across the whole payload matters more than brevity, and the same field generates `["users-2-tags-1", "users-2-tags-2"]`. Expose this as one toggle in project settings with both outputs shown as examples; do not try to guess which one the user wants.

### Predefined data: precedence

Your "some predefined data that can be added" is two features, and both resolve through one ordered lookup. First match wins:

1. **`fixed`** on the node — a literal that always wins. Set in the builder with a "pin this value" control.
2. **A preset rule** matching this field (see below).
3. **`examples[]`** on the node — a pool cycled by ordinal, so a 3-element array walks the pool.
4. **`enum.values`** — cycled by ordinal.
5. **The per-type rule** from the table above.

### Presets

A preset is a named, project-scoped list of rules. It is what turns a generically correct mock into one that looks like your domain, without editing every field.

```json
{
  "name": "Alps defaults",
  "priority": 10,
  "rules": [
    { "match": { "key": "role" },              "values": ["admin", "manager", "viewer"] },
    { "match": { "key": "currency" },          "value": "INR" },
    { "match": { "path": "$.address.city" },   "values": ["Ahmedabad", "Mumbai", "Bengaluru"] },
    { "match": { "key": "*_id", "type": "string" }, "pattern": "ID-{n:05}" }
  ]
}
```

Match specificity decides, not list order: an exact `path` beats a `key` glob, which beats a bare `type`. Where two rules tie, higher `priority` wins, then the later rule. `pattern` supports `{n}`, `{n:0N}` for zero-padding and `{key}`.

Ship two presets in the box — an empty one and a small "realistic Indian B2B" set — and let users export and import them as JSON. That is the lightest possible path to community-contributed data packs.

### Generation modes

A project setting, because it changes the performance model:

| Mode | Behaviour | Baked at publish |
| --- | --- | --- |
| `deterministic` (default) | The rules above | Yes — the data plane serves a cached string |
| `seeded` | Values drawn from built-in word and name pools by a PRNG seeded from `projectId + JSON pointer` (not Faker: it is too large for the browser bundle and its output can change between versions; PLAN D4), so output looks realistic but never changes | Yes |
| `random` | The same pools driven by a fresh random source on every request | No — generated per request |

`random` is the mode that costs you: it disables baking, puts the generator on the hot path, and makes response assertions in a consumer's test suite flaky. Default to `deterministic` and put a one-line warning next to the `random` option.

### Request-derived values — deferred, but design for it now

The most common thing people will ask for after launch is "make the `id` in the body match the `:id` in the URL". The node shape that supports it is small:

```json
{ "key": "id", "node": { "type": "string", "source": { "from": "path", "name": "id" } } }
```

`from` would accept `path`, `query` and `header`. Leave it out of v1, but reserve the `source` key in the MockSchema format and make the generator ignore unknown keys rather than reject them — otherwise adding it later is a breaking schema migration across every stored version. Note that any route using it cannot be baked and falls back to per-request generation.

## Future improvement: OpenAPI import

**Deferred past v1. No work unit in the current plan builds this.** It is the largest bug surface in the project and the core loop does not need it. The design is recorded here so that nothing built now forecloses it. Two constraints on v1 work follow: MockSchema reserves the `source` key and its validator ignores unknown keys, so adding the importer later needs no migration across stored versions; and `/api/v1/openapi.json`, where this project publishes its own control-plane spec, is a separate feature that stays in v1.

Import is a two-phase operation: **parse and preview**, then **confirm**. Never write routes to the database straight off an upload. A real-world spec has a hundred operations, half of which the user does not want, and some of which collide with routes they already have.

**Phase 1 — `POST /api/v1/projects/:id/imports`** accepts a file upload or a URL, parses it, and returns a plan: every operation found, the status codes under it, the MockSchema each one compiled to, and a per-row verdict of `new`, `conflict` (a route with that method and normalised path exists) or `unsupported`. Nothing is persisted except the import record itself.

**Phase 2 — `POST /api/v1/imports/:importId/confirm`** takes the user's selection plus a conflict policy (`skip`, `replace`, or `keep-both-as-new-case`) and creates the routes and cases in one transaction.

### Supported inputs

OpenAPI 3.0.x and 3.1.x, JSON or YAML. Swagger 2.0 is converted up first with `swagger2openapi`. Parse and dereference with `@apidevtools/swagger-parser`, which resolves internal `$ref`s and validates the document; refuse external `$ref`s that point at a URL, since fetching them turns an upload into an outbound request from your server.

### JSON Schema to MockSchema

| In the spec | Becomes |
| --- | --- |
| `type: string` | `string` |
| `format: email` / `uuid` / `date` / `date-time` / `uri` | `email` / `uuid` / `date` / `datetime` / `url` |
| `enum: [...]` | `enum` with those values |
| `type: integer` / `number` | `integer` / `number`, carrying `minimum` and `maximum` |
| `type: boolean` | `boolean` |
| `type: object` + `properties` | `object`, field order taken from the spec's key order |
| `type: array` + `items` | `array`, `count: 3` |
| `$ref` to `components/schemas/X` | a `ref` node, with `X` added to the project's components |
| `nullable: true` (3.0) or `type: ["string", "null"]` (3.1) | `nullable: true` |
| `example` / `examples` on a schema | `fixed` / `examples[]` — the spec author's own sample data, which beats anything generated |
| `allOf: [...]` | the member objects merged, later keys winning |
| `oneOf` / `anyOf` | the **first** branch, with a warning row in the preview |

### Not supported, and what the user sees

`not`, `patternProperties`, `additionalProperties` as a schema, `discriminator`, and recursive `$ref` cycles. Each produces an `unsupported` row in the preview naming the operation and the construct, so the user knows what they are not getting rather than finding a silently empty object later. Recursive refs are cut at depth 5 and the node is marked.

Responses with no schema (a bare `204`, or a `content` block with only `text/plain`) import as a case with an empty body and the right status code — which is correct and useful, not a failure.

### Operation and status mapping

One spec operation becomes one Route. Each `responses` entry under it becomes one Response Case, named from the spec's `description` ("User not found") falling back to the status text. The lowest 2xx is marked default. `application/json` is the only content type read; if an operation has none, it still imports with an empty-body case.

The `servers` block is ignored. The mock's URL is always `/mock/<project-slug>` plus the spec's path, and trying to honour server base paths produces double prefixes more often than it helps. Say this in the preview header so nobody is surprised.

## Versioning and publishing

The `routes` and `response_cases` tables are always the **draft**. Editing them never changes what a consumer sees. Only `projects.active_version_id` does that, and it only changes when someone deploys.

This means a developer can refactor half the API at 11pm while a colleague's app keeps hitting v3 unchanged, which is the behaviour that makes a mock server trustworthy enough to point a CI suite at.

### Publish

`POST /api/v1/projects/:id/versions` runs four steps in one transaction:

1. **Validate** every case's schema against the MockSchema Zod validator and the depth/count limits. Any failure aborts the whole publish and returns a list of offending routes — never a partial version.
2. **Snapshot** — serialise the project settings, every route, every case and every enabled preset into one `jsonb` blob. The snapshot is self-contained: it resolves preset rules and `ref` components at this moment, so editing a preset later cannot retroactively change a published version.
3. **Bake** — unless the project is in `random` mode, run the generator over every case and store the resulting JSON string alongside the snapshot, keyed by `routeId:caseId`.
4. **Insert** into `versions` with an auto label (`v1`, `v2`, ...) that the user can override with free text (`v2-before-the-pricing-change`).

Publishing does **not** deploy. The two are separate so you can publish from CI and deploy by hand, and so rollback is a deploy of an older version rather than a re-publish.

### Snapshot shape

```json
{
  "schemaVersion": 1,
  "generatorVersion": 1,
  "project": { "id": "...", "slug": "billing-api", "settings": { "indexing": "local", "mode": "deterministic", "cors": "*", "defaultDelayMs": 0 }, "components": {} },
  "routes": [
    { "id": "...", "method": "GET", "path": "/invoices/:id",
      "cases": [
        { "id": "...", "name": "Found",     "statusCode": 200, "headers": {}, "delayMs": 0, "isDefault": true,  "schema": { } },
        { "id": "...", "name": "Not found", "statusCode": 404, "headers": {}, "delayMs": 0, "isDefault": false, "schema": { } }
      ] }
  ],
  "presets": [ ]
}
```

### Why bake

Baking turns the hot path from *walk a schema tree and build objects* into *look up a string and write it to the socket*. For a deterministic project the generated bytes cannot differ between calls, so computing them per request is pure waste. It also means a 50,000-leaf response costs its generation time once at publish rather than on every request, and that a malformed schema is caught at publish time rather than as a 500 in someone's test run.

Store the baked payload as a string, not `jsonb`, so serving it needs no re-serialisation. Expect a baked blob to be a few hundred KB for a large project; Postgres TOAST handles it, and it is read once per version into memory.

### Deploy and rollback

`POST /api/v1/projects/:id/deploy` with a `versionId` sets `active_version_id`, writes a row to the deploy history, and invalidates the in-process cache. It is a single `UPDATE` — rollback is the same call with an older id, and it takes effect on the next request with no restart.

### Version diff

Show a diff between any two versions in the UI: routes added, removed, and for a shared route, which cases changed and how the schema differs. This is the feature that makes versions feel like more than a save button, and it is cheap — both snapshots are already structured JSON in one table. Leave it to the milestone after the core loop works.

### Deletion

Versions are never deleted while they are active or referenced by a `request_log` row inside the retention window. Beyond that, allow deleting old versions manually; do not auto-prune, since a version is the only record of what an API looked like on a given day.

## Mock serving runtime

A mock endpoint is `http://<host>:8080/mock/<project-slug>/<path>` and answers any HTTP method. No authentication — that is the point, and it is also the main security caveat (see *Risks*).

### Request lifecycle

1. **Resolve the project** from the first path segment after `/mock/`. Unknown slug → `404` with a body naming the slug.
2. **Load the live version** from the in-process cache, keyed by project id. On a miss, read it from Postgres once and cache it. No active version → `503` with `{ "error": "project_not_published" }`.
3. **Match the route** by method plus path against a radix tree built when the version was cached. Static segments beat params: `/users/me` wins over `/users/:id`. No match → `404` listing the routes that do exist in this project, which turns the most common mistake into a self-service fix.
4. **Select the case** (below).
5. **Wait** for the case delay, or the project default when the case has none.
6. **Respond** with the status code, the case headers merged over the defaults, and the baked body. In `random` mode, generate here instead.
7. **Log** the request asynchronously, after the response is flushed.

Steps 2 to 6 touch no database and allocate almost nothing in the common case.

### Case selection

| How | Precedence | Example |
| --- | --- | --- |
| `X-Mock-Case` header, matching a case name or id | 1 | `X-Mock-Case: Not found` |
| `__case` query parameter | 2 | `?__case=unauthorized` |
| `X-Mock-Status` header, matching a case's status code | 3 | `X-Mock-Status: 500` |
| The route's default case | 4 | — |

A header naming a case that does not exist returns `400` from the mock server itself, with a body listing the available case names. Failing loudly here is right: silently falling back to the 200 case is exactly how a QA engineer spends an hour wondering why the error path never fires.

The header route is better than matching on request body for v1 because it is explicit, it works from curl and from a browser's devtools, and it does not require the mock server to understand the consumer's payloads.

### Response headers

`Content-Type: application/json` unless overridden. Plus three diagnostic headers on every mock response:

- `X-Mock-Version` — the live version label, so a consumer can prove which version they hit
- `X-Mock-Route` — the matched route pattern
- `X-Mock-Case` — the case that was served

These cost nothing and remove most of the "is it me or the mock?" debugging.

**Hardening (PLAN D9).** Mock content is user-authored and served from the same origin as the editor, so every data-plane response also carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`, and a case cannot set `X-Mock-*`, `Access-Control-*` or hop-by-hop headers. Otherwise an editor could publish a mock that scripts an owner's session.

### CORS

Permissive by default: `Access-Control-Allow-Origin: *`, all methods, all requested headers, and `OPTIONS` answered before route matching. A mock server that a browser cannot call is useless, and there is nothing here worth protecting. Make it a per-project setting for the rare team that needs to test CORS failures.

### Cache invalidation

The cache is a `Map<projectId, CompiledVersion>` holding the radix tree and the baked strings. It is invalidated on deploy, on project deletion and on a manual flush. Settings are frozen into each version's snapshot, so editing project settings or components changes nothing live until the next publish and deploy (PLAN D7). The cache also holds a slug index with short-lived negative entries, and is bounded by bytes, not entry count. With more than one api replica (optional in v1; PLAN D13 assumes a single instance), publish a Postgres `NOTIFY` on deploy and have every replica `LISTEN` and drop its entry — this is the reason not to reach for Redis.

Also expose `POST /api/v1/projects/:id/cache/flush` for the case where someone edits the database directly, which they will.

### Errors from the mock server itself

These need to be distinguishable from a mocked error response, or debugging becomes guesswork. Every error the server generates carries `X-Mock-Error: true` and a body of `{ "error": "<code>", "message": "...", "hint": "..." }`. A mocked 500 defined by the user carries no such header. Document this prominently.

## Control-plane API

Everything under `/api/v1`, JSON in and out, session cookie for auth, and an OpenAPI document generated from the Zod schemas at `/api/v1/openapi.json` — a mock-server project that does not publish its own spec would be a poor advertisement.

| Method and path | Does |
| --- | --- |
| `POST /auth/register` | The first user becomes owner of the `Default` workspace (adopting it if the demo seed already created it); later registrants get no workspace until an owner adds them by email. After the first user, registration is gated by `ALLOW_SIGNUP` (PLAN D3) |
| `POST /auth/login` | Sets the session cookie |
| `POST /auth/logout` | Revokes the session |
| `GET /auth/me` | Current user and workspace memberships |
| `GET /workspaces` · `POST /workspaces` |  |
| `GET /workspaces/:id/members` · `POST` · `PATCH /members/:id` · `DELETE` | Role changes |
| `GET /projects` · `POST /projects` | List is workspace-scoped |
| `GET /projects/:id` · `PATCH` · `DELETE` | `PATCH` covers settings: indexing mode, generation mode, CORS, default delay |
| `GET /projects/:id/routes` · `POST` |  |
| `GET /routes/:id` · `PATCH` · `DELETE` |  |
| `POST /routes/:id/duplicate` | The most-used convenience in tools like this |
| `GET /routes/:id/cases` · `POST` |  |
| `GET /cases/:id` · `PATCH` · `DELETE` · `POST /cases/:id/default` |  |
| `POST /schema/infer` | JSON sample in, MockSchema out. Stateless |
| `POST /schema/preview` | MockSchema plus project settings in, generated JSON out. Stateless; the browser mostly does this locally |
| `POST /projects/:id/imports` | Upload or URL; returns the import plan. Phase 1 |
| `GET /imports/:id` · `POST /imports/:id/confirm` | Phase 2 |
| `GET /projects/:id/presets` · `POST` · `PATCH /presets/:id` · `DELETE` |  |
| `GET /projects/:id/versions` · `POST` | `POST` publishes |
| `GET /versions/:id` · `DELETE` |  |
| `GET /versions/:a/diff/:b` |  |
| `POST /projects/:id/deploy` | Body: `{ versionId }` |
| `GET /projects/:id/deployments` | Deploy history |
| `POST /projects/:id/cache/flush` |  |
| `GET /projects/:id/requests` | Paginated request log |
| `GET /projects/:id/export` · `POST /projects/import` | Whole project as one JSON file — how people share mocks and commit them to a repo |
| `GET /healthz` · `GET /readyz` | Unauthenticated; `readyz` checks the database. Also served under `/api/v1/` because the web container proxies only `/api` and `/mock` |

**Additions to this table (PLAN D11, specified in `docs/API-CONTRACT.md`):** `GET /instance`, `POST /auth/password`, `GET`/`PATCH`/`DELETE /workspaces/:id`, `GET /projects/by-slug/:slug`, the `components` field on `PATCH /projects/:id`, `cases[]` summaries on routes, and a `/w/$wsSlug/members` screen. The CSRF header `X-Mockbench-Client` is required on every non-safe request, and `docs/API-CONTRACT.md` is the authority for every request and response shape.

### Conventions

- Errors: `{ "error": "<machine_code>", "message": "<human>", "details": [ ] }`, with `details` carrying the Zod issue list on a `422`.
- Lists are cursor-paginated on `created_at` plus id, returning `{ "items": [], "nextCursor": null }`. Offset pagination on the request log breaks as rows are pruned under it.
- `PATCH` is a partial update; absent keys are untouched, explicit `null` clears.
- Rate limit the control plane at 100 requests per minute per session, and `/auth/login` at 10 per minute per IP. The data plane is deliberately unlimited — it is a load target by design — with one env knob to cap it if someone exposes an instance publicly.

### The project export file

Worth treating as a first-class format rather than a dump: it is how a team checks their mock definitions into git alongside the frontend that depends on them. Keep it to one self-contained JSON document with a `formatVersion`, no ids that reference anything outside it, and a stable key order so diffs are readable.

## Frontend

A single-page app, built by Vite into static files, served by nginx. The one unusual thing it does is run `packages/schema-core` in the browser, so the response preview is computed locally and updates on every keystroke with no network call.

### Route map

| Path | Screen |
| --- | --- |
| `/login`, `/register` | Unauthenticated |
| `/w/$wsSlug` | Project list for a workspace |
| `/p/$projectSlug` | Project shell: route list in a left pane, editor on the right |
| `/p/$projectSlug/routes/$routeId` | Route editor — the main screen |
| `/p/$projectSlug/routes/$routeId/cases/$caseId` | Selected case inside the route editor |
| `/p/$projectSlug/import` | OpenAPI import wizard — deferred, not built in v1 |
| `/p/$projectSlug/versions` | Version list, publish, deploy, diff |
| `/p/$projectSlug/presets` | Preset editor |
| `/p/$projectSlug/logs` | Request log |
| `/p/$projectSlug/settings` | Project settings |

Use TanStack Router's loaders to prefetch into the Query cache, and its `beforeLoad` for the auth redirect so an unauthenticated user never renders a protected shell. Keep the selected case in the URL rather than component state — it makes every state in the editor linkable, which is worth more than it costs.

### What each TanStack library does here

| Library | Used for | Note |
| --- | --- | --- |
| Router | The map above, type-safe params, auth guard, loaders |  |
| Query | Every server read and mutation; optimistic updates on case edits; `invalidateQueries` keyed by project after a publish | Set `staleTime` high on the route tree — it changes only when the user changes it |
| Table | Version list, request log | And, when the importer lands, its preview table, which needs row selection and per-row verdict badges |
| Form | Login, register, route create, case metadata, project settings | **Not** the schema builder — see below |

### The schema builder

This is the hardest component in the project and the one worth designing before writing any code.

**Do not model the schema tree with TanStack Form.** Its field-array API assumes a known path like `fields[2].items`; here the path is arbitrary-depth and changes as the user edits. Fighting that will cost you a week.

Instead, hold the schema in a **normalised store** — Zustand or `useReducer` with Immer — shaped as:

```ts
type BuilderState = {
  rootId: NodeId
  nodes: Record<NodeId, { id, type, key, parentId, childIds, attrs }>
  expanded: Set<NodeId>
}
```

A flat map plus a `childIds` array gives you: O(1) type change, O(1) key rename, drag-reorder as a splice on one array, delete-subtree as one recursive sweep, and undo/redo as a stack of whole-state snapshots (the state is small — just snapshot it, do not build a command pattern). Render by flattening to a visible-row list and mapping over it, one row per node, indented by depth.

**The row.** Drag handle, indent, key input, type dropdown, a type-specific control (enum values, array count, min/max), a pin-value toggle, and a delete button. Adding a child only appears on `object` and `array` rows. Switching a node from `object` to `string` warns before discarding children.

**Three tabs over the same state** — Builder, JSON, Preview — all editing one schema. The JSON tab is a Monaco or CodeMirror editor that parses on blur and replaces the store; the Builder tab writes to the store directly; Preview is read-only generated output. Round-tripping between them must be lossless, which it is because all three are views of MockSchema.

**Virtualise with TanStack Virtual** past roughly 200 visible rows. An imported spec will blow past that.

### Live preview

The Preview pane calls `generate(schema, settings)` from `schema-core` directly. Debounce at 150ms, run it in the render path (it is microseconds for normal schemas), and move it to a Web Worker only if a large imported schema makes typing stutter — measure before doing that.

Show the generated JSON with the exact `curl` command beside it, pre-filled with the live URL and the `X-Mock-Case` header for the selected case. That one widget is what makes the product feel finished.

### Folder structure

```
apps/web/src/
  routes/           TanStack Router route files
  features/
    auth/ projects/ routes/ schema-builder/ versions/ imports/ logs/
  components/ui/    shadcn primitives
  lib/              api client, query keys, zod re-exports
```

One API client module with typed functions per endpoint, generated from or hand-written against the shared Zod schemas. Do not scatter `fetch` calls through components.

## Docker and deployment

`git clone`, `cp .env.example .env`, `docker compose up` — three commands, and the second one only because `SESSION_SECRET` has no safe default. Open `http://localhost:8080`.

**One stateful volume, by design.** Uploaded OpenAPI specs are stored as text in Postgres rather than on disk, logs go to stdout, and the SPA is baked into its image. So `pgdata` is the only thing that must survive, and "did I mount the right directory" stops being a support question.

### `docker-compose.yml`

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: mock
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-mock}
      POSTGRES_DB: mockserver
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mock -d mockserver"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

  api:
    build: { context: ., dockerfile: docker/api.Dockerfile }
    environment:
      DATABASE_URL: postgres://mock:${POSTGRES_PASSWORD:-mock}@db:5432/mockserver
      SESSION_SECRET: ${SESSION_SECRET:?set SESSION_SECRET in .env}
      ALLOW_SIGNUP: ${ALLOW_SIGNUP:-true}
      SEED_DEMO: ${SEED_DEMO:-true}
      LOG_LEVEL: ${LOG_LEVEL:-info}
    depends_on:
      db: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      retries: 5
    restart: unless-stopped

  web:
    build: { context: ., dockerfile: docker/web.Dockerfile }
    ports:
      - "${PORT:-8080}:80"
    depends_on:
      api: { condition: service_healthy }
    restart: unless-stopped

volumes:
  pgdata:
```

### Migrations

The api image's entrypoint runs `drizzle-kit migrate` and then starts the server. Wrap it in a Postgres advisory lock so that scaling to several api replicas does not have them racing to apply the same migration — cheap to add now, a confusing production incident later if you skip it.

### Images

| Image | Base | Build |
| --- | --- | --- |
| api | `node:22-alpine` | Multi-stage: pnpm fetch, build `schema-core` and `api`, then copy only `dist` and production `node_modules` into the runtime stage. Runs as the `node` user, not root |
| web | `nginx:alpine` | Stage 1 builds the Vite bundle; stage 2 copies `dist` into nginx with a config that proxies `/api` and `/mock` to `api:3000` and falls back to `index.html` for SPA routes |

Build both for `linux/amd64` and `linux/arm64` — a large share of the developers who will try this are on Apple Silicon, and an amd64-only image under emulation is slow enough to read as "this project is broken". Publish to GHCR on tag, and ship a second compose file that pulls the published images instead of building, so trying the project takes a download rather than a five-minute build.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Host port |
| `POSTGRES_PASSWORD` | `mock` | Fine for localhost, must change if exposed |
| `SESSION_SECRET` | *required* | Signs session cookies |
| `ALLOW_SIGNUP` | `true` | Set `false` after creating accounts to close registration |
| `SEED_DEMO` | `true` | Creates a demo project on an empty database |
| `LOG_LEVEL` | `info` | pino level |
| `MOCK_RATE_LIMIT` | unset | Requests per minute on the data plane; unset means unlimited |
| `LOG_RETENTION_DAYS` | `7` | Request-log pruning |

### The demo seed matters more than it sounds

On an empty database, create a `demo` project with three routes — a 200 list, a 200 detail, a 404 — already published and live. A first-time user then has something to `curl` within thirty seconds of `docker compose up`, instead of an empty dashboard and a blank-page problem. Gate it behind `SEED_DEMO` so it never appears in a real install.

### Dev setup

`docker-compose.dev.yml` overrides `api` and `web` with bind-mounted source, `pnpm dev` as the command, and Vite's dev server on 5173 proxying to the api. Most contributors will run Postgres in Docker and both apps on the host; support that too, and say so in the README.

## Repository and open-source setup

A pnpm workspace monorepo. One repo, one `docker compose up`, one issue tracker.

```
.
├── apps/
│   ├── api/          Express: control plane + data plane, Drizzle schema, migrations
│   └── web/          React + Vite SPA
├── packages/
│   ├── schema-core/  MockSchema types, Zod validator, generator
│   └── tsconfig/     Shared TS config
├── docker/
│   ├── api.Dockerfile
│   ├── web.Dockerfile
│   └── nginx.conf
├── docs/             Docs site source
├── examples/         Exported projects and sample payloads
├── docker-compose.yml
├── docker-compose.dev.yml
├── docker-compose.pull.yml
└── .env.example
```

`packages/schema-core` has no dependency on Node APIs, no database, and no HTTP — it must stay importable by the browser. Enforce that with an ESLint rule banning `node:` imports in that package rather than trusting discipline.

### License

**MIT.** It is what developer tools in this space use, it is what contributors expect, and it removes any friction for a company putting this on an internal network. Apache-2.0 is the alternative if an explicit patent grant matters to you; it is slightly more off-putting to casual contributors and there is nothing patentable here. Pick one before the first commit — relicensing after contributions arrive requires every contributor's agreement.

### CI (GitHub Actions)

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci` | PR and push to main | Typecheck, lint, unit tests, build all packages |
| `e2e` | PR | Spins up the compose stack, runs Playwright against it: create a route, build a schema, publish, deploy, call the mock, assert the body |
| `docker` | Tag `v*` | Buildx multi-arch, push to GHCR, attach the compose file to the release |
| `codeql` | PR and weekly |  |

The e2e workflow is the one that matters. It is also the project's best documentation: a contributor reading it learns the whole product loop in one file.

### Tests

Vitest throughout. The generator deserves disproportionate coverage — it is pure, fast to test, and the place where a regression silently corrupts everyone's mocks. Snapshot-test the generated output for a dozen representative schemas, and property-test that generation is idempotent and that any valid MockSchema produces valid JSON.

### Contribution scaffolding

`CONTRIBUTING.md` with a five-minute local setup, `CODE_OF_CONDUCT.md` (Contributor Covenant), issue templates for bug and feature, a PR template, and a `good first issue` label applied to a handful of real issues before announcing anything. Conventional commits plus Changesets for the changelog.

### README

The README is the product's entire marketing. It needs, in order: one sentence saying what this is, an animated GIF of building a route and calling it, the three-command quickstart, a `curl` example with its response, a short feature list, and only then the architecture. A mock-server README that opens with a philosophy paragraph gets closed.

### Where it will be compared

Mockoon, WireMock, Prism, json-server, Beeceptor. Know these before you write the README — the honest differentiator here is the combination of *team-shared, versioned, published-on-purpose* with *legible generated data*. Deferring the importer does give up the "point it at your existing spec" onboarding story, which is Prism's main draw, so restore it before any public announcement. json-server has no schemas, Mockoon is desktop-first and single-user, WireMock is JVM and config-heavy, Prism is spec-only with no UI, Beeceptor is hosted and paid. That is a real gap, but it is a crowded shelf and the positioning has to be sharp.

## Build plan, decisions and risks

### Milestones

Ordered so that the thing that proves the product works — define a route, publish, call it — exists at M3, before any of the convenience features. Sizes are relative, not calendar estimates; I have no basis for estimating your velocity.

| # | Scope | Size | Done when |
| --- | --- | --- | --- |
| M0 | Monorepo, Docker Compose, Postgres, migrations, healthchecks, CI skeleton | M | `docker compose up` serves a "hello" page and `/readyz` is green |
| M1 | Auth, workspaces, projects, routes CRUD; the app shell and route list | L | You can log in and create an empty project with routes |
| M2 | `schema-core`: MockSchema, Zod validator, generator, presets. Schema builder UI, JSON tab, live preview | XL | A case's schema can be built two ways and previewed |
| M3 | Publish, bake, deploy, the data plane, case selection, request logging | L | A `curl` to `/mock/demo/users` returns your defined body. **This is the first usable release** |
| M4 | OpenAPI import — deferred past v1 | L | Not in the current plan |
| M5 | Request log UI, version diff, project export and import, demo seed | M |  |
| M6 | README, GIF, docs site, GHCR images, license, contribution scaffolding, `good first issue` set | M | Ready to announce |

M2 is the one that will overrun. The schema builder is the only component with genuinely novel interaction design in this project, and recursive tree editors are reliably two to three times the work people expect. If the schedule slips, ship M2 with the JSON tab and preview only, and add the visual builder in M2.5 — the format is the same either way, so nothing is wasted.

### Decisions I made on your behalf

Your brief left these open and the design would not be complete without them. Each is a reasonable default, not a conviction — override any of them:

| Decision | Chose | Override if |
| --- | --- | --- |
| HTTP framework | Express 5, plain Node | A benchmark ever shows the HTTP layer as the bottleneck — Fastify is close to a drop-in swap and the two-plane split survives it |
| ORM | Drizzle | You prefer Prisma's DX and accept the heavier image |
| Auth | DB sessions in an httpOnly cookie | You need the data plane to verify tokens without a DB hit |
| Versioning granularity | Whole-project snapshots | You actually meant per-route schema versions — tell me and I will rework that section |
| Response generation | Deterministic and baked at publish | Realistic-looking data matters more than stable data |
| Case selection | `X-Mock-Case` header | You want body or query matching in v1 |
| Cache fan-out | Postgres `LISTEN`/`NOTIFY`, no Redis | You already run Redis |
| License | MIT | You want an explicit patent grant |

### Risks and failure modes

| Risk | Why it bites | What to do about it |
| --- | --- | --- |
| **The data plane has no authentication** | Anyone who can reach port 8080 can read every mock response in every project. One careless port-forward and internal API shapes are public. Mock data is usually fake, but response *structure* is real intelligence about a system | Say this in the README in bold. Add an optional per-project access token in v1.1 for teams that want it. Never pretend the current design is safe to expose. State the threat model plainly: a trusted private network, not the internet |
| **Real-world OpenAPI specs are a swamp** | `oneOf`, `discriminator`, circular refs and vendor extensions are common in specs people will actually import, and the importer would be the top source of bug reports | Deferring it past v1 is the mitigation for now. When it lands: the two-phase preview, never failing silently, and failing specs collected in `examples/` as regression tests |
| **The schema builder overruns** | See M2 above | Ship the JSON tab first; the visual builder is additive |
| **Baking memory** | A project with 200 routes and large arrays holds every baked payload in process memory, per replica | The 50,000-leaf cap, plus an LRU on the version cache rather than an unbounded `Map` |
| **Slug collisions and reserved paths** | A project slugged `api` would shadow nothing today but will confuse everyone, and future top-level paths constrain the namespace | Reserve `api`, `mock`, `health`, `static`, `assets`, `admin` at project creation |
| **Determinism surprises people** | A user expecting faker-style data sees `name-1` and thinks the tool is broken | Explain it on the preview pane itself, in one sentence, next to the mode toggle |
| **Adoption** | Five established tools already occupy this space. A technically good project with no distinct position gets 40 stars and no users | The positioning in the previous section is the thin edge: team-shared, versioned, legible. Validate it by showing the README to five developers before writing the code, not after |

### Open questions for you (all resolved 2026-11-05; see `docs/PLAN.md` section 8)

_Resolved: (1) project-level versions, ADR 0004; (2) a single instance in v1, with `NOTIFY` fan-out optional (D13); (3) request-body validation is not in v1 and the Route model does not preclude it; (4) both the request log and the version diff are in the plan, the log first._


1. **Did you mean project-level or per-route versions?** The whole *Versioning* section turns on this.
2. **Single instance or will you run replicas?** If single, drop the `LISTEN`/`NOTIFY` work and the advisory lock from M0.
3. **Does anything need to accept a request body** — validating an incoming POST and returning 422 when it is wrong? That is a different feature from response mocking and would change the Route model.
4. **Is the request log a v1 feature for you, or would you rather have version diff first?** Both sit in M5 and only one needs to be there.
