#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REVISION="${1:-${GITHUB_SHA:-$(git rev-parse HEAD)}}"
case "$REVISION" in
  (*[!0-9a-f]*|'') echo "revision must be a lowercase git SHA" >&2; exit 2 ;;
esac
BUILD_TIME="${BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
APP_VERSION="$(node -p "require('./package.json').version")"
PYTHON_BIN="${PYTHON_BIN:-python3}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/release/production}"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

export VITE_APP_VERSION="$APP_VERSION"
export VITE_GIT_SHA="$REVISION"
export VITE_BUILD_TIME="$BUILD_TIME"
npm run build

mkdir -p "$STAGING/release/backend" "$STAGING/release/wheelhouse" "$OUTPUT_DIR"
cp -a dist "$STAGING/release/dist"
cp -a backend/app "$STAGING/release/backend/app"
find "$STAGING/release/backend" -type d -name __pycache__ -prune -exec rm -rf {} +
cp backend/requirements.lock "$STAGING/release/requirements.lock"
"$PYTHON_BIN" -m pip download --disable-pip-version-check --only-binary=:all: \
  --timeout 60 --retries 5 \
  --platform manylinux2014_x86_64 --implementation cp --python-version 311 \
  --dest "$STAGING/release/wheelhouse" -r backend/requirements.lock

cat > "$STAGING/release/release.env" <<EOF
APP_GIT_SHA=$REVISION
APP_BUILD_TIME=$BUILD_TIME
EOF
cat > "$STAGING/release/dist/version.json" <<EOF
{"version":"$APP_VERSION","revision":"$REVISION","builtAt":"$BUILD_TIME"}
EOF
cat > "$STAGING/release/release.json" <<EOF
{"version":"$APP_VERSION","revision":"$REVISION","builtAt":"$BUILD_TIME"}
EOF

ARCHIVE="$OUTPUT_DIR/yanpan-$REVISION.tar.gz"
COPYFILE_DISABLE=1 tar -C "$STAGING/release" -czf "$ARCHIVE" .
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$ARCHIVE" | awk '{print $1}' > "$ARCHIVE.sha256"
else
  shasum -a 256 "$ARCHIVE" | awk '{print $1}' > "$ARCHIVE.sha256"
fi
tar -tzf "$ARCHIVE" >/dev/null
printf '%s\n' "$ARCHIVE"
