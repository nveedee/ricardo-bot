@echo off
REM Findet deine Telegram Chat-ID und traegt sie automatisch in die .env ein.
REM VORHER: Token in .env eingefuegt UND deinem Bot einmal geschrieben.
cd /d "%~dp0"
echo ============================================
echo   Telegram-Verbindung einrichten
echo ============================================
echo.
node setup.mjs
echo.
pause
