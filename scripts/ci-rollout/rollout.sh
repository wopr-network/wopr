#!/usr/bin/env bash
set -euo pipefail

# CI Rollout Script — push caller-ci.yml and dependabot.yml to wopr-network repos
# Usage: rollout.sh [--all | repo1 repo2 ...] [--dry-run] [--force]

# Preflight: check required tools
for cmd in gh jq base64; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Error: $cmd is required but not installed"; exit 1; }
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CALLER_TEMPLATE="${SCRIPT_DIR}/caller-ci.yml"
DEPENDABOT_TEMPLATE="${SCRIPT_DIR}/dependabot.yml"

ORG="wopr-network"

# Repos to skip (not Node.js consumers of the shared workflow)
SKIP_REPOS=(".github" "wopr-skills" "wopr-claude-hooks")

DRY_RUN=false
FORCE=false
ALL=false
REPOS=()

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)  DRY_RUN=true; shift ;;
    --force)    FORCE=true; shift ;;
    --all)      ALL=true; shift ;;
    -*)         echo "Unknown option: $1" >&2; exit 1 ;;
    *)          REPOS+=("$1"); shift ;;
  esac
done

if $ALL; then
  REPOS=()
  while IFS= read -r repo; do
    REPOS+=("$repo")
  done < <(gh api --paginate "orgs/${ORG}/repos?per_page=100&type=all" --jq '.[].name' | sort)
fi

if [[ ${#REPOS[@]} -eq 0 ]]; then
  echo "Usage: rollout.sh [--all | repo1 repo2 ...] [--dry-run] [--force]"
  exit 1
fi

# Counters
created=0
updated=0
skipped=0
warnings=0

# Base64-encode templates
CALLER_B64=$(base64 < "$CALLER_TEMPLATE" | tr -d '\n')
DEPENDABOT_B64=$(base64 < "$DEPENDABOT_TEMPLATE" | tr -d '\n')

should_skip() {
  local repo="$1"
  for skip in "${SKIP_REPOS[@]}"; do
    if [[ "$repo" == "$skip" ]]; then
      return 0
    fi
  done
  return 1
}

put_file() {
  local repo="$1"
  local path="$2"
  local content_b64="$3"
  local message="$4"

  # Check if file already exists to get its sha
  local sha=""
  local existing
  if existing=$(gh api "repos/${ORG}/${repo}/contents/${path}" 2>/dev/null); then
    sha=$(echo "$existing" | jq -r '.sha // empty')
  fi

  local payload
  if [[ -n "$sha" ]]; then
    payload=$(jq -n --arg msg "$message" --arg content "$content_b64" --arg sha "$sha" \
      '{message: $msg, content: $content, sha: $sha}')
  else
    payload=$(jq -n --arg msg "$message" --arg content "$content_b64" \
      '{message: $msg, content: $content}')
  fi

  gh api "repos/${ORG}/${repo}/contents/${path}" \
    --method PUT \
    --input - <<< "$payload" > /dev/null
}

for repo in "${REPOS[@]}"; do
  # Skip non-consumer repos
  if should_skip "$repo"; then
    echo "SKIP    ${repo} (in skip list)"
    ((skipped++))
    continue
  fi

  if $DRY_RUN; then
    echo "DRY-RUN ${repo} (would push ci.yml + dependabot.yml)"
    continue
  fi

  # --- CI workflow handling ---
  ci_handled=false
  existing_ci=""
  existing_ci_content=""
  if existing_ci=$(gh api "repos/${ORG}/${repo}/contents/.github/workflows/ci.yml" 2>/dev/null); then
    existing_ci_content=$(echo "$existing_ci" | jq -r '.content // empty' | base64 -d 2>/dev/null || true)
  fi

  if [[ -n "$existing_ci_content" ]]; then
    if echo "$existing_ci_content" | grep -q "ci-shared.yml"; then
      echo "SKIP    ${repo} ci.yml (already uses reusable workflow)"
      ((skipped++))
    elif ! $FORCE; then
      echo "WARNING ${repo} has custom ci.yml (use --force to overwrite)"
      ((warnings++))
    else
      echo "FORCE   ${repo} (overwriting existing ci.yml)"
      put_file "$repo" ".github/workflows/ci.yml" "$CALLER_B64" "ci: add shared CI workflow (WOP-182)"
      echo "UPDATED ci.yml in ${repo}"
      ((updated++))
      ci_handled=true
    fi
  else
    put_file "$repo" ".github/workflows/ci.yml" "$CALLER_B64" "ci: add shared CI workflow (WOP-182)"
    echo "CREATED ci.yml in ${repo}"
    ((created++))
    ci_handled=true
  fi

  # --- Dependabot handling (always processed, independent of CI) ---
  existing_depbot=""
  if existing_depbot=$(gh api "repos/${ORG}/${repo}/contents/.github/dependabot.yml" 2>/dev/null); then
    if ! $FORCE; then
      echo "SKIP    ${repo} dependabot.yml (already exists, use --force to overwrite)"
    else
      put_file "$repo" ".github/dependabot.yml" "$DEPENDABOT_B64" "ci: add dependabot config (WOP-182)"
      echo "UPDATED dependabot.yml in ${repo}"
      ((updated++))
    fi
  else
    put_file "$repo" ".github/dependabot.yml" "$DEPENDABOT_B64" "ci: add dependabot config (WOP-182)"
    echo "CREATED dependabot.yml in ${repo}"
    ((created++))
  fi
done

echo ""
echo "--- Summary ---"
echo "Created: ${created}"
echo "Updated: ${updated}"
echo "Skipped: ${skipped}"
echo "Warnings: ${warnings}"
