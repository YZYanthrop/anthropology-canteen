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
ENTRY_PID=""
KEYCHAIN_HELPER=""
KEYCHAIN_SERVICE="org.anthropology-canteen.smtp"
KEYCHAIN_ACCOUNT=""
LAUNCHD_LABEL=""
LAUNCHD_PLIST=""
USER_HOME="$(/usr/bin/printenv HOME || true)"
USER_UID="$(/usr/bin/id -u)"

cleanup() {
  if [[ -n "$SSE_PID" ]]; then /bin/kill "$SSE_PID" 2>/dev/null || true; fi
  if [[ -n "$SERVER_PID" ]]; then /bin/kill "$SERVER_PID" 2>/dev/null || true; fi
  if [[ -n "$ENTRY_PID" ]]; then /bin/kill "$ENTRY_PID" 2>/dev/null || true; fi
  if [[ -n "$LAUNCHD_LABEL" ]]; then
    /bin/launchctl bootout "gui/$USER_UID/$LAUNCHD_LABEL" 2>/dev/null || true
  fi
  if [[ -n "$LAUNCHD_PLIST" ]]; then /bin/rm -f "$LAUNCHD_PLIST"; fi
  if [[ -x "$KEYCHAIN_HELPER" && -n "$KEYCHAIN_ACCOUNT" ]]; then
    "$KEYCHAIN_HELPER" delete "$KEYCHAIN_SERVICE" "$KEYCHAIN_ACCOUNT" >/dev/null 2>&1 || true
  fi
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

wait_stopped() {
  local pid="$1"
  for ((attempt = 0; attempt < 20; attempt += 1)); do
    if ! /bin/kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    /bin/sleep 1
  done
  return 1
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
if /usr/bin/find "$EXTRACTED_ROOT" -type f ! -path '*/runtime/bin/node' -exec /usr/bin/grep -I -E -l 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' {} + | /usr/bin/grep -q .; then
  fail "the extracted package contains a high-confidence secret marker"
fi
NODE="$EXTRACTED_ROOT/runtime/bin/node"
SERVER="$EXTRACTED_ROOT/portable-server.mjs"
[[ ! -e "$EXTRACTED_ROOT/data" ]] || fail "blank extracted package already contains data"
[[ -x "$NODE" ]] || fail "ZIP did not preserve Node execute permission"
[[ -x "$EXTRACTED_ROOT/Anthropology Canteen.command" ]] || fail "ZIP did not preserve launcher execute permission"
[[ "$($NODE -p 'process.arch')" == "$EXPECTED_NODE_ARCH" ]] || fail "extracted runtime architecture mismatch"
[[ "$($NODE --version)" == "v24.14.0" ]] || fail "extracted runtime version mismatch"

KEYCHAIN_HELPER="$EXTRACTED_ROOT/tools/anthropology-canteen-keychain"
[[ -x "$KEYCHAIN_HELPER" ]] || fail "ZIP did not include an executable Keychain helper"
[[ -n "$USER_HOME" ]] || fail "the native smoke runner has no user home"
KEYCHAIN_ACCOUNT="macos-smoke-${TARGET_ARCH}-$(/bin/date +%s)-$RANDOM"
KEYCHAIN_SECRET="macos-smoke-secret-${TARGET_ARCH}-${RANDOM}"
printf '%s' "$KEYCHAIN_SECRET" | "$KEYCHAIN_HELPER" set "$KEYCHAIN_SERVICE" "$KEYCHAIN_ACCOUNT"
KEYCHAIN_READ="$("$KEYCHAIN_HELPER" get "$KEYCHAIN_SERVICE" "$KEYCHAIN_ACCOUNT")"
[[ "$KEYCHAIN_READ" == "$KEYCHAIN_SECRET" ]] || fail "the packaged Keychain helper did not round-trip the test credential"
"$KEYCHAIN_HELPER" delete "$KEYCHAIN_SERVICE" "$KEYCHAIN_ACCOUNT"
if "$KEYCHAIN_HELPER" get "$KEYCHAIN_SERVICE" "$KEYCHAIN_ACCOUNT" >/dev/null 2>&1; then
  fail "the packaged Keychain helper did not delete the test credential"
fi

INSTALLATION_ID="macos-smoke-${TARGET_ARCH}-$(/bin/date +%s)-$RANDOM"
LAUNCHD_LABEL="org.anthropology-canteen.reminder.${INSTALLATION_ID:0:24}"
LAUNCHD_PLIST="$USER_HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"
(
  cd "$EXTRACTED_ROOT"
  ROOT="$EXTRACTED_ROOT" INSTALLATION_ID="$INSTALLATION_ID" "$NODE" --input-type=module -e '
    import { installScheduler } from "./reminder-scheduler.mjs";
    const result = await installScheduler(process.env.ROOT, {
      installationId: process.env.INSTALLATION_ID,
      schedule: { cadence: "daily", time: "23:59", weekday: 1, monthDay: 1 },
    });
    if (result.platform !== "macos" || result.path !== process.env.ROOT) {
      throw new Error("LaunchAgent install returned the wrong package identity");
    }
  '
)
/bin/launchctl print "gui/$USER_UID/$LAUNCHD_LABEL" >/dev/null 2>&1 || fail "the packaged LaunchAgent was not loaded"
[[ -f "$LAUNCHD_PLIST" ]] || fail "the packaged LaunchAgent plist was not created"
PLIST_WORKING_DIRECTORY="$(/usr/bin/plutil -extract WorkingDirectory raw "$LAUNCHD_PLIST")"
PLIST_NODE="$(/usr/bin/plutil -extract ProgramArguments.0 raw "$LAUNCHD_PLIST")"
PLIST_WORKER="$(/usr/bin/plutil -extract ProgramArguments.1 raw "$LAUNCHD_PLIST")"
[[ "$PLIST_WORKING_DIRECTORY" == "$EXTRACTED_ROOT" ]] || fail "LaunchAgent plist points to another package root"
[[ "$PLIST_NODE" == "$NODE" ]] || fail "LaunchAgent plist points to another runtime"
[[ "$PLIST_WORKER" == "$EXTRACTED_ROOT/reminder-worker.mjs" ]] || fail "LaunchAgent plist omits the reminder worker"
if /usr/bin/grep -Fq "$KEYCHAIN_SECRET" "$LAUNCHD_PLIST"; then
  fail "LaunchAgent plist contains the test credential"
fi
(
  cd "$EXTRACTED_ROOT"
  ROOT="$EXTRACTED_ROOT" INSTALLATION_ID="$INSTALLATION_ID" "$NODE" --input-type=module -e '
    import { uninstallScheduler } from "./reminder-scheduler.mjs";
    await uninstallScheduler(process.env.ROOT, { installationId: process.env.INSTALLATION_ID });
  '
)
[[ ! -e "$LAUNCHD_PLIST" ]] || fail "the packaged LaunchAgent plist was not removed"
if /bin/launchctl print "gui/$USER_UID/$LAUNCHD_LABEL" >/dev/null 2>&1; then
  fail "the packaged LaunchAgent remained loaded after uninstall"
fi
LAUNCHD_LABEL=""
LAUNCHD_PLIST=""

KEYCHAIN_ACCOUNT="$INSTALLATION_ID"
printf '%s' "$KEYCHAIN_SECRET" | "$KEYCHAIN_HELPER" set "$KEYCHAIN_SERVICE" "$KEYCHAIN_ACCOUNT"
/bin/mkdir -p "$EXTRACTED_ROOT/data"
/bin/cat >"$EXTRACTED_ROOT/data/anthropology-canteen-data.json" <<'JSON'
{"version":7,"subscriptions":{"journal":[],"scholar":[],"keyword":[]},"states":{},"feed":null,"translations":{},"scholarProfiles":{}}
JSON
/bin/cat >"$EXTRACTED_ROOT/data/anthropology-canteen-settings.json" <<JSON
{"version":3,"openAlexApiKey":"","semanticScholarApiKey":"","reminders":{"enabled":true,"installationId":"$INSTALLATION_ID","credentialRef":"$INSTALLATION_ID","provider":"custom","sender":"sender@example.com","recipient":"recipient@example.com","host":"smtp.example.com","port":465,"security":"tls","username":"sender@example.com","schedule":{"cadence":"daily","time":"23:59","weekday":1,"monthDay":1}}}
JSON
(cd "$EXTRACTED_ROOT" && "$NODE" reminder-worker.mjs --force)
WORKER_STATE="$EXTRACTED_ROOT/data/anthropology-canteen-reminder-state.json"
[[ -f "$WORKER_STATE" ]] || fail "the packaged reminder worker did not create state during its offline run"
ROOT="$EXTRACTED_ROOT" "$NODE" --input-type=module -e '
  const fs = await import("node:fs/promises");
  const state = JSON.parse(await fs.readFile(process.env.ROOT + "/data/anthropology-canteen-reminder-state.json", "utf8"));
  if (!state.baselineComplete || state.lastResult !== "no-updates") throw new Error("offline reminder worker did not complete a blank run");
'
"$KEYCHAIN_HELPER" delete "$KEYCHAIN_SERVICE" "$KEYCHAIN_ACCOUNT"
/bin/rm -rf "$EXTRACTED_ROOT/data"
(
  cd "$(dirname "$ZIP_PATH")"
  /usr/bin/shasum -a 256 -c "$(basename "$ZIP_PATH").sha256"
)

ENTRY_PORT="$((31000 + RANDOM % 9000))"
ENTRY_URL="http://127.0.0.1:$ENTRY_PORT"
PID_FILE="$EXTRACTED_ROOT/data/anthropology-canteen-server.pid"
if ! ANTHROPOLOGY_CANTEEN_SKIP_OPEN=1 PORT="$ENTRY_PORT" "$EXTRACTED_ROOT/Anthropology Canteen.command"; then
  if [[ -f "$PID_FILE" ]]; then ENTRY_PID="$(/bin/cat "$PID_FILE")"; fi
  fail "the extracted user launcher returned an error"
fi
for ((attempt = 0; attempt < 20 && ! -f "$PID_FILE"; attempt += 1)); do
  /bin/sleep 1
done
[[ -f "$PID_FILE" ]] || fail "the user launcher did not create its PID file"
ENTRY_PID="$(/bin/cat "$PID_FILE")"
[[ "$ENTRY_PID" =~ ^[1-9][0-9]*$ ]] || fail "the user launcher wrote an invalid PID"
/bin/kill -0 "$ENTRY_PID" 2>/dev/null || fail "the user launcher background process is not alive"
/bin/ps -p "$ENTRY_PID" -o command= | /usr/bin/grep -q 'portable-server.mjs' || fail "the launcher PID is not the portable server"
wait_ready "$ENTRY_URL" || fail "the extracted user launcher did not start the server"
"$NODE" --input-type=module -e '
  const status = await fetch(`${process.argv[1]}/api/runtime-status`).then((response) => response.json());
  if (status.app !== "anthropology-canteen" || status.autoClose !== true) {
    throw new Error("user launcher runtime status is invalid");
  }
' "$ENTRY_URL"
/bin/kill "$ENTRY_PID"
wait_stopped "$ENTRY_PID" || fail "the user launcher background process did not stop safely"
ENTRY_PID=""
[[ ! -e "$PID_FILE" ]] || fail "the user launcher PID file was not cleaned up"
/bin/rm -rf "$EXTRACTED_ROOT/data"

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
