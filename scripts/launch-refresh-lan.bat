@echo off
cd /d "%~dp0.."
call pnpm refresh-lan
echo.
echo Done. You can close this window.
pause >nul
