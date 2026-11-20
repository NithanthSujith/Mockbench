# REL-02 — Release workflow: multi-arch images on GHCR

Status: done
Phase: 5   Team: Core
Depends on: FND-14, XC-01
Size: M

## Goal
Tagging `v*` builds and publishes multi-arch images to GHCR and attaches a compose file that pulls them, so trying Mockbench is a download rather than a five-minute build.

## In scope
- `.github/workflows/docker.yml`: buildx for `linux/amd64` and `linux/arm64`, push `api` and `web` to GHCR with version and `latest` tags, provenance/SBOM attestations, attach `docker-compose.pull.yml` to the GitHub release.
- `docker-compose.pull.yml` referencing the published images by version.
- A post-publish smoke job that pulls the images and runs the e2e golden loop against them.

## Out of scope
Docker Hub, signing beyond GHCR attestations, auto-update mechanisms (never — no outbound calls).

## Contract
Image names `ghcr.io/<owner>/mockbench-api` and `…-web`. Tag policy: `vX.Y.Z`, `vX.Y`, `latest`. Compose pull file uses `${MOCKBENCH_VERSION:-latest}`.

## Acceptance criteria
- [x] Pushing tag `v0.1.0` produces both images with a manifest list containing `linux/amd64` and `linux/arm64` (verified with `docker buildx imagetools inspect`). _Verified on the prerelease tag `v0.1.0-rc.2` (run 44798370535): `inspect` reports both `mockbench-api` and `mockbench-web` as "a manifest list with linux/amd64 and linux/arm64"._
- [x] `docker compose -f docker-compose.pull.yml up` on a clean machine with no source checkout reaches all-healthy and `GET /api/v1/readyz` returns `200`. _The `smoke` job copies only the two assets into an empty directory: all services healthy, `GET /api/v1/readyz -> 200`._
- [x] The release has `docker-compose.pull.yml` and `.env.example` attached. _Both are on the `v0.1.0-rc.2` prerelease. **Drift:** GitHub will not serve an asset whose name starts with a dot, so `.env.example` is attached as **`default.env.example`**. The file content is unchanged; anyone following the README downloads it and saves it as `.env`. Worth a line in the README (REL-01) rather than a workflow change._
- [x] The post-publish smoke job runs the XC-01 golden loop against the pulled images and fails the workflow if it fails. _21 loop tests and 2 seed tests passed against the pulled images (29.8 s), and `release` runs only `needs: smoke`._
- [x] The images run as non-root and contain no `drizzle-kit`, no source maps with absolute paths, and no `.env` files (inspection step). _`api` runs as uid 1000, `web` as uid 101; both report no `.env`, and `api` no `drizzle-kit`._
- [x] The workflow requests only `contents: read`, `packages: write`, `id-token: write`/`attestations: write` permissions, and pins third-party actions by SHA. _Every third-party action is pinned by SHA. Two recorded permission drifts: `release` needs `contents: write`, and `inspect`/`smoke` need `packages: read` to pull a private package._

## Tests
A dry-run of the workflow on a prerelease tag in CI; inspection scripts.

## Implementation notes
- **Namespace:** `ghcr.io/nithanthsujith/mockbench-{api,web}` (the repository owner, lowercased). The workflow derives it from `github.repository_owner` and checks it matches `docker-compose.pull.yml`, which REL-01 already shipped.
- **Tags:** `vX.Y.Z`, `vX.Y` and `latest` (with the `v`, so `MOCKBENCH_VERSION` equals the git tag). A prerelease tag such as `v0.1.0-rc.1` gets only its own tag and a GitHub prerelease, and does not move `latest` or `vX.Y`.
- **Non-root web image (drift from FND-14 and DESIGN):** the web image ran nginx as root. It now uses `nginxinc/nginx-unprivileged:alpine` (uid 101) and still listens on 80 inside the container, since Docker 20.10+ lets unprivileged processes bind low ports in a container namespace. Compose, nginx.conf and the docs are otherwise unchanged. DESIGN's container table is updated in the same commit.
- **Permissions (drift from the criterion):** the workflow default is `contents: read`. `publish` adds `packages: write`, `id-token: write` and `attestations: write`. `release` needs `contents: write`, because creating a release and uploading assets is impossible with `contents: read`. Only that job has it, and it runs last, after the smoke test.
- **Order:** publish → inspect (`scripts/image-inspect.sh --published`) → smoke (empty directory with only the two assets, then XC-01 via `E2E_COMPOSE_FILE=docker-compose.pull.yml`) → release. A failed smoke leaves the images pushed but creates no release.
- **PR-time coverage:** `lan-smoke` runs the same `scripts/image-inspect.sh` on the locally built images, so a regression shows up before a tag.
- **Dry run:** needs a pushed prerelease tag, which publishes real images. Pending the owner's go-ahead.

### First dry run, `v0.1.0-rc.1` (2026-11-20, run 44790921936) — failed, two bugs fixed

`publish` succeeded for both images; `inspect` failed all 11 checks; `smoke` and `release` never ran, so **no release and no assets were created**. Both causes were in `docker.yml`, not in the images:

1. **The tag lost its `v`.** `type=semver,pattern=v{{version}}` emitted `ghcr.io/…/mockbench-api:0.1.0-rc.1` for git tag `v0.1.0-rc.1` — the `v` in the pattern did not survive. Nothing looks for that tag: `inspect` pulls `$GITHUB_REF_NAME` and `smoke` sets `MOCKBENCH_VERSION=${{ github.ref_name }}`, both `v`-prefixed, and `docker-compose.pull.yml` interpolates the same value. The same quirk would have pushed `0.1` instead of `v0.1` on a stable tag. Tags are now computed in a shell step from `$GITHUB_REF_NAME` verbatim (`vX.Y` and `latest` added only when the tag has no `-`), so the image tag is the git tag by construction; `metadata-action` is kept for labels and annotations only.
2. **`inspect` and `smoke` pulled from GHCR anonymously.** A package Actions has just created is **private**, and GHCR answers an unauthorized pull with `not found` — which is why the failure read as a missing tag rather than a permission error. Both jobs now log in with `docker/login-action` (same pinned SHA as `publish`).

**Permissions drift (second item on top of the one above):** `inspect` and `smoke` now declare `packages: read` in addition to `contents: read`. The criterion below lists only the `publish` job's permissions; read access for the two jobs that pull is required, and `release` still needs `contents: write`.

Because GHCR carries `0.1.0-rc.1` from the failed run and the git tag `v0.1.0-rc.1` is spent, a retry needs a **new** tag (`v0.1.0-rc.2`) unless the owner approves deleting and re-pushing `v0.1.0-rc.1`. The stray `0.1.0-rc.1` package version can be deleted in Package settings; nothing references it.

### Second dry run, `v0.1.0-rc.2` (2026-11-20, run 44798370535) - green end to end

All four jobs passed with the fixes above: `publish` (api 54 s, web 42 s), `inspect` (23 s), `smoke` (2 m 29 s) and `release` (9 s). The images are tagged `v0.1.0-rc.2` only - no `vX.Y`, no `latest` - as a prerelease should be, and the GitHub prerelease carries both assets. The smoke job proves the whole point of the unit: a clean directory holding only `docker-compose.pull.yml` and the env sample pulls the published images, comes up healthy and passes the golden loop.

Still manual, once, and only if `docker compose pull` should work without `docker login`: set both GHCR packages to public in Package settings. The workflow itself no longer depends on that.

## Open questions
- GHCR packages created by Actions may start private. If so, set both packages to public once (Package settings) so `docker compose pull` works without a login.
