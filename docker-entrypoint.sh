#!/bin/sh
set -e

# Fix ownership of persistent directories (volume mounts may override)
chown -R node:node /data
chown -R node:node /home/node

# Credential injection — env vars are the preferred method for platform
# deployments and remove the need for file mounts entirely:
#
#   WOPR_CLAUDE_OAUTH_TOKEN   — Claude Max OAuth access token
#   WOPR_CLAUDE_REFRESH_TOKEN — OAuth refresh token (optional)
#   WOPR_API_KEY              — Anthropic API key
#   WOPR_PLUGIN_CONFIG        — JSON blob of provider credentials
#                                e.g. {"anthropic":"sk-...","openai":"sk-..."}
#   WOPR_CREDENTIAL_KEY       — Passphrase to encrypt auth.json at rest
#
# When env vars are set, the file-mount path below is unnecessary.

# Legacy file-mount path: copy Claude credentials if mounted
if [ -f /claude-creds/.credentials.json ]; then
  mkdir -p /home/node/.claude
  install -D -o node -g node -m 600 /claude-creds/.credentials.json /home/node/.claude/.credentials.json
  echo "Claude credentials copied"
fi

# Start Tailscale daemon if installed
if command -v tailscaled >/dev/null 2>&1; then
  echo "Starting Tailscale daemon..."
  tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock &
  sleep 2

  # Bring up Tailscale if already authenticated
  if [ -f /var/lib/tailscale/tailscaled.state ]; then
    echo "Bringing up Tailscale..."
    tailscale up --accept-routes --reset || true

    # Start funnel if script exists
    if [ -f /data/start-tailscale.sh ]; then
      echo "Running Tailscale startup script..."
      /data/start-tailscale.sh || true
    fi
  fi
fi

# Register pre-installed (bundled) plugins if present (WOP-69 fat image strategy).
# This symlinks bundled plugins into $WOPR_HOME/plugins/ and seeds plugins.json
# for any not already registered. Runs as root so symlinks are created before
# dropping to node user. Idempotent — safe to run on every container start.
if [ -d "${WOPR_BUNDLED_PLUGINS:-/app/bundled-plugins}" ] && [ -x /app/scripts/register-bundled-plugins.sh ]; then
  /app/scripts/register-bundled-plugins.sh
fi

# Run the main command as node user with restart-on-idle loop
export NODE_OPTIONS="--max-old-space-size=4096"

# Check if this is the daemon command - if so, wrap in restart loop
if [ "$1" = "node" ] && echo "$@" | grep -q "daemon run"; then
  # Restart loop for daemon: exit code 75 = restart requested by restart-on-idle
  while true; do
    su-exec node "$@"
    EXIT_CODE=$?

    if [ "$EXIT_CODE" -ne 75 ]; then
      # Not a restart request - exit with the actual code
      exit "$EXIT_CODE"
    fi

    # Exit code 75 = restart-on-idle triggered - relaunch after brief pause
    echo "Restart-on-idle: relaunching daemon (exit code 75)..."
    sleep 0.5
  done
else
  # Not daemon command - run normally without restart loop
  exec su-exec node "$@"
fi
