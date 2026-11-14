# Case selection and headers

A route can have several [response cases](concepts.md#response-case). This page covers how a caller picks one, what every mock response says about itself, and the errors Mockbench itself returns.

**Mock URLs take no authentication: anyone who can reach the port can pick any case of any published project.**

## Choosing a case

The first selector that is present wins. There is no fall-through: if a selector is present but matches nothing, the answer is `400 case_not_found`.

| Order | Selector | Matches |
| --- | --- | --- |
| 1 | request header `X-Mock-Case` | a case id, or a case name (trimmed, case-insensitive) |
| 2 | query parameter `__case` | the same |
| 3 | request header `X-Mock-Status` | the first case, in editor order, whose status code equals it |
| 4 | none of the above | the route's default case |

```sh
curl -H 'X-Mock-Case: Not found' http://localhost:8080/mock/demo/users/3
curl 'http://localhost:8080/mock/demo/users/3?__case=not%20found'
curl -H 'X-Mock-Status: 404' http://localhost:8080/mock/demo/users/3
```

## Diagnostic headers

Every response from a mock route carries:

| Header | Value |
| --- | --- |
| `X-Mock-Version` | the label of the deployed version that answered, for example `v3` |
| `X-Mock-Route` | the method and route pattern that matched, for example `GET /users/:id` |
| `X-Mock-Case` | the name of the case that answered |

Every mock response, including errors, also carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`, so mock content cannot script the editor served from the same origin.

Case headers you defined are added on top of these. Names starting `x-mock-` cannot be used in a case.

## `X-Mock-Error`: the mock server answering, not your case

When Mockbench itself generates a response, because there is nothing to serve or the request cannot be matched, it adds `X-Mock-Error: true` and a JSON body:

```json
{ "error": "<code>", "message": "<what happened>", "hint": "<what to do>" }
```

| Status | `error` | Meaning | Extra body fields |
| --- | --- | --- | --- |
| 404 | `project_not_found` | no project has that slug | `slug` |
| 503 | `project_not_published` | the project has no deployed version | `slug` |
| 503 | `mock_unavailable` | the deployed version cannot be loaded right now; the next request retries | `slug` |
| 404 | `route_not_found` | no route matches the method and path | `routes`: the routes that exist |
| 400 | `case_not_found` | the requested case does not exist on the matched route | `cases`: the available cases (`name`, `statusCode`, `isDefault`) |
| 429 | `rate_limited` | over `MOCK_RATE_LIMIT`; a `Retry-After` header says when to retry | |
| 500 | `mock_internal_error` | the server failed while building the response | |

**`case_not_found` versus a mocked error.** A 404 or 500 that you defined as a case (the `Not found` case of the demo) is a normal answer: it has your status and body and it does **not** carry `X-Mock-Error`. `X-Mock-Error: true` means Mockbench itself is reporting a problem with the request or the project. A client can tell the two apart with that one header; `X-Mock-Case` names the case when a case answered.

## CORS

With the project setting `cors` at `*` (the default), every response, including the errors above, carries `Access-Control-Allow-Origin: *` and exposes the `X-Mock-*` headers plus your case's custom header names to browser code. Preflight `OPTIONS` requests are answered before any route is matched with `204`, allowing `GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS`, echoing the requested headers, with a 10-minute cache. A preflight for an unknown or unpublished project is also answered permissively, so a browser can read the real error that follows.

With `cors` set to `off`, no CORS headers are sent and a preflight returns a bare `204`, so browser calls from another origin fail. That is the feature.

## Delay, bodies and status

- A case's `delayMs` (or, when empty, the project's default delay) is waited before the response is sent.
- A `204` case sends no body. Otherwise the body is compact JSON with `Content-Type: application/json; charset=utf-8`, unless the case sets its own `Content-Type`.
- A `HEAD` request is answered from the matching `GET` route without a body.
