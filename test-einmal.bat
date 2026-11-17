@echo off
REM Nur zum Ausprobieren: ein einziger Durchlauf, dann Ende.
REM Zeigt, was gefunden wird. Beim allerersten Mal werden absichtlich
REM noch keine Nachrichten verschickt (nur die aktuelle Liste gemerkt).
cd /d "%~dp0"
echo ============================================
echo   Test: ein Durchlauf
echo ============================================
echo.
node index.js --once
echo.
pause
