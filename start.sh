#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="$ROOT_DIR/.venv"
REQUIREMENTS="$ROOT_DIR/backend/requirements.txt"
REQUIREMENTS_STAMP="$VENV_DIR/.requirements.sha256"

if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js 20+ is required.\n' >&2
  exit 1
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  printf 'Python 3.11+ is required. Set PYTHON_BIN when it is installed under another name.\n' >&2
  exit 1
fi

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  printf 'Creating local Python environment...\n'
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

REQ_HASH="$(shasum -a 256 "$REQUIREMENTS" | awk '{print $1}')"
INSTALLED_HASH="$(cat "$REQUIREMENTS_STAMP" 2>/dev/null || true)"
if [[ "$REQ_HASH" != "$INSTALLED_HASH" ]]; then
  printf 'Installing backend dependencies...\n'
  "$VENV_DIR/bin/python" -m pip install --disable-pip-version-check -r "$REQUIREMENTS"
  printf '%s' "$REQ_HASH" > "$REQUIREMENTS_STAMP"
fi

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  printf 'Installing frontend dependencies...\n'
  npm install
fi

api_is_ready() {
  curl --noproxy '*' --max-time 1 --silent --fail http://127.0.0.1:8000/api/health >/dev/null 2>&1
}

dashboard_is_ready() {
  curl --noproxy '*' --max-time 1 --silent --fail http://127.0.0.1:4173/ 2>/dev/null | grep -q '<title>研判'
}

port_is_open() {
  "$VENV_DIR/bin/python" - "$1" <<'PY'
import socket
import sys

with socket.socket() as connection:
    connection.settimeout(0.3)
    raise SystemExit(0 if connection.connect_ex(("127.0.0.1", int(sys.argv[1]))) == 0 else 1)
PY
}

BACKEND_PID=""

if api_is_ready; then
  printf 'Reusing dashboard API at http://127.0.0.1:8000 ...\n'
elif port_is_open 8000; then
  printf 'Port 8000 is occupied by another service. Stop it or set a different backend port before starting.\n' >&2
  exit 1
else
  printf 'Starting API at http://127.0.0.1:8000 ...\n'
  "$VENV_DIR/bin/python" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 &
  BACKEND_PID=$!
fi

cleanup() {
  if [[ -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

for _ in {1..40}; do
  if api_is_ready; then
    break
  fi
  if [[ -n "$BACKEND_PID" ]] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    printf 'Backend exited before becoming ready.\n' >&2
    exit 1
  fi
  sleep 0.25
done

if ! api_is_ready; then
  printf 'Backend did not become ready in 10 seconds.\n' >&2
  exit 1
fi

if dashboard_is_ready; then
  printf 'Dashboard is already running at http://127.0.0.1:4173/\n'
  if [[ -n "$BACKEND_PID" ]]; then
    printf 'Press Ctrl+C to stop the API started by this command.\n'
    wait "$BACKEND_PID"
  fi
  exit 0
fi

if port_is_open 4173; then
  printf 'Port 4173 is occupied by another service. Stop it before starting the dashboard.\n' >&2
  exit 1
fi

printf 'Starting dashboard at http://127.0.0.1:4173 ...\n'
npm run dev
