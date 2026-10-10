# Creates the sandbox used to run a second Steam account next to the main one.
# Run by the installer after Sandboxie-Plus is installed. Safe to run again.
param([string]$Box = "HackmudAlt")

$ErrorActionPreference = "Stop"

$programFiles = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
$sbie = Join-Path $programFiles "Sandboxie-Plus"
if (-not (Test-Path (Join-Path $sbie "SbieIni.exe"))) {
  Write-Error "Sandboxie-Plus is not installed in $sbie"
}

# the service can take a moment to come up right after installing
for ($i = 0; $i -lt 30; $i++) {
  $svc = Get-Service SbieSvc -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -eq "Running") { break }
  Start-Sleep -Seconds 1
}

& (Join-Path $sbie "SbieIni.exe") set $Box Enabled y
& (Join-Path $sbie "Start.exe") /reload

& (Join-Path $sbie "Start.exe") /box:$Box /wait (Join-Path $PSScriptRoot "clear-steam-autologin.cmd")
