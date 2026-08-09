#!/bin/bash

set -u

APP_ROOT="$(cd -- "$(dirname -- "$0")" && pwd -P)"
NODE="$APP_ROOT/runtime/bin/node"
IMPORTER="$APP_ROOT/tools/import-data.mjs"

echo
echo "Anthropology Canteen data import"
echo "Close Anthropology Canteen before importing."
echo "Drag the old data folder or anthropology-canteen-data.json into this window,"
echo "then press Return. A neighboring settings file is imported only when present."
echo

if [[ ! -x "$NODE" || ! -f "$IMPORTER" ]]; then
  echo "The portable package is incomplete. Extract the complete ZIP first."
  read -r -p "Press Return to close. "
  exit 1
fi

read -p "Old data path: " SOURCE_PATH
SOURCE_PATH="${SOURCE_PATH#\"}"
SOURCE_PATH="${SOURCE_PATH%\"}"
SOURCE_PATH="${SOURCE_PATH#\'}"
SOURCE_PATH="${SOURCE_PATH%\'}"

if [[ -z "$SOURCE_PATH" ]]; then
  echo "No path was provided."
  read -r -p "Press Return to close. "
  exit 1
fi

"$NODE" "$IMPORTER" --source "$SOURCE_PATH" --target-root "$APP_ROOT"
status=$?

echo
if [[ $status -eq 0 ]]; then
  echo "Import complete. You can start Anthropology Canteen now."
else
  echo "Import failed. Existing destination data was kept or backed up."
fi
read -r -p "Press Return to close. "
exit "$status"
