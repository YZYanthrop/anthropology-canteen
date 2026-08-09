#!/bin/bash

set -euo pipefail

NODE_VERSION="24.14.0"
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
TARGET_ARCH="${1:-}"
OUTPUT_DIR="${2:-$REPO_ROOT/outputs}"

case "$TARGET_ARCH" in
  arm64)
    NODE_TARGET="darwin-arm64"
    EXPECTED_MACHINE="arm64"
    DISPLAY_ARCH="Apple-Silicon-arm64"
    ;;
  x64)
    NODE_TARGET="darwin-x64"
    EXPECTED_MACHINE="x86_64"
    DISPLAY_ARCH="Intel-x64"
    ;;
  *)
    echo "Usage: build-portable.sh <arm64|x64> [output-directory]" >&2
    exit 2
    ;;
esac

if [[ "$(/usr/bin/uname -s)" != "Darwin" ]]; then
  echo "macOS packages must be built and tested on a native macOS runner." >&2
  exit 1
fi
if [[ "$(/usr/bin/uname -m)" != "$EXPECTED_MACHINE" ]]; then
  echo "Expected native $EXPECTED_MACHINE runner for $TARGET_ARCH packaging." >&2
  exit 1
fi
if [[ ! -d "$REPO_ROOT/dist/client" || ! -d "$REPO_ROOT/dist/server" ]]; then
  echo "Run pnpm build before packaging." >&2
  exit 1
fi

PRODUCT_VERSION="$(cd "$REPO_ROOT" && node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
ROOT_NAME="Anthropology-Canteen-macOS-${DISPLAY_ARCH}-v${PRODUCT_VERSION}"
ZIP_NAME="${ROOT_NAME}.zip"
SHA_NAME="${ZIP_NAME}.sha256"
STAGE_ROOT="$OUTPUT_DIR/$ROOT_NAME"
WORK_ROOT="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/anthropology-canteen-macos.XXXXXX")"

cleanup() {
  /bin/rm -rf "$WORK_ROOT"
}
trap cleanup EXIT

/bin/mkdir -p "$OUTPUT_DIR"
/bin/rm -rf "$STAGE_ROOT"
/bin/rm -f "$OUTPUT_DIR/$ZIP_NAME" "$OUTPUT_DIR/$SHA_NAME"

NODE_ARCHIVE="node-v${NODE_VERSION}-${NODE_TARGET}.tar.gz"
NODE_BASE_URL="https://nodejs.org/dist/v${NODE_VERSION}"
/usr/bin/curl --fail --location --silent --show-error \
  --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 \
  "$NODE_BASE_URL/$NODE_ARCHIVE" -o "$WORK_ROOT/$NODE_ARCHIVE"
/usr/bin/curl --fail --location --silent --show-error \
  --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 60 \
  "$NODE_BASE_URL/SHASUMS256.txt" -o "$WORK_ROOT/SHASUMS256.txt"

EXPECTED_SHA="$(/usr/bin/awk -v file="$NODE_ARCHIVE" '$2 == file { print $1 }' "$WORK_ROOT/SHASUMS256.txt")"
ACTUAL_SHA="$(/usr/bin/shasum -a 256 "$WORK_ROOT/$NODE_ARCHIVE" | /usr/bin/awk '{ print $1 }')"
if [[ -z "$EXPECTED_SHA" || "$EXPECTED_SHA" != "$ACTUAL_SHA" ]]; then
  echo "Node.js runtime checksum verification failed." >&2
  exit 1
fi

/usr/bin/tar -xzf "$WORK_ROOT/$NODE_ARCHIVE" -C "$WORK_ROOT"
NODE_ROOT="$WORK_ROOT/node-v${NODE_VERSION}-${NODE_TARGET}"

/bin/mkdir -p "$STAGE_ROOT/runtime/bin" "$STAGE_ROOT/tools"
/bin/cp -R "$REPO_ROOT/dist" "$STAGE_ROOT/dist"
/bin/cp "$REPO_ROOT/portable-server.mjs" "$STAGE_ROOT/portable-server.mjs"
/bin/cp "$REPO_ROOT/LICENSE" "$STAGE_ROOT/LICENSE"
/bin/cp "$SCRIPT_DIR/Anthropology Canteen.command" "$STAGE_ROOT/Anthropology Canteen.command"
/bin/cp "$SCRIPT_DIR/start-local.command" "$STAGE_ROOT/start-local.command"
/bin/cp "$SCRIPT_DIR/import-data-from-old-version.command" "$STAGE_ROOT/import-data-from-old-version.command"
/bin/cp "$SCRIPT_DIR/import-data.mjs" "$STAGE_ROOT/tools/import-data.mjs"
/bin/cp "$SCRIPT_DIR/launch-background.sh" "$STAGE_ROOT/tools/launch-background.sh"
/bin/cp "$SCRIPT_DIR/README-macOS.txt" "$STAGE_ROOT/README-macOS.txt"
/bin/cp "$SCRIPT_DIR/RUNTIME-NOTICE.txt" "$STAGE_ROOT/RUNTIME-NOTICE.txt"
/bin/cp "$NODE_ROOT/bin/node" "$STAGE_ROOT/runtime/bin/node"
/bin/cp "$NODE_ROOT/LICENSE" "$STAGE_ROOT/runtime/LICENSE"

/bin/chmod 755 \
  "$STAGE_ROOT/Anthropology Canteen.command" \
  "$STAGE_ROOT/start-local.command" \
  "$STAGE_ROOT/import-data-from-old-version.command" \
  "$STAGE_ROOT/tools/launch-background.sh" \
  "$STAGE_ROOT/runtime/bin/node"
/bin/chmod 644 "$STAGE_ROOT/tools/import-data.mjs"

SYMLINK_PATH="$(/usr/bin/find "$STAGE_ROOT" -type l -print -quit)"
if [[ -n "$SYMLINK_PATH" ]]; then
  echo "A symbolic link entered the staging folder; portable ZIPs require regular files." >&2
  exit 1
fi
PROHIBITED_PATH="$(/usr/bin/find "$STAGE_ROOT" \( \
  -iname data -o -iname node_modules -o -iname .DS_Store -o \
  -iname __MACOSX -o -iname '.env*' -o -iname '*settings*.json' -o \
  -iname '*.pid' -o -iname '.pnpm-store' -o -iname '.vinext' -o \
  -iname '.next' -o -iname '.wrangler' \
\) -print -quit)"
if [[ -n "$PROHIBITED_PATH" ]]; then
  echo "A prohibited generated or private path entered the staging folder." >&2
  exit 1
fi
PERSONAL_PATH="$(/usr/bin/grep -I -R -E -l '/Users/[^/]+|[A-Za-z]:\\Users\\' "$STAGE_ROOT" || true)"
if [[ -n "$PERSONAL_PATH" ]]; then
  echo "A personal absolute path entered the staging folder." >&2
  exit 1
fi

(
  cd "$OUTPUT_DIR"
  /usr/bin/zip -q -r -X "$ZIP_NAME" "$ROOT_NAME"
)

(
  cd "$OUTPUT_DIR"
  /usr/bin/shasum -a 256 "$ZIP_NAME" >"$SHA_NAME"
)
echo "Created $OUTPUT_DIR/$ZIP_NAME"
echo "Created $OUTPUT_DIR/$SHA_NAME"
