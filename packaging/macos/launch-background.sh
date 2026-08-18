#!/bin/bash

set -u

APP_ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
NODE="$APP_ROOT/runtime/bin/node"
SERVER="$APP_ROOT/portable-server.mjs"
PORT="${PORT:-3000}"
LOG_DIR="$APP_ROOT/data"
LOG_FILE="$LOG_DIR/anthropology-canteen-server.log"

show_error() {
  /usr/bin/osascript -e "display alert \"Anthropology Canteen\" message \"$1\" as critical" >/dev/null 2>&1 || true
}

runtime_status() {
  /usr/bin/curl --silent --fail --max-time 2 "$STATUS_URL" 2>/dev/null
}

is_anthropology_ready() {
  runtime_status | /usr/bin/grep -q '"app": "anthropology-canteen"'
}

is_ready() {
  runtime_status | /usr/bin/grep -Fq "\"packageRoot\": \"$APP_ROOT\""
}

if [[ ! -x "$NODE" || ! -f "$SERVER" ]]; then
  show_error "The portable package is incomplete. Extract the complete ZIP before opening it."
  exit 1
fi

for ((candidate = 0; candidate < 50; candidate += 1)); do
  STATUS_URL="http://127.0.0.1:${PORT}/api/runtime-status"
  if is_ready || ! is_anthropology_ready; then
    break
  fi
  PORT=$((PORT + 1))
done
export PORT
STATUS_URL="http://127.0.0.1:${PORT}/api/runtime-status"
BROWSER_URL="http://anthropology-canteen.localhost:${PORT}/?launch=$(/bin/date +%s)-$$"

if ! is_ready; then
  /bin/mkdir -p "$LOG_DIR"
  /usr/bin/nohup "$NODE" "$SERVER" --auto-close >>"$LOG_FILE" 2>&1 </dev/null &
fi

for ((attempt = 0; attempt < 90; attempt += 1)); do
  if is_ready; then
    if [[ "${ANTHROPOLOGY_CANTEEN_SKIP_OPEN:-0}" != "1" ]]; then
      /usr/bin/open "$BROWSER_URL"
    fi
    exit 0
  fi
  /bin/sleep 1
done

show_error "Anthropology Canteen could not start. Double-click start-local.command to see diagnostic details."
exit 1
