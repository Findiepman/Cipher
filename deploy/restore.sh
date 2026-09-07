#!/usr/bin/env bash
#
# Restore a dump written by backup.sh.
#
#   ./restore.sh /var/backups/cipher/messenger-2026-09-07T03-17-00Z.sql.gz
#
# This is destructive: the dump is --clean --if-exists, so it drops and
# recreates everything it contains. It exists as a script because the time you
# need it is the time you least want to be improvising with psql flags.

set -euo pipefail

cd "$(dirname "$0")"

dump="${1:-}"
if [[ -z "$dump" || ! -f "$dump" ]]; then
  echo "usage: ./restore.sh <path-to-dump.sql.gz>" >&2
  exit 2
fi

echo "This will REPLACE the contents of the messenger database with:"
echo "  $dump"
read -r -p "Type the word restore to continue: " confirm
[[ "$confirm" == "restore" ]] || { echo "aborted"; exit 1; }

# The server holds open connections and would fight the restore.
docker compose -f docker-compose.prod.yml stop server

gunzip -c "$dump" \
  | docker compose -f docker-compose.prod.yml exec -T postgres \
      psql --username messenger --dbname messenger

docker compose -f docker-compose.prod.yml start server
echo "done - the server is starting and will re-apply any newer migrations"
