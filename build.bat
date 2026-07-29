@echo off
chcp 65001 >nul
title Build DentaFlow-deploy
color 0B

echo.
echo  ============================================
echo   Building DentaFlow-deploy...
echo  ============================================
echo.

set "SRC=%~dp0"
set "DST=%~dp0..\DentaFlow-deploy"

REM Build frontend
echo [1/3] Building frontend...
cd /d "%SRC%frontend"
if not exist "node_modules" (
    echo [*] Installing dependencies...
    call npm install
)
call npm run build
if errorlevel 1 ( echo [ERROR] Build failed & pause & exit /b 1 )
echo [OK] Frontend built

REM Prepare deploy folders
echo [2/3] Copying files...
if not exist "%DST%\backend"       mkdir "%DST%\backend"
if not exist "%DST%\frontend\dist" mkdir "%DST%\frontend\dist"
if not exist "%DST%\php83"         mkdir "%DST%\php83"
if not exist "%DST%\installer"     mkdir "%DST%\installer"

REM Copy backend PHP source only — no vendor/ (rebuilt via composer on the
REM customer's machine), no .env (holds this machine's secrets/DB creds),
REM no storage/logs or cached framework files, no tests.
robocopy "%SRC%backend" "%DST%\backend" /e /xd vendor node_modules storage\logs storage\framework\cache storage\framework\sessions storage\framework\views tests .git /xf .env .env.backup *.log >nul

REM storage/ needs its writable subfolders to exist even though their
REM contents were excluded above (Laravel expects the directory tree).
if not exist "%DST%\backend\storage\logs" mkdir "%DST%\backend\storage\logs"
if not exist "%DST%\backend\storage\framework\cache\data" mkdir "%DST%\backend\storage\framework\cache\data"
if not exist "%DST%\backend\storage\framework\sessions" mkdir "%DST%\backend\storage\framework\sessions"
if not exist "%DST%\backend\storage\framework\views" mkdir "%DST%\backend\storage\framework\views"

REM Copy the bundled PHP 8.3 runtime and the pre-built frontend
robocopy "%SRC%php83" "%DST%\php83" /e >nul
robocopy "%SRC%frontend\dist" "%DST%\frontend\dist" /e >nul

REM Copy installer + top-level run scripts
robocopy "%SRC%installer" "%DST%\installer" /e >nul
copy /y "%SRC%check-requirements.bat" "%DST%\" >nul
copy /y "%SRC%enable-opcache.bat"     "%DST%\" >nul

echo [OK] Done!
echo.
echo [3/3] DentaFlow-deploy is ready at:
echo  %DST%
echo.
echo  This copy has no .git history, no vendor/, no .env — nothing the
echo  customer needs to (or should) edit directly. ZIP it and send it.
echo.
pause
