#!/usr/bin/env bash
# REL-02: inspect the api and web images before anyone pulls them.
#
#   bash scripts/image-inspect.sh <api-image> <web-image>             local images (lan-smoke, dev)
#   bash scripts/image-inspect.sh --published <api-ref> <web-ref>     also require a linux/amd64 +
#                                                                      linux/arm64 manifest list (release)
#
# Checks: each image runs as non-root; the api has no drizzle-kit; no `.env` file is baked in; no source
# map names an absolute path (a build machine's directory). Exit 1 on any failure.
set -uo pipefail

published=0
if [[ "${1:-}" == "--published" ]]; then
  published=1
  shift
fi
api="${1:?usage: image-inspect.sh [--published] <api-image> <web-image>}"
web="${2:?usage: image-inspect.sh [--published] <api-image> <web-image>}"

failures=0
pass() { echo "  ok    $*"; }
fail() {
  echo "  FAIL  $*"
  failures=$((failures + 1))
}

if ((published)); then
  for ref in "$api" "$web"; do
    platforms="$(docker buildx imagetools inspect "$ref" 2>&1 | awk '/Platform:/ {print $2}' | sort -u | tr '\n' ' ')"
    if [[ "$platforms" == *"linux/amd64"* && "$platforms" == *"linux/arm64"* ]]; then
      pass "$ref is a manifest list with linux/amd64 and linux/arm64"
    else
      fail "$ref platforms: '${platforms}'"
    fi
    docker pull -q "$ref" >/dev/null || fail "docker pull $ref"
  done
fi

# Runs a shell snippet in the image as its configured user, without its entrypoint.
in_image() { docker run --rm --entrypoint sh "$1" -c "$2" 2>&1 | tr -d '\r'; }

for ref in "$api" "$web"; do
  uid="$(in_image "$ref" 'id -u')"
  if [[ "$uid" =~ ^[0-9]+$ && "$uid" != "0" ]]; then pass "$ref runs as non-root (uid $uid)"; else fail "$ref runs as uid '$uid'"; fi

  envs="$(in_image "$ref" 'find / -xdev \( -name ".env" -o -name ".env.*" \) -not -name ".env.example" 2>/dev/null | head -5')"
  if [[ -z "$envs" ]]; then pass "$ref contains no .env file"; else fail "$ref contains: $envs"; fi

  # A source map's "sources" (and "sourceRoot") must be relative. An absolute path leaks the build
  # machine's layout and means the map was built from the wrong directory.
  abs="$(in_image "$ref" 'find / -xdev -name "*.map" -not -path "/proc/*" 2>/dev/null | while read -r f; do
      grep -oE "\"sourceRoot\":[[:space:]]*\"(/|[A-Za-z]:[\\\\/])[^\"]*" "$f" | head -1 | sed "s|^|$f: |"
      grep -oE "\"sources\":[[:space:]]*\[[^]]*\"(/|[A-Za-z]:[\\\\/])[^\"]*" "$f" | head -1 | sed "s|^|$f: |"
    done | head -5')"
  if [[ -z "$abs" ]]; then pass "$ref has no source map with an absolute path"; else fail "$ref source maps: $abs"; fi
done

dk="$(in_image "$api" 'find / -xdev -name "drizzle-kit*" 2>/dev/null | head -3')"
if [[ -z "$dk" ]]; then pass "$api contains no drizzle-kit"; else fail "$api contains drizzle-kit: $dk"; fi

if ((failures)); then
  echo "image-inspect: $failures check(s) failed"
  exit 1
fi
echo "image-inspect: ok"
