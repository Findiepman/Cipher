#!/usr/bin/env bash
#
# Pull, build, migrate, restart. A script and not CI, because there is one box
# and one person deploying to it.
#
#   ./deploy.sh              # deploy whatever is committed on this branch
#   ./deploy.sh --no-pull    # deploy the working tree as it stands
#
# Migrations are NOT run from here. The server image applies them on start
# (server/docker-entrypoint.sh), so the schema is always applied by the exact
# build about to serve it - a deploy cannot half-migrate and then start a
# different image against the result.

set -euo pipefail

cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.prod.yml)
PULL=1

for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f .env ]]; then
  echo "deploy/.env is missing. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

# Fail before building rather than after, on the values whose absence produces
# a confusing failure much later: an empty JWT_SECRET stops the server at boot,
# an empty tunnel token leaves the site unreachable with every container green.
missing=()
for key in APP_URL POSTGRES_PASSWORD JWT_SECRET SMTP_PASSWORD CLOUDFLARE_TUNNEL_TOKEN; do
  value="$(grep -E "^${key}=" .env | head -1 | cut -d= -f2- | tr -d "\"'" || true)"
  # Written as an if rather than `[[ ... ]] && missing+=(...)`, because under
  # `set -e` that form returns non-zero on the last iteration whose test fails.
  if [[ -z "$value" ]]; then
    missing+=("$key")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "deploy/.env is missing values for: ${missing[*]}" >&2
  exit 1
fi

if [[ $PULL -eq 1 ]]; then
  echo "==> pulling"
  git pull --ff-only
fi

echo "==> backing up the database before anything changes"
# A migration that goes wrong is the one failure a redeploy cannot undo.
./backup.sh || echo "    (no database yet - first deploy)"

echo "==> building"
"${COMPOSE[@]}" build

echo "==> starting"
"${COMPOSE[@]}" up -d --remove-orphans

echo "==> waiting for the server to report ready"
for _ in $(seq 1 30); do
  if [[ "$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | grep '^server ' | awk '{print $2}')" == "healthy" ]]; then
    echo "    ready"
    break
  fi
  sleep 2
done

echo "==> pruning old images"
docker image prune -f >/dev/null

echo
"${COMPOSE[@]}" ps
echo
echo "Logs:   docker compose -f deploy/docker-compose.prod.yml logs -f server"
