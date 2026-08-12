@echo off
if not exist "%~dp0php83\php.exe" (
    echo ERROR: PHP 8.3 not found at "%~dp0php83\php.exe"
    echo This app needs PHP 8.3 specifically ^(see backend\composer.json^) - a plain
    echo "php" on PATH is not enough. Run check-requirements.bat for details.
    pause
    exit /b 1
)
cd /d "%~dp0backend"
"%~dp0php83\php.exe" artisan serve --port=8010
