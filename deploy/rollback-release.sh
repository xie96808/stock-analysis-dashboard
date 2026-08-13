#!/usr/bin/env bash
set -Eeuo pipefail
APP_ROOT=/srv/yanpan-dashboard
SERVICE=stock-analysis-dashboard
REVISION="${1:-}"
[[ "$REVISION" =~ ^(legacy|[0-9a-f]{40})$ ]] || { echo "usage: rollback-release REVISION" >&2; exit 2; }
TARGET="$APP_ROOT/releases/$REVISION"
[[ -d "$TARGET" ]] || { echo "release not found: $TARGET" >&2; exit 1; }
exec 9>"$APP_ROOT/deploy.lock"; flock -n 9
PREVIOUS="$(readlink -f "$APP_ROOT/current")"
ln -sfn "$TARGET" "$APP_ROOT/current.next"; mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
if nginx -t && systemctl reload nginx && systemctl restart "$SERVICE" && curl -fsS --max-time 5 http://127.0.0.1:8000/api/health >/dev/null; then
  echo "ROLLBACK_OK revision=$REVISION"
else
  ln -sfn "$PREVIOUS" "$APP_ROOT/current.next"; mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
  nginx -t && systemctl reload nginx || true
  systemctl restart "$SERVICE"
  exit 1
fi
