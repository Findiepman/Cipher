#!/usr/bin/env bash
#
# Install the nightly backup, then prove it works. Run once, on the box.
#
#   ./setup-backups.sh /mnt/backup/cipher
#
# Four steps, in the order that makes each one worth doing:
#
#   1. check the target directory is writable, and is not the disk the database
#      already lives on
#   2. take a dump now, so the cron entry is trusted only after the command in
#      it has actually run
#   3. rehearse restoring that dump into a scratch database, because a dump
#      nobody has read back is a guess
#   4. install the crontab line, idempotently
#
# There is deliberately no default for the directory. The default is what
# backup.sh already does on its own, and it is the thing this script exists to
# talk you out of.

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$script_dir"

SCHEDULE="${SCHEDULE:-17 3 * * *}"
LOG="${LOG:-$HOME/cipher-backup.log}"
SAME_DISK_OK=0
REHEARSE=1
target=""

for arg in "$@"; do
  case "$arg" in
    --same-disk-ok) SAME_DISK_OK=1 ;;
    --no-rehearse) REHEARSE=0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) target="$arg" ;;
  esac
done

if [[ -z "$target" ]]; then
  cat >&2 <<'USAGE'
usage: ./setup-backups.sh <backup-dir> [--same-disk-ok] [--no-rehearse]

  <backup-dir>     where dumps go. Point it at another disk: a USB drive, a NAS
                   mount, anything that will not die with the drive it is
                   protecting against.
  --same-disk-ok   install anyway when <backup-dir> is on the same filesystem
                   as the database. A decision, not an accident.
  --no-rehearse    skip the restore rehearsal. Only if you have run
                   ./restore.sh --rehearse already.
USAGE
  exit 2
fi

# ---------------------------------------------------------------- 1. the target

if ! mkdir -p "$target" 2>/dev/null; then
  echo "cannot create $target - check permissions, or pick another path" >&2
  exit 1
fi
if [[ ! -w "$target" ]]; then
  echo "$target is not writable by $(whoami)" >&2
  exit 1
fi
target="$(cd "$target" && pwd)"

# The pgdata volume is a named docker volume, so it sits under /var/lib/docker.
# Comparing device numbers catches the case the comment in backup.sh warns
# about: a backup on the same physical disk as the thing it is protecting.
db_disk="$(stat -c %d /var/lib/docker 2>/dev/null || echo unknown)"
backup_disk="$(stat -c %d "$target")"
if [[ "$db_disk" != "unknown" && "$db_disk" == "$backup_disk" ]]; then
  if [[ "$SAME_DISK_OK" == 0 ]]; then
    cat >&2 <<EOF
$target is on the same filesystem as the database volume.

A backup that dies with the drive it was protecting against is not a backup. It
still covers a bad migration, a dropped table and a container that eats itself,
which is not nothing, so this is a warning and not a refusal: pass
--same-disk-ok to install it anyway.
EOF
    exit 1
  fi
  echo "==> warning: backing up onto the same disk as the database, as asked"
fi

echo "==> backups will go to $target"

# ------------------------------------------------------------ 2. take one now

echo "==> taking a dump now, before trusting a cron entry with it"
BACKUP_DIR="$target" ./backup.sh

newest="$(find "$target" -name 'messenger-*.sql.gz' -type f -printf '%T@ %p\n' \
  | sort -rn | head -1 | cut -d' ' -f2-)"
if [[ -z "$newest" ]]; then
  echo "backup.sh reported success but wrote no dump - stopping" >&2
  exit 1
fi

# --------------------------------------------------------------- 3. read it back

if [[ "$REHEARSE" == 1 ]]; then
  echo "==> rehearsing a restore of $newest"
  ./restore.sh --rehearse "$newest"
fi

# ------------------------------------------------------------------ 4. the cron

line="$SCHEDULE BACKUP_DIR=$target $script_dir/backup.sh >> $LOG 2>&1"

# Drop any entry that already points at this backup.sh before adding one, so
# running this twice does not give you two dumps a night.
existing="$(crontab -l 2>/dev/null || true)"
kept="$(printf '%s\n' "$existing" | grep -vF "$script_dir/backup.sh" || true)"
printf '%s\n%s\n' "$kept" "$line" | sed '/^$/d' | crontab -

echo "==> installed:"
crontab -l | sed 's/^/    /'
cat <<EOF

Backups are on. Dumps land in $target, 14 days are kept, and $LOG
records each run.

Two things worth doing once, later:
  - check $LOG after the first night, to confirm cron ran it and not
    just you
  - run ./restore.sh --rehearse against a dump every so often, especially
    after a migration
EOF
