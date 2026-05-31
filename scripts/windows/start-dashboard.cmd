@echo off
setlocal

cd /d "%~dp0..\.."

node.exe "tools\dashboard-home\launch-dashboard.mjs"

if errorlevel 1 (
  echo.
  echo Unable to start Playwright Dashboard Home.
  echo Make sure Node.js is installed and available on PATH.
  echo.
  pause
)
