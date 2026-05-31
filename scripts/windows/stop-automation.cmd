@echo off
setlocal

cd /d "%~dp0..\.."
title Stop Automation

call node scripts\windows\stop-automation.mjs
echo.
echo Automation stop request completed.
pause
