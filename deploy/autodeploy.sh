#!/usr/bin/env bash
#
# Deploy when the production branch moves. Run by cron every couple of minutes
# (setup-autodeploy.sh installs the line); safe to run by hand.
#
#   ./autodeploy.sh          # fetch, and deploy if origin/production is ahead
#
# It is a poller rather than a webhook on purpose. The box has no inbound
# ports at all (cloudflared dials out), and this keeps it that way: the box
# asks GitHub what the branch points at, and nothing on the internet can make
# it deploy. A push to `production` is therefore the whole act of deploying:
#
#   git push origin main:production
#
# `main` is not what it watches. A push to main happens all day, and every
# deploy restarts the containers, which drops every open socket for a few
# seconds. Promoting to production is a deliberate second push.
#
# What it refuses to do: deploy a dirty working tree (someone is editing on
# the box, leave them alone), deploy when the clone is not on `production`,
# or run twice at once. When there is nothing to do it says nothing, so the
# log holds deploys and failures and not a line every two minutes.

set -euo pipefail

cd "$(dirname "$0")"

BRANCH="${BRANCH:-production}"
LOCK="${LOCK:-/tmp/cipher-autodeploy.lock}"

# One at a time. A deploy takes minutes and the timer fires every two, so the
# second tick would otherwise start a build under a running build.
exec 9>"$LOCK"
if ! flock -n 9; then
  exit 0
fi

current="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current" != "$BRANCH" ]]; then
  echo "$(date -Is) not on '$BRANCH' (on '$current'); run setup-autodeploy.sh, or check out $BRANCH" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "$(date -Is) working tree is dirty; not deploying over somebody's edits" >&2
  exit 1
fi

# Quiet on the happy path: a fetch that finds nothing is the normal tick.
git fetch --quiet origin "$BRANCH"
local_head="$(git rev-parse HEAD)"
remote_head="$(git rev-parse "origin/$BRANCH")"
if [[ "$local_head" == "$remote_head" ]]; then
  exit 0
fi

# Only ever fast-forward. A force-pushed production branch is a decision that
# should be made on the box by a person, not by cron.
if ! git merge-base --is-ancestor "$local_head" "$remote_head"; then
  echo "$(date -Is) origin/$BRANCH has been rewritten and does not contain $local_head; not deploying" >&2
  exit 1
fi

echo "$(date -Is) ==> $BRANCH moved ${local_head:0:8} -> ${remote_head:0:8}, deploying"
git log --oneline "$local_head..$remote_head" | sed 's/^/    /'
./deploy.sh
echo "$(date -Is) ==> deployed ${remote_head:0:8}"
