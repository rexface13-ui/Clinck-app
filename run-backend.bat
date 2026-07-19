@echo off
cd /d "%~dp0backend"
"%~dp0php83\php.exe" artisan serve --port=8010
