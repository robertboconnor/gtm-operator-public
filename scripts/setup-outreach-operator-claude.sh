#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/plugins/outreach-operator"

if [[ ! -f "$PLUGIN_DIR/.env" ]]; then
  cp "$PLUGIN_DIR/.env.example" "$PLUGIN_DIR/.env"
fi

cd "$PLUGIN_DIR"
npm install
npm run build

echo
echo "Outreach Operator is built for Claude Code in this repo."
echo
echo "1. Put the Outreach OAuth app credentials here:"
echo "     $PLUGIN_DIR/.env"
echo
echo "   Set:"
echo "     OUTREACH_CLIENT_ID=your_outreach_oauth_application_id"
echo "     OUTREACH_CLIENT_SECRET=your_outreach_application_secret"
echo
echo "2. Sign in to Outreach once on this machine:"
echo "     npm run login --prefix plugins/outreach-operator"
echo
echo "   Your browser will warn that 127.0.0.1:5555 is not secure. That is this"
echo "   script's own local listener with a self-signed certificate — choose"
echo "   'Advanced' then 'Proceed'."
echo
echo "3. Open this repo in Claude Code and approve the project MCP servers from .mcp.json."
