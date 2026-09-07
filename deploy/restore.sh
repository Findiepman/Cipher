#!/usr/bin/env bash
#
# Restore a dump written by backup.sh, or rehearse doing so.
#
#   ./restore.sh --rehearse ~/cipher-backups/messenger-<stamp>.sql.gz
#   ./restore.sh            ~/cipher-backups/messenger-<stamp>.sql.gz
#
# An untested backup is a guess, and the obvious way to test one used to be the
# only way: replace the live database and see what happens. That is a terrible
# first test once the box has real accounts on it, so it never got run, which is
# how a backup stays a guess indefinitely.
#
# --rehearse breaks that. It loads the dump into a scratch database beside the
# live one, checks that the schema and the rows arrived, and drops the scratch
# database again. Nothing is stopped, nothing is replaced, and it answers the
# question the real restore would have answered: does this file actually come
# back? Run it after the first nightly dump, and again whenever the schema
# changes enough to make you wonder.
#
# Without the flag this is the real thing, and it is destructive: the dump is
# --clean --if-exists, so it drops and recreates everything it contains. It
# exists as a script because the time you need it is the time you least want to
# be improvising with psql flags.

set -euo pipefail

cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.prod.yml)
PSQL_BASE=(psql --username messenger --no-psqlrc -v ON_ERROR_STOP=1)

REHEARSE=0
dump=""

for arg in "$@"; do
  case "$arg" in
    --rehearse) REHEARSE=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) dump="$arg" ;;
  esac
done

if [[ -z "$dump" || ! -f "$dump" ]]; then
  echo "usage: ./restore.sh [--rehearse] <path-to-dump.sql.gz>" >&2
  exit 2
fi

if ! "${COMPOSE[@]}" ps -q postgres 2>/dev/null | grep -q .; then
  echo "the postgres container is not running - start the stack first" >&2
  exit 1
fi

# ON_ERROR_STOP is on for both paths. Without it psql reports success after
# skipping every statement it could not run, which in an emergency means a
# half-restored database that looks restored.

if [[ "$REHEARSE" == 1 ]]; then
  scratch="messenger_restore_check_$(date -u +%Y%m%d%H%M%S)"

  # The scratch database goes away whatever happens, including on a failed
  # load. Leaving one behind would quietly consume the same disk the live
  # database is on.
  cleanup() {
    "${COMPOSE[@]}" exec -T postgres dropdb --username messenger --if-exists "$scratch" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  echo "==> rehearsing into $scratch (the live database is not touched)"
  "${COMPOSE[@]}" exec -T postgres createdb --username messenger "$scratch"

  # stdout goes nowhere: a dump replays as thousands of command tags and the
  # only interesting outcome is whether ON_ERROR_STOP stopped it. stderr stays.
  gunzip -c "$dump" \
    | "${COMPOSE[@]}" exec -T postgres "${PSQL_BASE[@]}" --dbname "$scratch" --quiet >/dev/null

  # Two questions, because either one alone can pass on a useless dump: did the
  # schema arrive, and did any rows come with it. A dump of an empty database
  # restores perfectly and is worth nothing.
  echo "==> checking what arrived"
  "${COMPOSE[@]}" exec -T postgres "${PSQL_BASE[@]}" --dbname "$scratch" --tuples-only --command "
    SELECT '  tables:   ' || count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    SELECT '  users:    ' || count(*) FROM \"User\";
    SELECT '  devices:  ' || count(*) FROM \"Device\";
    SELECT '  messages: ' || count(*) FROM \"Message\";
  "

  # A restore that produced no user rows is not a restore worth having, and the
  # whole point of rehearsing is to find that out now rather than later.
  users="$("${COMPOSE[@]}" exec -T postgres "${PSQL_BASE[@]}" --dbname "$scratch" \
    --tuples-only --no-align --command 'SELECT count(*) FROM "User";' | tr -d '[:space:]')"
  if [[ "$users" == "0" ]]; then
    echo "the dump restored cleanly but contains no accounts - check which database was dumped" >&2
    exit 1
  fi

  echo "==> rehearsal passed. $dump restores, and it has $users accounts in it."
  exit 0
fi

echo "This will REPLACE the contents of the messenger database with:"
echo "  $dump"
echo "Rehearse it first with --rehearse if you have not already."
read -r -p "Type the word restore to continue: " confirm
[[ "$confirm" == "restore" ]] || { echo "aborted"; exit 1; }

# The server holds open connections and would fight the restore.
"${COMPOSE[@]}" stop server

gunzip -c "$dump" | "${COMPOSE[@]}" exec -T postgres "${PSQL_BASE[@]}" --dbname messenger

"${COMPOSE[@]}" start server
echo "done - the server is starting and will re-apply any newer migrations"
