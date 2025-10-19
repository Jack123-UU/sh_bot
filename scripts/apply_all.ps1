# PowerShell wrapper
param(
  [string]$RepoRoot = "."
)
$RepoRoot = Resolve-Path $RepoRoot
Write-Host "Repo root: $RepoRoot"
node "$PSScriptRoot\apply_all.js" "$RepoRoot"
