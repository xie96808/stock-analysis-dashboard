#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT=/srv/yanpan-dashboard
INCOMING_ROOT=/home/stockdeploy/incoming
SERVICE=stock-analysis-dashboard
DOMAIN=yanpan.xieyw.top
KEEP_RELEASES=8

die() { printf 'deploy: %s\n' "$*" >&2; exit 1; }
[[ $# -eq 3 ]] || die "usage: deploy-release ARCHIVE REVISION SHA256"
ARCHIVE="$1"; REVISION="$2"; EXPECTED_SHA="$3"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || die "invalid revision"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]] || die "invalid checksum"
[[ "$ARCHIVE" == "$INCOMING_ROOT/yanpan-$REVISION.tar.gz" ]] || die "archive path is outside incoming area"
[[ -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || die "archive is missing"

exec 9>"$APP_ROOT/deploy.lock"
flock -n 9 || die "another deployment is running"

ACTUAL_SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || die "checksum mismatch"

RELEASES="$APP_ROOT/releases"
SHARED="$APP_ROOT/shared"
TARGET="$RELEASES/$REVISION"
TEMP="$TARGET.tmp"
PREVIOUS="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
BACKUP=""
mkdir -p "$RELEASES" "$SHARED/data" "$APP_ROOT/backups"

if [[ "$PREVIOUS" == "$TARGET" ]] && \
   curl -fsS --max-time 3 http://127.0.0.1:8000/api/health | grep -q "\"revision\":\"$REVISION\""; then
  rm -f "$ARCHIVE"
  printf 'DEPLOY_ALREADY_CURRENT revision=%s\n' "$REVISION"
  exit 0
fi
[[ "$PREVIOUS" == "$TARGET" ]] || rm -rf "$TARGET"

rollback() {
  local status=$?
  trap - ERR
  printf 'deploy failed (status %s); rolling back\n' "$status" >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -sfn "$PREVIOUS" "$APP_ROOT/current.rollback"
    mv -Tf "$APP_ROOT/current.rollback" "$APP_ROOT/current"
    systemctl restart "$SERVICE" || true
  fi
  rm -rf "$TEMP"
  rm -f "$APP_ROOT/incoming-$REVISION.tar.gz"
  exit "$status"
}
trap rollback ERR

rm -rf "$TEMP"
mkdir -p "$TEMP"
ROOT_ARCHIVE="$APP_ROOT/incoming-$REVISION.tar.gz"
install -o root -g root -m 0600 "$ARCHIVE" "$ROOT_ARCHIVE"
[[ "$(sha256sum "$ROOT_ARCHIVE" | awk '{print $1}')" == "$EXPECTED_SHA" ]] || die "copied archive checksum mismatch"
python3 - "$ROOT_ARCHIVE" <<'PY'
import pathlib
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
with tarfile.open(archive, "r:gz") as bundle:
    for member in bundle.getmembers():
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"unsafe archive path: {member.name}")
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"unsupported archive member: {member.name}")
PY
tar -xzf "$ROOT_ARCHIVE" -C "$TEMP" --no-same-owner --no-same-permissions
rm -f "$ROOT_ARCHIVE"
[[ -f "$TEMP/dist/index.html" ]] || die "frontend artifact missing"
[[ -f "$TEMP/backend/app/main.py" ]] || die "backend artifact missing"
[[ -f "$TEMP/requirements.lock" ]] || die "requirements lock missing"
[[ -f "$TEMP/release.env" ]] || die "release metadata missing"
grep -qx "APP_GIT_SHA=$REVISION" "$TEMP/release.env" || die "release revision mismatch"

python3 -m venv "$TEMP/.venv"
"$TEMP/.venv/bin/pip" install --disable-pip-version-check --no-index \
  --find-links "$TEMP/wheelhouse" -r "$TEMP/requirements.lock"
rm -rf "$TEMP/wheelhouse"
ln -s "$SHARED/data" "$TEMP/data"
chown -R root:root "$TEMP"
chown -R stockdash:stockdash "$SHARED/data"
chmod -R a+rX "$TEMP"

if [[ -f "$SHARED/data/dashboard.sqlite3" ]]; then
  BACKUP="$APP_ROOT/backups/dashboard-$(date -u +%Y%m%dT%H%M%SZ)-$REVISION.sqlite3"
  cp -a "$SHARED/data/dashboard.sqlite3" "$BACKUP"
fi

mv "$TEMP" "$TARGET"
ln -sfn "$TARGET" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
systemctl restart "$SERVICE"

for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:8000/api/health | grep -q "\"revision\":\"$REVISION\""; then
    break
  fi
  sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:8000/api/health | grep -q "\"revision\":\"$REVISION\""
nginx -t
curl -fsSk --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/version.json" | grep -q "\"revision\":\"$REVISION\""

trap - ERR
rm -f "$ARCHIVE" "$ROOT_ARCHIVE"
find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -path "$TARGET" -printf '%T@ %p\n' \
  | sort -rn | tail -n "+$KEEP_RELEASES" | cut -d' ' -f2- | xargs -r rm -rf
printf 'DEPLOY_OK revision=%s previous=%s backup=%s\n' "$REVISION" "${PREVIOUS:-none}" "${BACKUP:-none}"
