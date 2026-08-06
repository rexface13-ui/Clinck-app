@echo off
title Update DentaFlow Database
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0migrate.ps1"
exit /b %errorlevel%
