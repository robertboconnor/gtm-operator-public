#!/usr/bin/env bash
set -euo pipefail

SERVER_NAME="${1:-}"
PORT="${2:-}"

if [[ -z "$SERVER_NAME" || -z "$PORT" ]]; then
  echo "Usage: salesforce-mcp-remote.sh <server-name> <port>" >&2
  exit 2
fi

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

if [[ -z "${SALESFORCE_MCP_CLIENT_ID:-}" ]]; then
  echo "SALESFORCE_MCP_CLIENT_ID is required in .env" >&2
  exit 2
fi

case "${SALESFORCE_MCP_ENVIRONMENT:-sandbox}" in
  sandbox)
    BASE_URL="https://api.salesforce.com/platform/mcp/v1/sandbox/platform"
    ;;
  production)
    BASE_URL="https://api.salesforce.com/platform/mcp/v1/platform"
    ;;
  *)
    echo "SALESFORCE_MCP_ENVIRONMENT must be sandbox or production" >&2
    exit 2
    ;;
esac

CLIENT_INFO=$(printf '{"client_id":"%s","client_secret":""}' "$SALESFORCE_MCP_CLIENT_ID")

exec npx -y mcp-remote \
  "$BASE_URL/$SERVER_NAME" \
  "$PORT" \
  --static-oauth-client-info "$CLIENT_INFO"
