#!/bin/bash

set -euo pipefail

PACKAGE_ROOT="${1:-}"
ZIP_PATH="${2:-}"
TARGET_ARCH="${3:-}"

if [[ ! -d "$PACKAGE_ROOT" || ! -f "$ZIP_PATH" ]]; then
  echo "Usage: smoke-test.sh <package-root> <zip-path> <arm64|x64>" >&2
  exit 2
fi

case "$TARGET_ARCH" in
  arm64) EXPECTED_NODE_ARCH="arm64" ;;
  x64) EXPECTED_NODE_ARCH="x64" ;;
  *) echo "Target architecture must be arm64 or x64." >&2; exit 2 ;;
esac

TEMP_ROOT="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/anthropology-canteen-smoke.XXXXXX")"
SERVER_PID=""
SSE_PID=""

cleanup() {
  if [[ -n "$SSE_PID" ]]; then /bin/kill "$SSE_PID" 2>/dev/null || true; fi
  if [[ -n "$SERVER_PID" ]]; then /bin/kill "$SERVER_PID" 2>/dev/null || true; fi
  /bin/rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

fail() {
  echo "Smoke test failed: $1" >&2
  exit 1
}

wait_ready() {
  local url="$1"
  for ((attempt = 0; attempt < 90; attempt += 1)); do
    if /usr/bin/curl --silent --fail --max-time 2 "$url/api/runtime-status" >/dev/null 2>&1; then
      return 0
    fi
    /bin/sleep 1
  done
  return 1
}

stop_server() {
  if [[ -n "$SERVER_PID" ]]; then
    /bin/kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}

[[ ! -e "$PACKAGE_ROOT/data" ]] || fail "blank staging package already contains data"
[[ -x "$PACKAGE_ROOT/Anthropology Canteen.command" ]] || fail "Finder launcher is not executable"
[[ -x "$PACKAGE_ROOT/start-local.command" ]] || fail "diagnostic launcher is not executable"
[[ -x "$PACKAGE_ROOT/import-data-from-old-version.command" ]] || fail "import launcher is not executable"
[[ -x "$PACKAGE_ROOT/tools/launch-background.sh" ]] || fail "background helper is not executable"

ARCHIVE_ROOTS="$(/usr/bin/zipinfo -1 "$ZIP_PATH" | /usr/bin/awk -F/ 'NF {print $1}' | /usr/bin/sort -u)"
[[ "$ARCHIVE_ROOTS" != *$'\n'* && -n "$ARCHIVE_ROOTS" ]] || fail "ZIP does not have exactly one root directory"
if /usr/bin/zipinfo -1 "$ZIP_PATH" | /usr/bin/grep -E -i '(^|/)(data|node_modules|__MACOSX|\.DS_Store|\.env[^/]*|[^/]*settings[^/]*\.json|[^/]*\.pid|\.pnpm-store|\.next|\.vinext|\.wrangler)(/|$)' >/dev/null; then
  fail "ZIP contains a prohibited private or generated path"
fi

/usr/bin/unzip -q "$ZIP_PATH" -d "$TEMP_ROOT/archive"
EXTRACTED_ROOT="$TEMP_ROOT/archive/$ARCHIVE_ROOTS"
NODE="$EXTRACTED_ROOT/runtime/bin/node"
SERVER="$EXTRACTED_ROOT/portable-server.mjs"
[[ ! -e "$EXTRACTED_ROOT/data" ]] || fail "blank extracted package already contains data"
[[ -x "$NODE" ]] || fail "ZIP did not preserve Node execute permission"
[[ -x "$EXTRACTED_ROOT/Anthropology Canteen.command" ]] || fail "ZIP did not preserve launcher execute permission"
[[ "$($NODE -p 'process.arch')" == "$EXPECTED_NODE_ARCH" ]] || fail "extracted runtime architecture mismatch"
[[ "$($NODE --version)" == "v24.14.0" ]] || fail "extracted runtime version mismatch"
(
  cd "$(dirname "$ZIP_PATH")"
  /usr/bin/shasum -a 256 -c "$(basename "$ZIP_PATH").sha256"
)

PORT="$((41000 + RANDOM % 10000))"
BASE_URL="http://127.0.0.1:$PORT"
PORT="$PORT" "$NODE" "$SERVER" >"$TEMP_ROOT/server-first.log" 2>&1 &
SERVER_PID=$!
wait_ready "$BASE_URL" || fail "portable server did not start"
/usr/bin/curl --silent --fail "$BASE_URL/" >/dev/null || fail "home page failed"
"$NODE" --input-type=module -e '
  const base = process.argv[1];
  const status = await fetch(`${base}/api/runtime-status`).then((r) => r.json());
  if (status.app !== "anthropology-canteen") throw new Error("bad runtime status");
  const blank = await fetch(`${base}/api/local-data`).then((r) => r.json());
  if (blank.version !== 7) throw new Error("blank data is not version 7");
  if (blank.subscriptions.journal.length || blank.subscriptions.scholar.length || blank.subscriptions.keyword.length) throw new Error("blank data has subscriptions");
  const saved = await fetch(`${base}/api/local-data`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...blank, states: { "smoke-record": { saved: true } } }),
  }).then((r) => r.json());
  if (!saved.states["smoke-record"].saved) throw new Error("PUT failed");
