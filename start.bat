@echo off
setlocal
set ROOT=%~dp0

call "%ROOT%check-requirements.bat"
if errorlevel 1 (
    echo.
    echo DentaFlow was NOT started because of the problem^(s^) above.
    pause
    exit /b 1
)

echo Starting backend server...
start "DentaFlow Backend" cmd /k call "%ROOT%run-backend.bat"

echo Starting frontend server...
start "DentaFlow Frontend" cmd /k call "%ROOT%run-frontend.bat"

echo Waiting for servers...
timeout /t 5 /nobreak >nul

echo Opening browser...
start http://localhost:5183

echo.
echo DentaFlow is starting.
echo Frontend: http://localhost:5183
echo Backend:  http://localhost:8010
echo (Close the Backend and Frontend windows to stop the system)
echo.
pause
