@echo off
rem Runs INSIDE the sandbox (see setup-sandbox.ps1), so it only changes the sandbox's copy of the registry.
rem Without this the sandboxed Steam would auto-login as the main account.
reg add "HKCU\Software\Valve\Steam" /v AutoLoginUser /t REG_SZ /d "" /f
