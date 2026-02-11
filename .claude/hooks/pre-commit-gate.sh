#!/bin/bash
# Pre-commit gate: block git commit if biome or tsc fail
# Runs before any Bash tool call that contains "git commit"

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only gate on git commit commands
if ! echo "$COMMAND" | grep -qE 'git\s+commit'; then
  exit 0
fi

# Run biome lint + format check (no --fix, just verify)
BIOME_OUTPUT=$(npx biome check src/ 2>&1)
BIOME_EXIT=$?

if [ $BIOME_EXIT -ne 0 ]; then
  echo "Biome check failed. Run 'npx biome check --fix src/' first:" >&2
  echo "$BIOME_OUTPUT" | tail -20 >&2
  exit 2
fi

# Run TypeScript type check
TSC_OUTPUT=$(npx tsc --noEmit 2>&1)
TSC_EXIT=$?

if [ $TSC_EXIT -ne 0 ]; then
  echo "TypeScript errors found. Fix before committing:" >&2
  echo "$TSC_OUTPUT" | tail -20 >&2
  exit 2
fi

exit 0
