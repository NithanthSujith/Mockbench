# Getting started

**Mockbench has no authentication on its mock URLs: anyone who can reach the port can call every published project. It is built for a trusted private network and must never be exposed to the internet.**

## Requirements

Docker with Compose v2 (`docker compose`). Nothing else runs on the host: the database, the API and the web server are containers, and the single-page app is baked into the web image. The first start builds the images from the repository, which takes a few minutes; later starts take seconds.

## Start it

```sh
git clone https://github.com/NithanthSujith/Mockbench.git && cd Mockbench
cp .env.example .env
docker compose up
```

Open `http://localhost:8080`. The port comes from `PORT` in `.env` (see [environment variables](environment-variables.md)).

The first account you register becomes the owner of the `Default` workspace. After that, registration stays open unless you set `ALLOW_SIGNUP=false`; later accounts start with no workspace until an owner adds them by email or they create their own.

## Make your first call

On an empty database Mockbench creates and publishes a project called `demo` (unless `SEED_DEMO=false`). It has three routes: `GET /users`, `GET /users/:id` (with a `Not found` case) and `POST /users` (with a `Validation failed` case).

```sh
curl http://localhost:8080/mock/demo/users
curl -i -H 'X-Mock-Case: Not found' http://localhost:8080/mock/demo/users/3
```

The mock URL for any project is `http://<host>:<port>/mock/<project-slug><route-path>`. The editor shows it with the address your browser used, so it is correct from any machine.

## Build your own

1. Create a project. Its slug becomes the URL prefix and cannot be changed later.
2. Add a route, for example `GET /products/:id`. It starts with one default case.
3. Describe the response in the builder, or paste a JSON example and let Mockbench infer the shape. Add more cases for the other answers (`404`, `500`) if you want them.
4. Publish a version, then deploy it. Until you deploy, a call returns `503 project_not_published`; after you edit routes, callers keep getting the deployed version until you publish and deploy again.
5. Call it with `curl`.

## Share it on your LAN

Teammates open `http://<this-machine's-LAN-IP>:8080`, for example `http://192.168.1.24:8080`, and call `http://<LAN-IP>:8080/mock/<slug>/...`.

- **Find the IP.** macOS: `ipconfig getifaddr en0`. Linux: `hostname -I`. Windows: `ipconfig`, then the IPv4 address of your Wi-Fi or Ethernet adapter. Ignore virtual adapters (VMware, WSL, Hyper-V, Docker).
- **You may need to allow the port through the host firewall** (inbound TCP, 8080 by default). If `http://localhost:8080` works for you and a teammate cannot connect, the firewall is the usual cause.
- **Docker Desktop on macOS and Windows** routes traffic through a virtual network, so the request log can show a gateway address instead of the caller's real IP. On Linux with the default bridge network the real address is kept.
- **Change the port** by setting `PORT` in `.env` and running `docker compose up -d` again.

Before sharing: set your own `SESSION_SECRET`, and consider `ALLOW_SIGNUP=false` once your team has accounts. The session cookie is not marked `Secure` by default so that plain HTTP on a LAN address works; set `COOKIE_SECURE=true` only behind HTTPS.

Mockbench makes no outbound network calls at runtime: no telemetry, no update checks, no fonts or scripts from a CDN.

## Stop, update, remove

```sh
docker compose down          # stop; your data stays in the pgdata volume
docker compose up -d --build # rebuild after pulling new code
docker compose down -v       # stop and DELETE all data
```
