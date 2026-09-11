$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $repoRoot "plugins\hubspot-operator"
$targetDir = Join-Path $HOME ".codex\plugins\hubspot-operator"
$marketplaceDir = Join-Path $HOME ".agents\plugins"
$marketplaceFile = Join-Path $marketplaceDir "marketplace.json"

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetDir) | Out-Null
if (Test-Path $targetDir) {
  Remove-Item -Recurse -Force $targetDir
}
Copy-Item -Recurse -Force $sourceDir $targetDir

$envFile = Join-Path $targetDir ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $targetDir ".env.example") $envFile
}

Push-Location $targetDir
npm install
npm run build
Pop-Location

New-Item -ItemType Directory -Force -Path $marketplaceDir | Out-Null

$pluginEntry = @{
  name = "hubspot-operator"
  source = @{
    source = "local"
    path = "./plugins/hubspot-operator"
  }
  policy = @{
    installation = "AVAILABLE"
    authentication = "ON_INSTALL"
  }
  category = "Productivity"
}

if (Test-Path $marketplaceFile) {
  $marketplace = Get-Content $marketplaceFile -Raw | ConvertFrom-Json
} else {
  $marketplace = [pscustomobject]@{
    name = "local-plugins"
    interface = @{
      displayName = "Local Plugins"
    }
    plugins = @()
  }
}

if ($null -eq $marketplace.plugins) {
  $marketplace | Add-Member -NotePropertyName plugins -NotePropertyValue @()
}

$existing = @($marketplace.plugins) | Where-Object { $_.name -eq $pluginEntry.name }
if ($existing.Count -gt 0) {
  $marketplace.plugins = @($marketplace.plugins | Where-Object { $_.name -ne $pluginEntry.name }) + [pscustomobject]$pluginEntry
} else {
  $marketplace.plugins = @($marketplace.plugins) + [pscustomobject]$pluginEntry
}

$marketplace | ConvertTo-Json -Depth 8 | Set-Content $marketplaceFile

Write-Host ""
Write-Host "HubSpot Operator installed for Codex:"
Write-Host "  $targetDir"
Write-Host ""
Write-Host "Marketplace registration written to:"
Write-Host "  $marketplaceFile"
Write-Host ""
Write-Host "Put your HubSpot key here:"
Write-Host "  $envFile"
Write-Host ""
Write-Host "Set:"
Write-Host "  HUBSPOT_ACCESS_TOKEN=your_service_key"
