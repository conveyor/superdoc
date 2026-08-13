#!/usr/bin/env bash
#
# publish-fork.sh
# ---------------
# Build the SuperDoc fork on the currently checked-out branch and publish it to
# npm as @conveyorhq/superdoc — without ever leaving the rename committed in git.
#
# This is Conveyor-fork infrastructure. It is committed to the fork so every dev
# has it, but it is never part of an upstream PR (those are cut as focused
# branches off upstream main — see CONVEYOR.md).
#
# Usage:
#   pnpm publish:conveyor                 # auto-pick next -conveyor.N, ask before publishing
#   pnpm publish:conveyor 1.45.0-conveyor.7   # publish an explicit version
#   pnpm publish:conveyor --dry-run       # build + pack only; do NOT publish
#   pnpm publish:conveyor --yes           # skip the confirmation prompt (used by CI)
#
# What it does, step by step:
#   1. Figures out the fork version (upstream base version + a "-conveyor.N" suffix).
#   2. Temporarily sets the package name/version to the fork values.
#   3. Builds and packs the package (same build the tarball has always used).
#   4. Publishes the tarball publicly (after a yes/no prompt, unless --yes).
#   5. Restores package.json no matter what — so your working tree stays clean.

set -euo pipefail

FORK_NAME="@conveyorhq/superdoc"
# Fork builds are prereleases ("-conveyor.N"), so npm requires an explicit dist-tag
# (it refuses to auto-assign "latest" to a prerelease). Publishing under our own
# tag also keeps fork builds from ever becoming the default `npm install` target.
DIST_TAG="conveyor"
# This script lives at <repo>/scripts/conveyor/, so the repo root is two levels up.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/superdoc"
PKG_JSON="$PKG_DIR/package.json"

# --- Parse args: optional explicit version, --dry-run, --yes -------------------
DRY_RUN=false
ASSUME_YES=false
EXPLICIT_VERSION=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes) ASSUME_YES=true ;;
    "") ;; # ignore empty args (CI may pass an empty version input)
    -*) echo "Unknown option: $arg" >&2; exit 1 ;;
    *) EXPLICIT_VERSION="$arg" ;;
  esac
done

# --- Work out which version to publish -----------------------------------------
# The upstream base version lives in package.json (e.g. 1.45.0). Fork builds are
# published as "<base>-conveyor.N" so they never collide with real upstream
# releases and it's obvious at a glance that a build came from our fork.
BASE_VERSION="$(node -p "require('$PKG_JSON').version")"

if [[ -n "$EXPLICIT_VERSION" ]]; then
  FORK_VERSION="$EXPLICIT_VERSION"
else
  # Ask npm which -conveyor.N builds already exist for this base version, then
  # use the next number. (npm view exits non-zero the very first time, before
  # the package exists — that's fine, we fall back to N=1.)
  PUBLISHED_JSON="$(npm view "$FORK_NAME" versions --json 2>/dev/null || true)"
  NEXT_N="$(BASE_VERSION="$BASE_VERSION" PUBLISHED_JSON="$PUBLISHED_JSON" node -e '
    const base = process.env.BASE_VERSION;
    let versions = [];
    try { versions = JSON.parse(process.env.PUBLISHED_JSON || "[]"); } catch (_) {}
    if (!Array.isArray(versions)) versions = [versions].filter(Boolean);

    const prefix = base + "-conveyor.";
    const usedNumbers = versions
      .filter((version) => typeof version === "string" && version.startsWith(prefix))
      .map((version) => parseInt(version.slice(prefix.length), 10))
      .filter((n) => Number.isInteger(n));

    const nextNumber = usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1;
    process.stdout.write(String(nextNumber));
  ')"
  FORK_VERSION="${BASE_VERSION}-conveyor.${NEXT_N}"
fi

CURRENT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"

echo "──────────────────────────────────────────────"
echo "  Package : $FORK_NAME"
echo "  Version : $FORK_VERSION   (base $BASE_VERSION)"
echo "  Branch  : $CURRENT_BRANCH"
echo "  Dry run : $DRY_RUN"
echo "──────────────────────────────────────────────"

# --- Always restore package.json on exit ---------------------------------------
# Even if the build fails partway, this puts the name/version back so the rename
# is never left behind in your working tree.
restore_pkg_json() {
  git -C "$REPO_ROOT" checkout -- packages/superdoc/package.json 2>/dev/null || true
}
trap restore_pkg_json EXIT

# --- 1) Temporarily set the fork name + version --------------------------------
# Set version BEFORE building so the version baked into the bundle matches.
( cd "$PKG_DIR" && npm pkg set name="$FORK_NAME" version="$FORK_VERSION" )

# --- 2) Build + pack from the current branch -----------------------------------
( cd "$REPO_ROOT" && pnpm --filter superdoc build )
( cd "$PKG_DIR" && pnpm pack )

# pnpm names the tarball after the (scoped) package: @conveyorhq/superdoc ->
# conveyorhq-superdoc-<version>.tgz
TARBALL="$PKG_DIR/conveyorhq-superdoc-${FORK_VERSION}.tgz"
if [[ ! -f "$TARBALL" ]]; then
  echo "Expected tarball not found: $TARBALL" >&2
  exit 1
fi
echo "Packed: $TARBALL"

# --- 3) Publish (unless --dry-run) ---------------------------------------------
if $DRY_RUN; then
  echo "Dry run — not publishing. Tarball left at:"
  echo "  $TARBALL"
  exit 0
fi

if ! $ASSUME_YES; then
  read -r -p "Publish $FORK_NAME@$FORK_VERSION to npm (public, tag: $DIST_TAG)? [y/N] " reply
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    echo "Aborted — nothing published. Tarball left at:"
    echo "  $TARBALL"
    exit 0
  fi
fi

npm publish "$TARBALL" --access public --tag "$DIST_TAG"
echo "✅ Published $FORK_NAME@$FORK_VERSION (dist-tag: $DIST_TAG)"
echo
echo "In a consumer, set:"
echo "  \"superdoc\": \"npm:$FORK_NAME@$FORK_VERSION\""
