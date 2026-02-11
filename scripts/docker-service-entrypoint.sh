#!/bin/sh
# docker-service-entrypoint.sh — Slim service image entrypoint (WOP-69).
# Runs as non-root (node) user. Registers bundled plugins then execs CMD.
set -e

# Register pre-installed plugins into $WOPR_HOME/plugins.json
if [ -d "${WOPR_BUNDLED_PLUGINS:-/app/bundled-plugins}" ] && [ -x /app/scripts/register-bundled-plugins.sh ]; then
  /app/scripts/register-bundled-plugins.sh
fi

exec "$@"
