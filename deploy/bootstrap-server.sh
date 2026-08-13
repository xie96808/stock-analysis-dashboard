#!/usr/bin/env bash
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
[[ $# -eq 1 && "$1" == ssh-ed25519\ * ]] || { echo "usage: bootstrap-server 'ssh-ed25519 PUBLIC_KEY'" >&2; exit 2; }
DEPLOY_PUBLIC_KEY="$1"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
APP_ROOT=/srv/yanpan-dashboard
LEGACY=/srv/stock-analysis-dashboard

id stockdash >/dev/null
if ! id stockdeploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash stockdeploy
fi

install -d -o root -g root -m 0755 "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/backups"
install -d -o stockdash -g stockdash -m 0750 "$APP_ROOT/shared" "$APP_ROOT/shared/data"
install -d -o stockdeploy -g stockdeploy -m 0700 /home/stockdeploy/.ssh /home/stockdeploy/incoming
printf 'restrict %s\n' "$DEPLOY_PUBLIC_KEY" > /home/stockdeploy/.ssh/authorized_keys
chown stockdeploy:stockdeploy /home/stockdeploy/.ssh/authorized_keys
chmod 0600 /home/stockdeploy/.ssh/authorized_keys

install -o root -g root -m 0755 /tmp/deploy-release.sh /usr/local/sbin/deploy-yanpan-release
install -o root -g root -m 0755 /tmp/rollback-release.sh /usr/local/sbin/rollback-yanpan-release
install -o root -g root -m 0440 /tmp/stockdeploy.sudoers /etc/sudoers.d/stockdeploy-yanpan
visudo -cf /etc/sudoers.d/stockdeploy-yanpan

if [[ -d "$LEGACY" && ! -e "$APP_ROOT/releases/legacy" ]]; then
  cp -a "$LEGACY/data/." "$APP_ROOT/shared/data/"
  mv "$LEGACY" "$APP_ROOT/releases/legacy"
  rm -rf "$APP_ROOT/releases/legacy/data"
  ln -s "$APP_ROOT/shared/data" "$APP_ROOT/releases/legacy/data"
fi
[[ -d "$APP_ROOT/releases/legacy" ]] || { echo "legacy release missing" >&2; exit 1; }
chown -R stockdash:stockdash "$APP_ROOT/shared/data"

ln -sfn "$APP_ROOT/releases/legacy" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"

cp -a /etc/systemd/system/stock-analysis-dashboard.service "/root/stock-analysis-dashboard.service.$STAMP.backup"
install -o root -g root -m 0644 /tmp/stock-analysis-dashboard.service /etc/systemd/system/stock-analysis-dashboard.service
cp -a /etc/nginx/sites-enabled/yanpan.xieyw.top "/root/yanpan.xieyw.top.$STAMP.backup"
sed -i 's#root /var/www/xietest.us.ci;#root /srv/yanpan-dashboard/current/dist;#' /etc/nginx/sites-enabled/yanpan.xieyw.top

systemctl daemon-reload
nginx -t
systemctl restart stock-analysis-dashboard
for _ in $(seq 1 20); do
  curl -fsS --max-time 2 http://127.0.0.1:8000/api/health >/dev/null && break
  sleep 1
done
curl -fsS --max-time 3 http://127.0.0.1:8000/api/health >/dev/null
curl -fsSk --max-time 5 --resolve yanpan.xieyw.top:443:127.0.0.1 https://yanpan.xieyw.top/ >/dev/null
printf 'BOOTSTRAP_OK backup_stamp=%s\n' "$STAMP"
