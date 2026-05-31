@echo off
setlocal

cd /d "%~dp0..\.."
title Automation Validation

call npm.cmd run validate
pause
