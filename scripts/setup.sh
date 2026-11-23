#!/usr/bin/env bash
# Interactive first-run setup: asks for the few values that have no safe default and writes .env,
# so that `docker compose up` works straight afterwards.
#
#   bash scripts/setup.sh              ask for each value (press Enter to accept the suggestion)
#   bash scripts/setup.sh --defaults   no questions: generate the secrets, keep every default
#   bash scripts/setup.sh --force      overwrite an existing .env instead of leaving it alone
#
# Every variable is read from .env.example, so a value added there appears here automatically.
# Without a terminal (CI, a pipe) the script behaves as --defaults rather than hanging on a prompt.
set -eu

# Works both as scripts/setup.sh in a checkout and as a standalone setup.sh downloaded next to
# docker-compose.pull.yml from a release: run wherever .env.example actually is.
cd "$(dirname "$0")"
[ -f .env.example ] || cd ..

DEFAULTS=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --defaults | -d) DEFAULTS=1 ;;
    --force | -f) FORCE=1 ;;
    --help | -h)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "setup: unknown option '$arg' (try --help)" >&2
      exit 2
      ;;
  esac
done

[ -t 0 ] || DEFAULTS=1

if [ ! -f .env.example ]; then
  echo "setup: .env.example is missing — run this from a Mockbench checkout." >&2
  exit 1
fi

if [ -e .env ] && [ "$FORCE" -eq 0 ]; then
  echo "setup: .env already exists, leaving it untouched."
  echo "       Re-run with --force to replace it, or edit .env by hand."
  exit 0
fi

if [ -e .env ]; then
  # Postgres reads POSTGRES_PASSWORD only when it initialises its volume, so a new password in .env
  # does not reach a database that already exists: the api would then fail to authenticate.
  echo "setup: --force replaces .env, including the database password."
  echo "       An existing database keeps its old password, so if you have already started"
  echo "       Mockbench, either keep POSTGRES_PASSWORD as it is or remove the volume with"
  echo "       'docker compose down -v' (which deletes your projects)."
  echo
fi

# A secret goes into .env, which Docker Compose parses: '$' would start an interpolation and '#' a
# comment, so keep typed values to characters that survive that file format intact.
SAFE='^[A-Za-z0-9_.:@+-]+$'

abort_eof() { # stdin closed mid-question: never loop on an answer that cannot arrive
  echo >&2
  echo "setup: input ended before the questions were answered — .env was not written." >&2
  echo "       For an unattended setup run: bash scripts/setup.sh --defaults" >&2
  exit 1
}

# `read` also reports failure when it accepts a last line with no trailing newline, so an empty
# value is what distinguishes a real end-of-input from that case.
read_line() { # read_line <varname>
  read -r "$1" || [ -n "${!1}" ] || abort_eof
}

generate() { # 32 random bytes as hex, without assuming openssl is installed
  openssl rand -hex 32 2>/dev/null && return 0
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  echo
}

default_of() { # default_of <KEY>: the value .env.example ships for KEY
  sed -n "s/^$1=//p" .env.example | head -n 1
}

port_in_use() { # best effort: quiet and never fatal when no tool is available
  { command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$1 "; } ||
    { command -v netstat >/dev/null 2>&1 && netstat -an 2>/dev/null | grep -Eq "[.:]$1[^0-9].*LISTEN"; }
}

ask_secret() { # ask_secret <prompt>  -> echoes a generated or typed value
  local prompt="$1" value=''
  while :; do
    printf '%s\n  [Enter] generates a strong random value: ' "$prompt" >&2
    read -rs value || [ -n "$value" ] || abort_eof
    printf '\n' >&2
    if [ -z "$value" ]; then
      generate
      return 0
    fi
    if [ "${#value}" -lt 16 ]; then
      printf '  Too short (%s characters, need at least 16). Try again.\n' "${#value}" >&2
      continue
    fi
    if ! printf '%s' "$value" | grep -Eq "$SAFE"; then
      printf '  Use only letters, digits and _ . : @ + - (a $ or # breaks the .env file).\n' >&2
      continue
    fi
    printf '%s\n' "$value"
    return 0
  done
}

PORT_DEFAULT=$(default_of PORT)
PORT_DEFAULT=${PORT_DEFAULT:-8080}
PORT_VALUE="$PORT_DEFAULT"
SESSION_VALUE=''
PG_VALUE=''

if [ "$DEFAULTS" -eq 1 ]; then
  SESSION_VALUE=$(generate)
  PG_VALUE=$(generate)
  if port_in_use "$PORT_VALUE"; then
    echo "setup: warning — port $PORT_VALUE is already in use on this machine."
    echo "       Edit PORT in .env before starting, or stop whatever is using it."
  fi
else
  echo
  echo "Mockbench setup — three questions, then you are done."
  echo

  # 1. port
  while :; do
    printf 'Host port for the UI, the control API and the mocks.\n  [Enter] keeps %s: ' "$PORT_DEFAULT"
    reply=''
    read_line reply
    reply=${reply:-$PORT_DEFAULT}
    if ! printf '%s' "$reply" | grep -Eq '^[0-9]+$' || [ "$reply" -lt 1 ] || [ "$reply" -gt 65535 ]; then
      echo "  Not a port number (1-65535). Try again."
      continue
    fi
    if port_in_use "$reply"; then
      printf '  Port %s looks busy. Use it anyway? [y/N]: ' "$reply"
      yes=''
      read_line yes
      case "$yes" in [Yy]*) ;; *) continue ;; esac
    fi
    PORT_VALUE="$reply"
    break
  done
  echo

  # 2. session secret
  SESSION_VALUE=$(ask_secret 'Session secret. It keys the hash of session tokens; changing it later signs everyone out.')

  # 3. database password
  PG_VALUE=$(ask_secret 'Database password. Postgres is not published outside the compose network.')
fi

# Rewrite .env.example line by line. A shell loop (rather than sed) keeps every character of the
# values intact, whatever the user typed.
umask 077
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    PORT=*) printf 'PORT=%s\n' "$PORT_VALUE" ;;
    SESSION_SECRET=*) printf 'SESSION_SECRET=%s\n' "$SESSION_VALUE" ;;
    POSTGRES_PASSWORD=*) printf 'POSTGRES_PASSWORD=%s\n' "$PG_VALUE" ;;
    *) printf '%s\n' "$line" ;;
  esac
done <.env.example >.env

echo
echo "Wrote .env (port $PORT_VALUE, generated or entered secrets, not printed here)."
echo
echo "Start Mockbench:"
echo "  docker compose up"
echo
echo "Then open http://localhost:$PORT_VALUE and register — the first account owns the workspace."
