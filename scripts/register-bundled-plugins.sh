#!/bin/sh
# register-bundled-plugins.sh — seed $WOPR_HOME/plugins.json from pre-installed
# plugins in $WOPR_BUNDLED_PLUGINS (fat image strategy, WOP-69).
#
# Called by docker-entrypoint.sh on every container start. Idempotent:
# - Symlinks each bundled plugin into $WOPR_HOME/plugins/<name>
# - Adds a plugins.json entry (disabled by default) for any plugin not
#   already registered. Existing entries are never overwritten, so user
#   enable/disable choices survive container restarts.
#
# Requires: jq (installed in the Docker image)

set -e

WOPR_HOME="${WOPR_HOME:-/data}"
BUNDLED="${WOPR_BUNDLED_PLUGINS:-/app/bundled-plugins}"
PLUGINS_DIR="${WOPR_HOME}/plugins"
PLUGINS_FILE="${WOPR_HOME}/plugins.json"

# Nothing to do if no bundled plugins directory
if [ ! -d "$BUNDLED" ]; then
  exit 0
fi

mkdir -p "$PLUGINS_DIR"

# Ensure plugins.json exists and is a valid array
if [ ! -f "$PLUGINS_FILE" ] || [ ! -s "$PLUGINS_FILE" ]; then
  echo '[]' > "$PLUGINS_FILE"
fi

# Validate it is valid JSON array; reset if corrupted
if ! jq empty "$PLUGINS_FILE" 2>/dev/null; then
  echo '[]' > "$PLUGINS_FILE"
fi

for plugin_dir in "$BUNDLED"/wopr-plugin-*; do
  [ -d "$plugin_dir" ] || continue

  dir_name=$(basename "$plugin_dir")
  target="${PLUGINS_DIR}/${dir_name}"

  # Create symlink if not already present
  if [ ! -e "$target" ]; then
    ln -s "$plugin_dir" "$target"
  fi

  # Read metadata from package.json (if present)
  pkg_file="${plugin_dir}/package.json"
  if [ -f "$pkg_file" ]; then
    name=$(jq -r '.name // empty' "$pkg_file" 2>/dev/null || echo "$dir_name")
    version=$(jq -r '.version // "0.0.0"' "$pkg_file" 2>/dev/null)
    description=$(jq -r '.description // ""' "$pkg_file" 2>/dev/null)
  else
    name="$dir_name"
    version="0.0.0"
    description=""
  fi

  # Use the directory basename as the registry key (matches how installPlugin works)
  # Skip if already registered (by name)
  already=$(jq --arg n "$name" '[.[] | select(.name == $n)] | length' "$PLUGINS_FILE" 2>/dev/null || echo "0")
  if [ "$already" -gt 0 ]; then
    continue
  fi

  # Append entry — disabled by default so user explicitly enables what they want
  now=$(date +%s)000
  jq --arg name "$name" \
     --arg version "$version" \
     --arg desc "$description" \
     --arg path "$target" \
     --arg ts "$now" \
     '. + [{
       name: $name,
       version: $version,
       description: $desc,
       source: "bundled",
       path: $path,
       enabled: false,
       installedAt: ($ts | tonumber)
     }]' "$PLUGINS_FILE" > "${PLUGINS_FILE}.tmp" \
    && mv "${PLUGINS_FILE}.tmp" "$PLUGINS_FILE"

  echo "[bundled-plugins] Registered: $name ($version)"
done

# Summary
count=$(jq '[.[] | select(.source == "bundled")] | length' "$PLUGINS_FILE" 2>/dev/null || echo "0")
echo "[bundled-plugins] $count bundled plugin(s) available. Enable with: wopr plugin enable <name>"
