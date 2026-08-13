#!/usr/bin/env bash
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

DOMAIN="${DOMAIN:-yanpan.xieyw.top}"
USERNAME="${ACCESS_USERNAME:-yanpan}"
# Temporary preview credential requested by the product owner. Override with
# ACCESS_PASSWORD before running this script when rotating the password.
PASSWORD="${ACCESS_PASSWORD:-123123}"
SITE="/etc/nginx/sites-enabled/$DOMAIN"
AUTH_FILE="/etc/nginx/.htpasswd-yanpan"
SNIPPET="/etc/nginx/snippets/yanpan-access-password.conf"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

[[ -f "$SITE" ]] || { echo "nginx site not found: $SITE" >&2; exit 2; }
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 2; }

install -d -o root -g root -m 0755 /etc/nginx/snippets
HASH="$(openssl passwd -apr1 "$PASSWORD")"
umask 0027
printf '%s:%s\n' "$USERNAME" "$HASH" > "$AUTH_FILE"
chown root:www-data "$AUTH_FILE"
chmod 0640 "$AUTH_FILE"

cat > "$SNIPPET" <<EOF
# Require a password for internet clients while allowing local deployment
# health checks to verify a freshly switched release without storing plaintext.
satisfy any;
allow 127.0.0.1;
allow ::1;
deny all;
auth_basic "Yanpan private preview";
auth_basic_user_file $AUTH_FILE;

# Expose only immutable build metadata so GitHub Actions can prove that the
# intended revision is live without storing the site password in CI.
location = /version.json {
    satisfy all;
    allow all;
    auth_basic off;
    try_files \$uri =404;
}
EOF
chown root:root "$SNIPPET"
chmod 0644 "$SNIPPET"

cp -a "$SITE" "/root/${DOMAIN}.${STAMP}.before-access-password"
python3 - "$SITE" "$DOMAIN" "$SNIPPET" <<'PY'
from __future__ import annotations

import pathlib
import re
import sys

site = pathlib.Path(sys.argv[1])
domain = sys.argv[2]
snippet = sys.argv[3]
text = site.read_text()
include = f"    include {snippet};"

if include in text:
    raise SystemExit(0)

starts = [match.start() for match in re.finditer(r"(?m)^\s*server\s*\{", text)]
target: tuple[int, int] | None = None
for start in starts:
    opening = text.find("{", start)
    depth = 0
    end = None
    for index in range(opening, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end is None:
        continue
    block = text[start:end]
    if re.search(r"\blisten\s+[^;]*443\b", block) and re.search(
        rf"\bserver_name\s+[^;]*\b{re.escape(domain)}\b", block
    ):
        target = (start, end)
        break

if target is None:
    raise SystemExit(f"HTTPS server block for {domain} not found")

start, end = target
block = text[start:end]
server_name = re.search(r"(?m)^(\s*server_name\s+[^;]+;)", block)
if server_name is None:
    raise SystemExit("server_name directive not found")
insert_at = server_name.end()
block = block[:insert_at] + "\n" + include + block[insert_at:]
site.write_text(text[:start] + block + text[end:])
PY

nginx -t
systemctl reload nginx
curl -fsSk --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/version.json" >/dev/null
printf 'ACCESS_PASSWORD_OK domain=%s username=%s backup=%s\n' \
  "$DOMAIN" "$USERNAME" "/root/${DOMAIN}.${STAMP}.before-access-password"
