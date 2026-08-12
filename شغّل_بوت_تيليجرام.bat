@echo off
chcp 65001 >nul
title بوت تيليجرام - دنتافلو
cd /d "%~dp0backend"
echo البوت شغّال هلق... خلّي هالنافذة مفتوحة طول ما بدك البوت يرد.
echo سكّر هالنافذة أي وقت لتوقيف البوت.
echo.
"%~dp0php83\php.exe" artisan telegram:poll
pause
