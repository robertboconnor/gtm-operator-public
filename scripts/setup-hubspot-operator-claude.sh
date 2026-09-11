#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/plugins/hubspot-operator"

if [[ ! -f "$PLUGIN_DIR/.env" ]]; then
  cp "$PLUGIN_DIR/.env.example" "$PLUGIN_DIR/.env"
fi

cd "$PLUGIN_DIR"
npm install
npm run build

echo
echo "HubSpot Operator is ready for Claude Code in this repo."
echo
echo "Put your HubSpot key here:"
echo "  $PLUGIN_DIR/.env"
echo
echo "Set:"
echo "  HUBSPOT_ACCESS_TOKEN=your_service_key"
echo
echo "Then open this repo in Claude Code and approve the project MCP server from .mcp.json."
