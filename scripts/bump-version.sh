#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/manifest.json"
BTL_FILE="$ROOT/native-host/btl_file_writer.py"

bump_type="${1:-patch}"

current=$(node -e "console.log(require('$MANIFEST').version)")
echo "Current version: $current"

IFS='.' read -r major minor patch <<< "$current"

case "$bump_type" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
  *)
    echo "Usage: $0 {major|minor|patch}"
    exit 1
    ;;
esac

new_version="$major.$minor.$patch"
echo "New version: $new_version"

# Update manifest.json
node -e "
  const p = require('$MANIFEST');
  p.version = '$new_version';
  require('fs').writeFileSync('$MANIFEST', JSON.stringify(p, null, 2) + '\n');
"

# Update version string in btl_file_writer.py main()
sed -i '' "s/\"version\": \"$current\"/\"version\": \"$new_version\"/" "$BTL_FILE" 2>/dev/null || \
  sed -i "s/\"version\": \"$current\"/\"version\": \"$new_version\"/" "$BTL_FILE"

# Update package.json
node -e "
  const p = require('$ROOT/package.json');
  p.version = '$new_version';
  require('fs').writeFileSync('$ROOT/package.json', JSON.stringify(p, null, 2) + '\n');
"

echo "Bumped to $new_version"

# Git operations
git add "$MANIFEST" "$BTL_FILE" "$ROOT/package.json"
git commit -m "Bump version to $new_version"
git tag "v$new_version"

echo ""
echo "Done. Run the following to push:"
echo "  git push origin main && git push origin v$new_version"
