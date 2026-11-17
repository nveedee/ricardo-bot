@echo off
REM Startet den Bot. Prueft alle paar Minuten und schickt Telegram-Nachrichten.
REM Fenster offen lassen. Beenden mit Strg+C oder Fenster schliessen.
cd /d "%~dp0"
echo ============================================
echo   Ricardo Deal Alert Bot laeuft
echo   (Fenster offen lassen - beenden mit Strg+C)
echo ============================================
echo.
node index.js
echo.
echo Bot wurde beendet.
pause
