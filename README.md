# Mockbench

A self-hosted mock API server. Your team defines routes and response shapes in a web UI, publishes a version, and anyone on the network calls the resulting endpoints over plain HTTP. There is no hosted version, and there never will be.

> **Status: pre-release.** The container stack, the API skeleton and the UI shell run today; the screens and features are being built unit by unit (see `docs/PLAN.md`). The full README arrives with REL-01.

> **The mock URLs take no authentication.** Anyone who can reach the port can call every published project. Mockbench is built for a trusted private network such as a laptop or an office LAN, and must not be exposed to the internet.

## Quickstart

```sh
git clone https://github.com/NithanthSujith/Mockbench.git && cd Mockbench
cp .env.example .env
docker compose up
```

Then open **http://localhost:8080** on the machine running it. The editor and the mock endpoints share that one port: the UI at `/`, the control API at `/api/v1/…`, and the mocks at `/mock/<project-slug>/…`.

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

Before sharing the instance, change `SESSION_SECRET` in `.env` (the placeholder works but the API logs a warning), and consider `ALLOW_SIGNUP=false` once your team has accounts.

## Developing

```sh
docker compose -f docker-compose.dev.yml up -d   # Postgres on 127.0.0.1 only, for apps run on the host
pnpm install
pnpm --filter @mockbench/web dev:mock             # the UI with fake data, no backend (open it on localhost)
```

The standing rules for contributors and AI agents are in `CLAUDE.md`; the design is in `docs/DESIGN.md`.

## License

MIT, see `LICENSE`.
