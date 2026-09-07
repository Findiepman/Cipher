#!/bin/sh
set -e

# Migrations run here rather than from deploy.sh so that the schema is applied
# by the exact image that is about to serve it - a deploy cannot half-apply a
# migration and then start last week's build against it. `migrate deploy` only
# ever applies committed migrations forward, never generates or resets, so it
# is safe to run on every start including a plain restart.
echo "==> applying migrations"
# --no makes npx fail loudly if the CLI is missing rather than silently
# downloading one: a container that fetches a different Prisma version at boot
# would apply migrations with tooling nobody tested.
npx --no prisma migrate deploy

echo "==> starting server"
exec "$@"
