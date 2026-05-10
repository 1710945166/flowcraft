#!/bin/bash
# flowcraft release script
# Usage: bash scripts/release.sh <version> [notes-file]
# Example: bash scripts/release.sh v0.2.0

set -e

VERSION=$1
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version> [notes-file]"
  echo "Example: $0 v0.3.0"
  exit 1
fi

if ! command -v gh &> /dev/null; then
  echo "Error: gh (GitHub CLI) is not installed."
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working directory is not clean."
  exit 1
fi

PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

if git rev-parse "$VERSION" >/dev/null 2>&1; then
  echo "Tag $VERSION exists. Overwriting..."
  git tag -d "$VERSION" 2>/dev/null || true
  git push origin ":refs/tags/$VERSION" 2>/dev/null || true
fi

NOTES=""
if [ -n "$2" ]; then
  NOTES=$(cat "$2")
elif [ -n "$PREV_TAG" ]; then
  NOTES=$(git log "$PREV_TAG..HEAD" --oneline --no-merges --format="- %s")
else
  NOTES="Release $VERSION"
fi

git tag -a "$VERSION" -m "$VERSION"
git push origin "$VERSION"
gh release create "$VERSION" --title "$VERSION" --notes "$NOTES"
echo "Release $VERSION created!"
