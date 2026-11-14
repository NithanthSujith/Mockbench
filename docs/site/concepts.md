# Concepts

Six objects, nested. A **workspace** owns **projects**, a project owns **routes**, a route owns **response cases**, and publishing a project freezes all of it into a **version** that a **deployment** points at.

## Workspace

A team boundary. Users belong to a workspace with a role:

- **viewer** can read everything.
- **editor** can also create and change projects, routes, cases and presets, publish, deploy and roll back.
- **owner** can also delete projects, rename or delete the workspace, and manage members.

The first account registered on a fresh instance becomes owner of the `Default` workspace. Later accounts have no workspace until an owner adds them by email, or they create their own. A workspace always keeps at least one owner.

## Project

One mock API. Its **slug** (3 to 40 characters: lowercase letters, digits and single hyphens) is the URL prefix, `/mock/<slug>/...`, and cannot be changed after creation, because consumers have it in their code. A few slugs are reserved.

Project settings:

| Setting | Values | Meaning |
| --- | --- | --- |
| Generation mode | `deterministic` (default), `seeded`, `random` | How body values are produced. See [schema and generation](schema-and-generation.md). `random` is generated on every request and so is not stable between calls. |
| Indexing | `local` (default), `path` | Whether nested arrays restart their numbering or carry the path. |
| CORS | `*` (default), `off` | Whether mock responses carry permissive CORS headers. |
| Default delay | 0 to 10,000 ms | Added to every response unless the case sets its own delay. |

A project also holds **presets** (rules that give fields realistic values) and **components** (named schema nodes reused with `ref`).

## Route

A method and a path pattern: `GET /users/:id/orders`. Methods are `GET`, `POST`, `PUT`, `PATCH` and `DELETE`. `HEAD` requests are answered from the `GET` route with no body.

Path rules: starts with `/`, no trailing slash (except the root `/`), no empty segments, no wildcards, no `?` or `#`. A segment is either static (letters, digits, `.`, `_`, `~`, `-`) or a `:name` parameter. Matching ignores case on static segments, a trailing slash and the query string; a parameter matches exactly one non-empty segment. A static segment beats a parameter, so `/users/me` wins over `/users/:id`.

Two routes cannot share a method and a normalised path: `/users/:id` and `/users/:userId` collide, and the second is rejected. Parameters are matched, but in this version nothing in a response body reads them: `GET /users/3` and `GET /users/7` return the same body.

## Response case

One possible answer for a route: a name, a status code, a [schema](schema-and-generation.md), optional headers and an optional delay. `GET /users/:id` can carry `Found` (200) and `Not found` (404) side by side. Exactly one case per route is the default and answers when the caller does not ask for another. See [case selection](case-selection-and-headers.md).

- Status codes: 200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503. A `204` sends no body.
- Case names are 1 to 60 characters and unique within a route (compared without regard to case).
- Headers: up to 20 per case. Names beginning `x-mock-` or `access-control-`, and hop-by-hop and framing headers such as `Content-Length` and `Host`, are rejected.
- Delay: 0 to 10,000 ms; empty means use the project default.

## Version and deployment

Editing routes and cases changes the **draft**. The draft is never served. **Publishing** takes a snapshot of every route, case, preset and component into an immutable **version** with a label (default `v1`, `v2`, ...). A version is self-contained: editing a preset afterwards changes nothing that was already published. Publishing does not make anything live.

**Deploying** points the project at a version; that is the only thing consumers see. Rolling back is deploying an older version. A deploy takes effect on the next request, with no restart. Two versions can be compared with the version diff.

Versions in use, or still referenced by retained request-log rows, cannot be deleted; others can be deleted by hand. They are never pruned automatically, because a version is the record of what the API looked like on a given day.

## Request log

Every request that reaches a known project is recorded: method, path, query, status, duration, the route and case that answered, the version, request headers and the caller's IP. The values of `Authorization`, `Cookie`, `Proxy-Authorization`, `X-Api-Key` and `Set-Cookie` are replaced with `[redacted]`. Old rows are pruned (see `LOG_RETENTION_DAYS` and `LOG_RETENTION_ROWS` in [environment variables](environment-variables.md)). Requests for an unknown slug are not logged.

**Mockbench has no authentication on its mock URLs: anyone who can reach the port can call every published project.** Keep it on a trusted private network.
