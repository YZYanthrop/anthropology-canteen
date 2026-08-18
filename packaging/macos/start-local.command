#!/bin/bash

set -u

APP_ROOT="$(cd -- "$(dirname -- "$0")" && pwd -P)"
NODE="$APP_ROOT/runtime/bin/node"
SERVER="$APP_ROOT/portable-server.mjs"
PORT="${PORT:-3000}"

runtime_status() {
  /usr/bin/curl --silent --fail --max-time 2 "$STATUS_URL" 2>/dev/null
}

is_anthropology_ready() {
  runtime_status | /usr/bin/grep -q '"app": "anthropology-canteen"'
}

is_ready() {
  runtime_status | /usr/bin/grep -Fq "\"packageRoot\": \"$APP_ROOT\""
}

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

echo
echo "Anthropology Canteen diagnostic start"
echo "Package: $APP_ROOT"
echo "Mac architecture: $(/usr/bin/uname -m)"

if [[ ! -x "$NODE" ]]; then
  echo "The bundled runtime is missing or is not executable."
  echo "Extract the complete ZIP before starting."
  read -r -p "Press Return to close. "
  exit 1
fi

echo "Bundled runtime: $($NODE --version) ($($NODE -p 'process.arch'))"
echo "Local URL: $BROWSER_URL"
echo

(
  for ((attempt = 0; attempt < 90; attempt += 1)); do
    if is_ready; then
      /usr/bin/open "$BROWSER_URL"
      exit 0
    fi
    /bin/sleep 1
  done
) &
OPENER_PID=$!

cd "$APP_ROOT"
"$NODE" "$SERVER"
status=$?
/bin/kill "$OPENER_PID" 2>/dev/null || true

echo
echo "Anthropology Canteen stopped with status $status."
read -r -p "Press Return to close. "
exit "$status"
