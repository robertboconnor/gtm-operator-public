$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginDir = Join-Path $repoRoot "plugins\hubspot-operator"
$envFile = Join-Path $pluginDir ".env"

if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $pluginDir ".env.example") $envFile
}

Push-Location $pluginDir
npm install
npm run build
Pop-Location

Write-Host ""
Write-Host "HubSpot Operator is ready for Claude Code in this repo."
Write-Host ""
Write-Host "Put your HubSpot key here:"
Write-Host "  $envFile"
Write-Host ""
Write-Host "Set:"
Write-Host "  HUBSPOT_ACCESS_TOKEN=your_service_key"
Write-Host ""
Write-Host "Then open this repo in Claude Code and approve the project MCP server from .mcp.json."
