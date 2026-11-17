@echo off
REM Einmalig ausfuehren: installiert die benoetigten Pakete.
cd /d "%~dp0"
echo ============================================
echo   Installiere Pakete (nur beim ersten Mal)
echo ============================================
echo.
call npm install
echo.
echo Fertig. Du kannst dieses Fenster schliessen.
pause
