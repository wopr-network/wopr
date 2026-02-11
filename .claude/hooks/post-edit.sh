#!/bin/bash
# Post-edit hook: auto-format the edited file with biome, then type-check
# Runs after every Edit/Write tool call

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only process TypeScript files
if [[ "$FILE_PATH" != *.ts ]]; then
  exit 0
fi

# Auto-format the edited file (fast, single file)
npx biome check --fix "$FILE_PATH" 2>&1 | tail -5

# Type-check the whole project (catches cross-file breakage)
TSC_OUTPUT=$(npx tsc --noEmit 2>&1)
TSC_EXIT=$?

if [ $TSC_EXIT -ne 0 ]; then
  echo "$TSC_OUTPUT" >&2
  exit 2  # Block: Claude sees the type errors and self-corrects
fi

exit 0
