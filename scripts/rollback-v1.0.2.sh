#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(pwd)}"
BASE_REF="${BASE_REF:-v1.0.1}"
HOTFIX_REF="${HOTFIX_REF:-v1.0.2}"

if ! git -C "$ROOT" diff --quiet || ! git -C "$ROOT" diff --cached --quiet; then
  echo "rollback aborted: target worktree is not clean" >&2
  exit 2
fi

git -C "$ROOT" rev-parse --verify "$BASE_REF^{commit}" >/dev/null
git -C "$ROOT" rev-parse --verify "$HOTFIX_REF^{commit}" >/dev/null
git -C "$ROOT" merge-base --is-ancestor "$BASE_REF" "$HOTFIX_REF"

git -C "$ROOT" diff --binary "$BASE_REF" "$HOTFIX_REF" | git -C "$ROOT" apply --check --reverse
git -C "$ROOT" diff --binary "$BASE_REF" "$HOTFIX_REF" | git -C "$ROOT" apply --reverse

git -C "$ROOT" diff --quiet "$BASE_REF" --
echo "rollback verified: $HOTFIX_REF working tree now matches $BASE_REF"
