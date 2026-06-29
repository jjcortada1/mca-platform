#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web)
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo '{"async": false}'

# Pull latest changes from current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Pulling latest changes from $CURRENT_BRANCH..."
git pull origin "$CURRENT_BRANCH" 2>&1 || echo "Git pull completed with status: $?"

# Note: npm install is typically already done, just ensure we have latest code
echo "Environment ready with latest code from $CURRENT_BRANCH"
