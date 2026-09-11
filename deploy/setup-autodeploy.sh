#!/usr/bin/env bash
#
# Make the box deploy itself whenever the production branch moves. Run once,
# on the box.
#
#   ./setup-autodeploy.sh
#
# Three steps:
#
#   1. put the clone on the `production` branch, tracking origin/production,
#      which is the branch autodeploy.sh watches. Refuses if that branch does
#      not exist on GitHub yet: push it first from a machine with main.
#   2. run autodeploy.sh once by hand, so the cron entry is trusted only after
#      the command in it has actually run here
#   3. install the crontab line, idempotently
#
# After this, deploying is `git push origin main:production` from anywhere,
# and the box picks it up within two minutes. `deploy.sh` by hand still works
# and does the same thing sooner.

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$script_dir"

BRANCH="${BRANCH:-production}"
SCHEDULE="${SCHEDULE:-*/2 * * * *}"
LOG="${LOG:-$HOME/cipher-autodeploy.log}"

# ---------------------------------------------------------------- 1. the branch

echo "==> fetching"
git fetch --quiet origin

if ! git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null; then
  cat >&2 <<EOF
There is no '$BRANCH' branch on origin yet. Create it from a machine that has
main, then run this again:

    git push origin main:$BRANCH

That push is also how every later deploy happens.
EOF
  exit 1
fi

current="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current" != "$BRANCH" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "the working tree has changes; commit or stash them before switching to $BRANCH" >&2
    exit 1
  fi
  echo "==> switching the clone from '$current' to '$BRANCH'"
  if git rev-parse --verify --quiet "$BRANCH" >/dev/null; then
    git checkout --quiet "$BRANCH"
  else
    git checkout --quiet -b "$BRANCH" "origin/$BRANCH"
  fi
fi
git branch --quiet --set-upstream-to="origin/$BRANCH" "$BRANCH"
echo "==> on $BRANCH, tracking origin/$BRANCH"

if ! command -v flock >/dev/null 2>&1; then
  echo "flock is missing (package util-linux); autodeploy.sh needs it to run one deploy at a time" >&2
  exit 1
fi

# --------------------------------------------------------------- 2. run it once

echo "==> running autodeploy.sh once by hand"
./autodeploy.sh
echo "    (silence above means the box is already at origin/$BRANCH)"

# ------------------------------------------------------------------ 3. the cron

line="$SCHEDULE $script_dir/autodeploy.sh >> $LOG 2>&1"

# Drop any entry that already points at this autodeploy.sh before adding one,
# so running this twice does not poll twice as often.
existing="$(crontab -l 2>/dev/null || true)"
kept="$(printf '%s\n' "$existing" | grep -vF "$script_dir/autodeploy.sh" || true)"
printf '%s\n%s\n' "$kept" "$line" | sed '/^$/d' | crontab -

echo "==> installed:"
crontab -l | sed 's/^/    /'
cat <<EOF

Auto-deploy is on. Every two minutes the box checks origin/$BRANCH and runs
deploy.sh when it has moved. $LOG records each deploy and each refusal;
quiet ticks write nothing.

To deploy from now on:
    git push origin main:$BRANCH

To stop it:
    crontab -e     and remove the autodeploy.sh line
EOF
