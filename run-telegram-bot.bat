@echo off
if not exist "%~dp0php83\php.exe" (
    echo ERROR: PHP 8.3 not found at "%~dp0php83\php.exe"
    pause
    exit /b 1
)
cd /d "%~dp0backend"
"%~dp0php83\php.exe" artisan telegram:poll
