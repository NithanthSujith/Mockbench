# Mockbench

A self-hosted mock API server: your team defines routes and response shapes in a web UI, publishes a version, and anyone on the network calls the endpoints over plain HTTP. There is no hosted version, and there never will be.

> **Mockbench has no authentication on its mock URLs: anyone who can reach the port can call every published project. It is built for a trusted private network (a laptop, an office LAN) and must never be exposed to the internet.**

## Quickstart

```sh
git clone https://github.com/NithanthSujith/Mockbench.git && cd Mockbench
cp .env.example .env
docker compose up
```

Open **http://localhost:8080**, register (the first account becomes the owner of the `Default` workspace), and you are in. The editor and the mock endpoints share that one port: the UI at `/`, the control API at `/api/v1/…`, the mocks at `/mock/<project-slug>/…`.

You do not have to build anything to make a first call. On an empty database Mockbench seeds a published `demo` project:

```sh
curl http://localhost:8080/mock/demo/users
```

<!-- smoke:begin demo-users -->

```json
[
  { "id": 1, "name": "name-1", "email": "email-1@example.com", "role": "role-1", "isActive": true },
  { "id": 2, "name": "name-2", "email": "email-2@example.com", "role": "role-2", "isActive": true },
  { "id": 3, "name": "name-3", "email": "email-3@example.com", "role": "role-3", "isActive": true }
]
```

<!-- smoke:end -->

Every project can define several named response cases per route. Ask for one with a header:

```sh
curl -i -H 'X-Mock-Case: Not found' http://localhost:8080/mock/demo/users/3
```

<!-- smoke:begin demo-user-not-found -->

```json
{ "message": "User not found" }
```

<!-- smoke:end -->

That response is a `404`, and it carries `X-Mock-Version`, `X-Mock-Route` and `X-Mock-Case` headers telling you which version, route and case answered. See [case selection and headers](docs/site/case-selection-and-headers.md).

## What it does

- **Routes and cases.** Define `GET /users/:id` once, then add named response cases (`Found`, `Not found`, `Rate limited`) each with its own status code, headers and delay.
- **A visual schema builder.** Describe a response as a typed tree, or paste a JSON example and let Mockbench infer the tree. A live preview shows the output as you edit.
- **Legible generated data.** Values are a pure function of field name, type and position: `role` becomes `"role-1"`, a list of three becomes `branch_list-1`, `branch_list-2`, `branch_list-3`. You can read a payload and know which field you are looking at. See [schema format and generation](docs/site/schema-and-generation.md).
- **Presets.** Project-level rules that give fields domain-looking values (`currency` is always `"EUR"`, `sku` follows `SKU-00001`) without editing every route.
- **Published on purpose.** Editing never changes what your consumers see. You publish an immutable version, deploy it, and roll back to an earlier one in one step. Versions can be diffed.
- **A request log.** Every call to a project is recorded and shown live, so you can see what a client actually sent.
- **Team-shared.** Workspaces, members and roles (owner, editor, viewer) on one instance.
- **Browser-friendly.** CORS is on by default and preflight requests are answered before routes are matched.

## Run it on your LAN

Everyone on your network can use the same instance. The containers listen on all interfaces and Docker publishes the port on all interfaces of the host, so nothing needs configuring beyond starting it. Teammates open:

```
http://<this-machine's-LAN-IP>:8080
```

For example `http://192.168.1.24:8080`. The address the browser used is the address Mockbench shows in its `curl` snippets and base URLs, so it works from whichever machine you are on. Nothing is hardcoded to `localhost`.

**Find this machine's LAN IP**

| System  | Command                                                                |
| ------- | ---------------------------------------------------------------------- |
| macOS   | `ipconfig getifaddr en0` (Wi-Fi) or `ipconfig getifaddr en1`           |
| Linux   | `hostname -I` (first address) or `ip -4 route get 1.1.1.1`             |
| Windows | `ipconfig` and read the IPv4 Address of your Wi-Fi or Ethernet adapter |

Skip virtual adapters (VMware, WSL, Hyper-V, Docker); they are not reachable from other machines.

