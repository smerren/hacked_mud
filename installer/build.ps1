# Builds the windows installer: dist\hacked_mud-setup-<version>.exe
#
# Requirements on the build machine:
#   - bun                 https://bun.sh
#   - Inno Setup 6        winget install JRSoftware.InnoSetup
#
# Usage: powershell -ExecutionPolicy Bypass -File installer\build.ps1 [-Version 1.2.3]

param([string]$Version)

$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$stage = Join-Path $root "dist\windows"
$vendor = Join-Path $PSScriptRoot "vendor"

# pinned so the installer always ships a known build. Update all three together
$sandboxieVersion = "1.18.5"
$sandboxieInstaller = "Sandboxie-Plus-x64-v$sandboxieVersion.exe"
$sandboxieSha256 = "bd984db71900ecb9fc22e4bbffda4363a92cd755840a8792c2422d6d42fd6fa3"

function Find-Tool([string]$name, [string[]]$fallbacks) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($f in $fallbacks) { if (Test-Path $f) { return $f } }
  throw "$name not found. See the requirements at the top of installer\build.ps1"
}

function Invoke-Checked([string]$exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "$exe $($arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

$bun = Find-Tool "bun" @("$env:USERPROFILE\.bun\bin\bun.exe")
$iscc = Find-Tool "ISCC" @(
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
)

if (-not $Version) {
  $Version = (Get-Content (Join-Path $root "backend\package.json") -Raw | ConvertFrom-Json).version
}
Write-Host "Building hacked mud $Version" -ForegroundColor Cyan

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null

Push-Location $root
try {
  Write-Host "`n== Installing dependencies" -ForegroundColor Cyan
  Invoke-Checked $bun @("install", "--frozen-lockfile")

  Write-Host "`n== Compiling backend" -ForegroundColor Cyan
  Push-Location (Join-Path $root "backend")
  try {
    Invoke-Checked $bun @(
      "build", "src/index.ts", "--compile", "--target=bun-windows-x64",
      "--windows-icon=../frontend/public/favicon.ico",
      "--outfile", (Join-Path $stage "hacked_mud.exe")
    )
  } finally { Pop-Location }

  Write-Host "`n== Building dashboard" -ForegroundColor Cyan
  # "auto" makes the dashboard talk to whatever served it (the exe itself)
  $frontendEnv = @{
    NODE_ENV                    = "production"
    API_BASE_URL                = "/hacked_mud_api"
    API_FULL_URL                = "auto"
    DASHBOARD_FRONTEND_BASE_URL = "/hacked_mud_dashboard"
    DASHBOARD_FRONTEND_FULL_URL = "auto"
  }
  $previousEnv = @{}
  foreach ($k in $frontendEnv.Keys) {
    $previousEnv[$k] = [Environment]::GetEnvironmentVariable($k)
    [Environment]::SetEnvironmentVariable($k, $frontendEnv[$k])
  }
  Push-Location (Join-Path $root "frontend")
  try {
    Invoke-Checked $bun @("run", "build")
  } finally {
    Pop-Location
    foreach ($k in $previousEnv.Keys) { [Environment]::SetEnvironmentVariable($k, $previousEnv[$k]) }
  }
  Copy-Item (Join-Path $root "frontend\dist\spa") (Join-Path $stage "dashboard") -Recurse

  Write-Host "`n== Fetching Sandboxie-Plus $sandboxieVersion" -ForegroundColor Cyan
  New-Item -ItemType Directory -Force $vendor | Out-Null
  $sbiePath = Join-Path $vendor $sandboxieInstaller
  if (-not (Test-Path $sbiePath)) {
    $url = "https://github.com/sandboxie-plus/Sandboxie/releases/download/v$sandboxieVersion/$sandboxieInstaller"
    Invoke-WebRequest -UseBasicParsing $url -OutFile $sbiePath
  }
  $hash = (Get-FileHash $sbiePath -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $sandboxieSha256) {
    Remove-Item $sbiePath
    throw "Sandboxie installer hash mismatch: got $hash, expected $sandboxieSha256"
  }

  Write-Host "`n== Packaging installer" -ForegroundColor Cyan
  Invoke-Checked $iscc @(
    "/Q",
    "/DAppVersion=$Version",
    "/DStageDir=$stage",
    "/DVendorDir=$vendor",
    "/DSandboxieInstaller=$sandboxieInstaller",
    "/DOutputDir=$(Join-Path $root 'dist')",
    (Join-Path $PSScriptRoot "hacked_mud.iss")
  )
} finally { Pop-Location }

Write-Host "`nDone: $(Join-Path $root "dist\hacked_mud-setup-$Version.exe")" -ForegroundColor Green
