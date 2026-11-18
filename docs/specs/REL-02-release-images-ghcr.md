# REL-02 — Release workflow: multi-arch images on GHCR

Status: in review
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
- [ ] Pushing tag `v0.1.0` produces both images with a manifest list containing `linux/amd64` and `linux/arm64` (verified with `docker buildx imagetools inspect`).
- [ ] `docker compose -f docker-compose.pull.yml up` on a clean machine with no source checkout reaches all-healthy and `GET /api/v1/readyz` returns `200`.
- [ ] The release has `docker-compose.pull.yml` and `.env.example` attached.
- [ ] The post-publish smoke job runs the XC-01 golden loop against the pulled images and fails the workflow if it fails.
- [ ] The images run as non-root and contain no `drizzle-kit`, no source maps with absolute paths, and no `.env` files (inspection step).
- [ ] The workflow requests only `contents: read`, `packages: write`, `id-token: write`/`attestations: write` permissions, and pins third-party actions by SHA.

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

## Open questions
- GHCR packages created by Actions may start private. If so, set both packages to public once (Package settings) so `docker compose pull` works without a login.
