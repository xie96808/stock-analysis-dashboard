#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="$(node -p "require('./package.json').version")"
RELEASE_DIR="$ROOT_DIR/release"
ARCHIVE="$RELEASE_DIR/stock-analysis-dashboard-v$VERSION.tar.gz"
CHECKSUM="$ARCHIVE.sha256"

mkdir -p "$RELEASE_DIR"
git archive --format=tar.gz --prefix="stock-analysis-dashboard-v$VERSION/" --output="$ARCHIVE" HEAD
shasum -a 256 "$ARCHIVE" > "$CHECKSUM"
tar -tzf "$ARCHIVE" >/dev/null
(cd "$RELEASE_DIR" && shasum -a 256 -c "$(basename "$CHECKSUM")")

printf 'Release archive: %s\nChecksum: %s\n' "$ARCHIVE" "$CHECKSUM"
