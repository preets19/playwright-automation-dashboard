@echo off
setlocal

set "DASHBOARD_MODE=0"
if not "%~1"=="" (
  set "DASHBOARD_MODE=1"
  cd /d "%~1"
) else (
  cd /d "%~dp0..\.."
)
title Automation Setup

if exist "..\playwright-base-framework\package.json" (
  echo.
  echo Installing and building local framework dependency...
  call npm.cmd --prefix ..\playwright-base-framework install
  if errorlevel 1 goto failed
  call npm.cmd --prefix ..\playwright-base-framework run pack:local
  if errorlevel 1 goto failed

  echo.
  echo Refreshing app template lockfile for the locally packed framework...
  if exist "package-lock.json" del /f /q "package-lock.json"
)

echo.
echo Installing template Node dependencies...
call npm.cmd install
if errorlevel 1 goto failed

echo.
echo Installing Playwright browsers...
call npx.cmd playwright install
if errorlevel 1 goto failed

echo.
echo Setup completed successfully.
echo You can now use Start Automation Dashboard.cmd or the VS Code tasks.
if "%DASHBOARD_MODE%"=="0" pause
exit /b 0

:failed
echo.
echo Setup failed. Review the message above.
if "%DASHBOARD_MODE%"=="0" pause
exit /b 1
