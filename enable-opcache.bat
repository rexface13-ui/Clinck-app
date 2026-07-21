@echo off
rem Turns on PHP OPcache in the bundled php83\php.ini if it isn't already on.
rem This is the single biggest speed lever for this app under `php artisan
rem serve` - without it, every request re-parses the whole Laravel
rem framework from disk on every single page load. php83\ is NOT tracked by
rem git (each machine has its own local copy), so this has to run on every
rem machine separately - check-requirements.bat calls this automatically.
setlocal
set INI=%~dp0php83\php.ini

if not exist "%INI%" (
    echo [SKIP] "%INI%" not found - nothing to patch.
    exit /b 0
)

powershell -NoProfile -Command ^
    "$path = '%INI%';" ^
    "$content = Get-Content -Raw -LiteralPath $path;" ^
    "$original = $content;" ^
    "$content = $content -replace '(?m)^;zend_extension=opcache\s*$', 'zend_extension=opcache';" ^
    "$content = $content -replace '(?m)^;?opcache\.enable\s*=.*$', 'opcache.enable=1';" ^
    "$content = $content -replace '(?m)^;?opcache\.enable_cli\s*=.*$', 'opcache.enable_cli=1';" ^
    "$content = $content -replace '(?m)^;?opcache\.memory_consumption\s*=.*$', 'opcache.memory_consumption=192';" ^
    "$content = $content -replace '(?m)^;?opcache\.interned_strings_buffer\s*=.*$', 'opcache.interned_strings_buffer=16';" ^
    "$content = $content -replace '(?m)^;?opcache\.max_accelerated_files\s*=.*$', 'opcache.max_accelerated_files=10000';" ^
    "$content = $content -replace '(?m)^;?opcache\.validate_timestamps\s*=.*$', 'opcache.validate_timestamps=1';" ^
    "$content = $content -replace '(?m)^;?opcache\.revalidate_freq\s*=.*$', 'opcache.revalidate_freq=0';" ^
    "if ($content -ne $original) { Set-Content -LiteralPath $path -Value $content -NoNewline; Write-Host '[FIXED] OPcache enabled in php83\php.ini - restart the backend for it to take effect.' } else { Write-Host '[OK]    OPcache was already enabled.' }"

exit /b 0