' "$BASE_URL"
stop_server

PORT="$PORT" "$NODE" "$SERVER" >"$TEMP_ROOT/server-restart.log" 2>&1 &
SERVER_PID=$!
wait_ready "$BASE_URL" || fail "portable server did not restart"
"$NODE" --input-type=module -e '
  const data = await fetch(`${process.argv[1]}/api/local-data`).then((r) => r.json());
  if (!data.states["smoke-record"]?.saved) throw new Error("data did not persist across restart");
' "$BASE_URL"
stop_server

/bin/mkdir -p "$TEMP_ROOT/old-data"
/bin/cat >"$TEMP_ROOT/old-data/anthropology-canteen-data.json" <<'JSON'
{"version":7,"savedAt":"2026-08-09T00:00:00.000Z","subscriptions":{"journal":[],"scholar":[],"keyword":[]},"states":{"imported-record":{"read":true}},"feed":null,"translations":{},"scholarProfiles":{}}
JSON
/bin/cat >"$TEMP_ROOT/old-data/anthropology-canteen-settings.json" <<'JSON'
{"version":2,"openAlexApiKey":"smoke-openalex-key","semanticScholarApiKey":""}
JSON
"$NODE" "$EXTRACTED_ROOT/tools/import-data.mjs" --source "$TEMP_ROOT/old-data" --target-root "$EXTRACTED_ROOT"
/usr/bin/find "$EXTRACTED_ROOT/data" -name 'anthropology-canteen-data.backup-*.json' -type f -print -quit | /usr/bin/grep -q . || fail "import did not back up existing data"
"$NODE" -e '
  const fs = require("node:fs");
  const root = process.argv[1];
  const data = JSON.parse(fs.readFileSync(`${root}/data/anthropology-canteen-data.json`, "utf8"));
  const settings = JSON.parse(fs.readFileSync(`${root}/data/anthropology-canteen-settings.json`, "utf8"));
  if (!data.states["imported-record"]?.read) throw new Error("data import failed");
  if (settings.openAlexApiKey !== "smoke-openalex-key") throw new Error("settings import failed");
' "$EXTRACTED_ROOT"

/bin/rm -rf "$EXTRACTED_ROOT/data"
AUTO_PORT="$((51000 + RANDOM % 9000))"
AUTO_URL="http://127.0.0.1:$AUTO_PORT"
PORT="$AUTO_PORT" "$NODE" "$SERVER" --auto-close >"$TEMP_ROOT/server-auto-close.log" 2>&1 &
SERVER_PID=$!
wait_ready "$AUTO_URL" || fail "auto-close server did not start"
/usr/bin/curl --silent --no-buffer "$AUTO_URL/api/browser-session" >"$TEMP_ROOT/sse.log" &
SSE_PID=$!
/bin/sleep 2
/bin/kill "$SSE_PID" 2>/dev/null || true
wait "$SSE_PID" 2>/dev/null || true
SSE_PID=""
CLOSE_STARTED="$(/bin/date +%s)"
for ((attempt = 0; attempt < 20; attempt += 1)); do
  if ! /bin/kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
    CLOSE_ELAPSED="$(( $(/bin/date +%s) - CLOSE_STARTED ))"
    [[ "$CLOSE_ELAPSED" -ge 6 && "$CLOSE_ELAPSED" -le 15 ]] || fail "SSE shutdown was not approximately eight seconds"
    echo "macOS portable smoke test passed for $TARGET_ARCH."
    exit 0
  fi
  /bin/sleep 1
done

fail "server did not stop after the final SSE session closed"
