#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$REPO_ROOT/plugins/hubspot-operator"
TARGET_DIR="$HOME/.codex/plugins/hubspot-operator"
MARKETPLACE_DIR="$HOME/.agents/plugins"
MARKETPLACE_FILE="$MARKETPLACE_DIR/marketplace.json"
PRESERVED_ENV=""

mkdir -p "$(dirname "$TARGET_DIR")"
if [[ -f "$TARGET_DIR/.env" ]]; then
  PRESERVED_ENV="$(mktemp)"
  cp "$TARGET_DIR/.env" "$PRESERVED_ENV"
fi
rm -rf "$TARGET_DIR"
cp -R "$SOURCE_DIR" "$TARGET_DIR"

if [[ -n "$PRESERVED_ENV" ]]; then
  cp "$PRESERVED_ENV" "$TARGET_DIR/.env"
  rm -f "$PRESERVED_ENV"
elif [[ ! -f "$TARGET_DIR/.env" ]]; then
  cp "$TARGET_DIR/.env.example" "$TARGET_DIR/.env"
fi

cd "$TARGET_DIR"
npm install
npm run build

mkdir -p "$MARKETPLACE_DIR"
node - "$MARKETPLACE_FILE" "$TARGET_DIR" <<'EOF'
const fs = require("node:fs");

const marketplaceFile = process.argv[2];
const pluginPath = process.argv[3];
const pluginEntry = {
  name: "hubspot-operator",
  source: {
    source: "local",
    path: pluginPath,
  },
  policy: {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  },
  category: "Productivity",
};

let marketplace = {
  name: "local-plugins",
  interface: {
    displayName: "Local Plugins",
  },
  plugins: [],
};

if (fs.existsSync(marketplaceFile)) {
  marketplace = JSON.parse(fs.readFileSync(marketplaceFile, "utf8"));
}

if (!Array.isArray(marketplace.plugins)) {
  marketplace.plugins = [];
}

const existingIndex = marketplace.plugins.findIndex(
  (plugin) => plugin && plugin.name === pluginEntry.name,
);

if (existingIndex >= 0) {
  marketplace.plugins[existingIndex] = {
    ...marketplace.plugins[existingIndex],
    ...pluginEntry,
  };
} else {
  marketplace.plugins.push(pluginEntry);
}

fs.writeFileSync(marketplaceFile, `${JSON.stringify(marketplace, null, 2)}\n`);
EOF

echo
echo "HubSpot Operator installed for Codex:"
echo "  $TARGET_DIR"
echo
echo "Marketplace registration written to:"
echo "  $MARKETPLACE_FILE"
echo
echo "Put your HubSpot key here:"
echo "  $TARGET_DIR/.env"
echo
echo "Set:"
echo "  HUBSPOT_ACCESS_TOKEN=your_service_key"
