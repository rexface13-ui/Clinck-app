@echo off
title Update DentaFlow
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1"
exit /b %errorlevel%
