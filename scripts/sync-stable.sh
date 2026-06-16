#!/usr/bin/env bash
# Commit and push a stable change from the cloud environment.
# Usage: ./scripts/sync-stable.sh "commit message"
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 \"commit message\"" >&2
  exit 1
fi

MESSAGE="$1"
BRANCH="$(git branch --show-current)"

if [[ -z "$(git status --porcelain)" ]]; then
  echo "Nothing to commit — working tree is clean."
  exit 0
fi

echo "==> Staging changes"
git add -A
git status --short

echo "==> Committing on ${BRANCH}"
git commit -m "$MESSAGE"

echo "==> Pushing to origin/${BRANCH}"
git push -u origin "$BRANCH"

echo "==> Synced to GitHub"