**You may need to allow the port through the host firewall.** If a teammate cannot connect but `http://localhost:8080` works for you, the host firewall is the usual cause. Allow inbound TCP on the port (8080 by default): Windows Defender Firewall (_Inbound Rules, New Rule, Port_), macOS _System Settings, Network, Firewall_ (allow Docker), or on Linux for example `sudo ufw allow 8080/tcp`.

**Changing the port:** set `PORT=9090` in `.env` and run `docker compose up -d` again; use that port in the URL.

**Docker Desktop (macOS and Windows) and client IPs:** requests reach the containers through Docker's virtual network, so the request log and any per-IP limit may show a gateway address (such as `192.168.65.1` or `172.x.x.x`) instead of the caller's real LAN IP. On Linux with the default bridge network the real address is kept.

**Before you share the instance:** change `SESSION_SECRET` in `.env` (the placeholder works, but the API logs a warning), change `POSTGRES_PASSWORD` if the database is ever reachable beyond the compose network (by default it is not published), and consider `ALLOW_SIGNUP=false` once your team has accounts. The session cookie is not marked `Secure`, because plain HTTP on a LAN IP must work; set `COOKIE_SECURE=true` only if you put HTTPS in front. Do not publish the port to the internet: the mock URLs take no authentication by design.

## Examples

[`examples/`](examples/README.md) holds three ready-made projects (`*.mockbench.json`) and sample request payloads: a shop API that shares one component between routes, a small CRUD API, and a payments API full of error cases for testing retry code.

## Documentation

Everything is in [`docs/site/`](docs/site/index.md) as plain Markdown, readable offline:

- [Getting started](docs/site/getting-started.md)
- [Concepts: workspace, project, route, case, version](docs/site/concepts.md)
- [Schema format and generation rules](docs/site/schema-and-generation.md)
- [Case selection and headers](docs/site/case-selection-and-headers.md)
- [Environment variables](docs/site/environment-variables.md)
- [Backup and restore](docs/site/backup-and-restore.md)

## Architecture

One Node process serves two planes, behind an nginx container that also serves the single-page app:

```
browser / curl ──> web (nginx, host port 8080) ──┬── /            the React app
                                                 ├── /api/v1/*    control plane ─┐
                                                 └── /mock/*      data plane ────┤
                                                                api (Express 5) ─┴──> db (PostgreSQL 16)
```

- **Control plane** (`/api/v1/*`): authenticated, validated against a shared contract, the only thing that writes.
- **Data plane** (`/mock/<slug>/*`): unauthenticated and read-only. It answers from an in-process cache of the deployed version and does not query the database while serving a request.
- **One shared schema library** (`packages/schema-core`) defines the response format, the validator and the generator. It runs in the browser for the live preview and in the API at publish time, so the preview matches what is served.
- **One volume**, `pgdata`. Logs go to stdout. Postgres is not published to the host.

The product design is in `docs/DESIGN.md` and the HTTP contract in `docs/API-CONTRACT.md`.

## How it compares

- **Mockoon** is desktop-first and single-user. Mockbench is a shared server with accounts and one URL for the whole team.
- **WireMock** is a JVM server configured with JSON or Java. Mockbench is configured in a UI and runs in two small containers.
- **Prism** serves a mock from an OpenAPI document and has no UI. Mockbench has a UI and no document is needed, but it cannot import an OpenAPI file yet.
- **json-server** serves a JSON file you write and has no response schemas. Mockbench generates data from a typed schema and keeps versions.
- **Beeceptor** is a hosted, paid service. Mockbench is self-hosted only.

The honest differentiator is the combination: team-shared, versioned and published on purpose, with generated data you can read. If you already have an OpenAPI document and want a mock from it with no UI, Prism does that today and Mockbench does not yet. This is a summary of each tool's main mode, and those tools keep changing.

## Developing

```sh
docker compose -f docker-compose.dev.yml up -d   # Postgres on 127.0.0.1 only, for apps run on the host
pnpm install
pnpm --filter @mockbench/web dev:mock             # the UI with fake data, no backend (open it on localhost)
```

The standing rules for contributors and AI agents are in `CLAUDE.md`; the design is in `docs/DESIGN.md`. The checks CI runs are `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm build`.

## License

MIT, see `LICENSE`.
