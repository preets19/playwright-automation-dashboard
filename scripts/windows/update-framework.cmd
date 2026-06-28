@echo off
setlocal

set "DASHBOARD_MODE=0"
if not "%~1"=="" (
  set "DASHBOARD_MODE=1"
  cd /d "%~1"
) else (
  cd /d "%~dp0..\.."
)
title Update Framework Dependency

if not exist "..\playwright-base-framework\package.json" goto noframework

echo.
echo Building and packing local framework dependency...
call npm.cmd --prefix ..\playwright-base-framework run pack:local
if errorlevel 1 goto failed

echo.
echo Updating framework dependency from local framework package...
for /f "delims=" %%i in ('node -e "console.log(require('./package.json').devDependencies['@your-org/playwright-base-framework'])"') do set "FRAMEWORK_SPEC=%%i"
call npm.cmd install "@your-org/playwright-base-framework@%FRAMEWORK_SPEC%"
if errorlevel 1 goto failed

echo.
echo Framework dependency updated successfully.
if "%DASHBOARD_MODE%"=="0" pause
exit /b 0

:noframework
echo.
echo Could not find ..\playwright-base-framework.
echo.
echo If this automation repo is already in its own repo, update package.json to use
echo the framework GitHub/package-registry dependency, then run Setup Automation.cmd.
if "%DASHBOARD_MODE%"=="0" pause
exit /b 1

:failed
echo.
echo Framework update failed. Review the message above.
if "%DASHBOARD_MODE%"=="0" pause
exit /b 1
