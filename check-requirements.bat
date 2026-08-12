@echo off
setlocal enabledelayedexpansion
set ROOT=%~dp0
set FATAL=0

echo ============================================
echo   DentaFlow - Checking requirements
echo ============================================
echo.

rem --- PHP 8.3 (bundled locally at php83\php.exe, NOT the system PHP) ---
if not exist "%ROOT%php83\php.exe" (
    echo [FAIL] PHP 8.3 not found at "%ROOT%php83\php.exe"
    echo        This app requires PHP 8.3 specifically ^(see backend\composer.json^).
    echo        Download the PHP 8.3.x "Non Thread Safe" zip from https://windows.php.net/download/
    echo        and extract it into a folder named "php83" next to this script.
    set FATAL=1
) else (
    "%ROOT%php83\php.exe" -r "echo PHP_VERSION;" > "%TEMP%\dentaflow_phpver.txt" 2>nul
    set /p PHPVER=<"%TEMP%\dentaflow_phpver.txt"
    del "%TEMP%\dentaflow_phpver.txt" >nul 2>nul
    "%ROOT%php83\php.exe" -r "if (PHP_MAJOR_VERSION!==8 || PHP_MINOR_VERSION!==3) exit(1);" 2>nul
    if errorlevel 1 (
        echo [FAIL] "%ROOT%php83\php.exe" reports PHP !PHPVER! - this app needs PHP 8.3.x exactly.
        set FATAL=1
    ) else (
        echo [OK]   PHP !PHPVER! found.
    )
)

rem --- OPcache - the single biggest speed lever under `php artisan serve`.
rem php83\ is not tracked by git, so every machine's php.ini needs this
rem patched separately; this runs on every startup and is a no-op once set.
call "%ROOT%enable-opcache.bat"

rem --- Node / npm (for the frontend dev server) ---
where npm >nul 2>nul
if errorlevel 1 (
    echo [FAIL] npm not found on PATH. Install Node.js from https://nodejs.org/ first.
    set FATAL=1
) else (
    echo [OK]   npm found.
)

rem --- PostgreSQL pg_dump / pg_restore (only needed for the Backups page) ---
rem Reads PG_DUMP_PATH / PG_RESTORE_PATH from backend\.env if set there,
rem otherwise falls back to the same default config\dentaflow.php uses.
set PGDUMP=C:\Program Files\PostgreSQL\18\bin\pg_dump.exe
set PGRESTORE=C:\Program Files\PostgreSQL\18\bin\pg_restore.exe
if exist "%ROOT%backend\.env" (
    for /f "tokens=2 delims==" %%p in ('findstr /b "PG_DUMP_PATH=" "%ROOT%backend\.env" 2^>nul') do set PGDUMP=%%p
    for /f "tokens=2 delims==" %%p in ('findstr /b "PG_RESTORE_PATH=" "%ROOT%backend\.env" 2^>nul') do set PGRESTORE=%%p
)

if not exist "!PGDUMP!" (
    echo [WARN] pg_dump.exe not found at "!PGDUMP!"
    echo        The Backups page ^(create/restore^) won't work until PostgreSQL matching
    echo        that version is installed, or PG_DUMP_PATH / PG_RESTORE_PATH in
    echo        backend\.env are pointed at whatever PostgreSQL version you do have.
    echo        This does NOT block the app from running otherwise.
) else (
    echo [OK]   pg_dump.exe found.
)
if not exist "!PGRESTORE!" (
    echo [WARN] pg_restore.exe not found at "!PGRESTORE!" - same note as above.
) else (
    echo [OK]   pg_restore.exe found.
)

rem --- Dependencies installed? ---
if not exist "%ROOT%backend\vendor" (
    echo [FAIL] backend\vendor is missing - run: php83\php.exe backend\composer.phar install ^(or composer install^)
    set FATAL=1
) else (
    echo [OK]   backend dependencies installed.
)
if not exist "%ROOT%frontend\node_modules" (
    echo [FAIL] frontend\node_modules is missing - run "npm install" inside the frontend folder first.
    set FATAL=1
) else (
    echo [OK]   frontend dependencies installed.
)

echo.
if "%FATAL%"=="1" (
    echo ============================================
    echo   One or more required things are missing.
    echo   Fix the [FAIL] items above, then run this again.
    echo ============================================
    exit /b 1
)

echo ============================================
echo   All required checks passed.
echo ============================================
exit /b 0
