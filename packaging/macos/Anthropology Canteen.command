#!/bin/bash

APP_ROOT="$(cd -- "$(dirname -- "$0")" && pwd -P)"
exec "$APP_ROOT/tools/launch-background.sh"
