#!/usr/bin/env bash
#
# Cut and ship a desktop release in one command.
#
# It does everything the release procedure asks for, in order, and stops the
# moment anything fails so a broken build never ships:
#
#   1. removes the hand-made V1.0.0 release and tag, if they are still there
#   2. dispatches the desktop workflow, which builds and signs the installers
#      for Windows, macOS and Linux and creates a draft release with them and
#      latest.json attached
#   3. waits for that build to finish
#   4. publishes the draft, which is the act of shipping: installed apps see
#      the new version at the updater endpoint and offer it
#
# Run it from anywhere in the repo:  bash desktop/release.sh
#
# The one thing it cannot do for you is prove to GitHub that you are you. If the
# GitHub CLI is not signed in, it runs `gh auth login` once and you follow the
# browser prompt; every run after that is hands-off.
set -euo pipefail

# Work from the repo root, so gh reads the right remote and the version file is
# where we expect.
cd "$(git rev-parse --show-toplevel)"

# The version the installers will carry, straight from the file the build reads.
VERSION="$(sed -n 's/.*"version": "\([0-9][0-9.]*\)".*/\1/p' desktop/src-tauri/tauri.conf.json | head -1)"
TAG="desktop-v${VERSION}"
STALE_TAG="V1.0.0"

if [ -z "$VERSION" ]; then
  echo "Could not read the version from desktop/src-tauri/tauri.conf.json" >&2
  exit 1
fi

echo "==> desktop release v${VERSION}  (tag ${TAG})"

# The GitHub CLI does the GitHub half. Everything below is one of its commands.
# It installs to a fixed place that a terminal opened before the install does
# not have on PATH, so add it here rather than making you reopen anything.
if ! command -v gh >/dev/null 2>&1; then
  for dir in "/c/Program Files/GitHub CLI" "/c/Program Files (x86)/GitHub CLI" "$LOCALAPPDATA/Programs/GitHub CLI"; do
    if [ -x "$dir/gh.exe" ]; then PATH="$dir:$PATH"; break; fi
  done
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "The GitHub CLI is not installed. Install it once, then re-run this:" >&2
  echo "    winget install --id GitHub.cli" >&2
  exit 1
fi

# A one-time browser sign-in. Skipped on every run after the first.
if ! gh auth status >/dev/null 2>&1; then
  echo "==> signing in to GitHub (one time)"
  gh auth login
fi

# 1. The empty hand-made release, if it is still around. It has no installers
#    and no latest.json, so leaving it would keep the updater pointed at a 404.
if gh release view "$STALE_TAG" >/dev/null 2>&1; then
  echo "==> removing the empty ${STALE_TAG} release and its tag"
  gh release delete "$STALE_TAG" --yes --cleanup-tag
fi

# 2. Build and draft-release, all platforms. This is the only thing that
#    produces installers; a release made by hand never will.
echo "==> dispatching the build (three OSes, this takes a while)"
gh workflow run desktop.yml --ref main

# 3. Find the run that just started and wait it out. gh run watch exits non-zero
#    if the build fails, and `set -e` then stops us before publishing anything.
echo "==> waiting for the build to register"
RUN_ID=""
for _ in $(seq 1 20); do
  RUN_ID="$(gh run list --workflow=desktop.yml --event=workflow_dispatch -L 1 \
    --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
  [ -n "$RUN_ID" ] && break
  sleep 3
done

if [ -z "$RUN_ID" ]; then
  echo "The run did not appear. Check the Actions tab and, once it is green," >&2
  echo "publish the ${TAG} draft yourself, or re-run this script." >&2
  exit 1
fi

echo "==> watching build $RUN_ID (installers for all three OSes, ~15 to 25 min)"
gh run watch "$RUN_ID" --exit-status

# 4. Publish the draft the build left behind. This is the moment it ships.
echo "==> publishing ${TAG}"
gh release edit "$TAG" --draft=false --latest

echo ""
echo "Shipped. v${VERSION} is live, installers and updater feed attached."
echo "Installed apps will find it at their next check and offer the update."
