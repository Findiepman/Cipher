#!/usr/bin/env bash
#
# Nightly pg_dump with retention. Install it with:
#
#   crontab -e
#   17 3 * * * /home/YOU/private-messenger/deploy/backup.sh >> /var/log/cipher-backup.log 2>&1
#
# BACKUP_DIR should be somewhere that is not the same disk as the Docker
# volume. A backup that dies with the drive it was protecting against is not a
# backup - point it at a USB disk, a NAS mount, or anything else physically
# separate.

set -euo pipefail

cd "$(dirname "$0")"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/cipher}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
target="$BACKUP_DIR/messenger-$stamp.sql.gz"

# --clean --if-exists so the dump can be restored over an existing database
# without hand-dropping it first, which is the state you are actually in when
# you need this.
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump --username messenger --clean --if-exists messenger \
  | gzip > "$target"

# A zero-length or near-empty file means pg_dump failed inside the pipe, where
# `set -o pipefail` catches the exit code but gzip still creates the file.
size="$(stat -c %s "$target")"
if [[ "$size" -lt 1024 ]]; then
  echo "backup looks empty (${size} bytes) - leaving it for inspection and failing" >&2
  exit 1
fi

echo "$(date -u +%FT%TZ)  wrote $target ($(numfmt --to=iec "$size"))"

# Delete old dumps only after a new one has been written and checked.
find "$BACKUP_DIR" -name 'messenger-*.sql.gz' -type f -mtime "+$RETAIN_DAYS" -delete

echo "$(date -u +%FT%TZ)  retained $(find "$BACKUP_DIR" -name 'messenger-*.sql.gz' | wc -l) dumps"
