@echo off
setlocal

cd /d "%~dp0..\.."
set "REPO_ROOT=%CD%"
set "DASHBOARD_URL=http://127.0.0.1:4310"

call powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$response = Invoke-WebRequest -UseBasicParsing '%DASHBOARD_URL%' -TimeoutSec 2 -ErrorAction SilentlyContinue; if ($response.Content -like '*<title>Test Dashboard</title>*') { exit 0 } exit 1" >nul 2>nul
if not errorlevel 1 goto openDashboard

call powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'node.exe' -ArgumentList @('tools/test-dashboard/server.mjs') -WorkingDirectory '%REPO_ROOT%' -WindowStyle Hidden" >nul 2>nul
ping 127.0.0.1 -n 4 >nul

:openDashboard
start "" "%DASHBOARD_URL%"
