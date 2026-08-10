#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run typecheck
npm run test:frontend
npm run test:backend
npm run build
git diff --check

printf '\nAll release checks passed.\n'
