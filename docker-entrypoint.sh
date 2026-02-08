#!/bin/sh
set -e

# Fix ownership of persistent directories (volume mounts may override)
chown -R node:node /data
chown -R node:node /home/node

# Copy Claude credentials if mounted (as root, then chown to node)
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

# Run the main command as node user
export NODE_OPTIONS="--max-old-space-size=4096"
exec runuser -u node -- "$@"
