@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  ========================================
echo   Smart Expense Tracker - Local Server
echo  ========================================
echo.

set "RUNNER="
set "RUN_CMD="
set "URL=http://127.0.0.1:5500/index.html"

where node >nul 2>&1
if not errorlevel 1 (
  set "RUNNER=node"
  set "RUN_CMD=node server.js"
  goto :run
)

if exist "C:\Python314\python.exe" (
  set "RUNNER=python314"
  set "RUN_CMD=C:\Python314\python.exe -m http.server 5500 --bind 0.0.0.0"
  goto :run
)

if exist "%LocalAppData%\Programs\Python\Python311\python.exe" (
  set "RUNNER=python311"
  set "RUN_CMD=%LocalAppData%\Programs\Python\Python311\python.exe -m http.server 5500 --bind 0.0.0.0"
  goto :run
)

where py >nul 2>&1
if not errorlevel 1 (
  set "RUNNER=py"
  set "RUN_CMD=py -3 -m http.server 5500 --bind 0.0.0.0"
  goto :run
)

echo  [ERROR] Node.js or Python was not found in PATH.
echo  Install Node.js from https://nodejs.org  then run start.bat again.
echo.
pause
exit /b 1

:run
echo  Using: %RUNNER%
echo  URL:   %URL%
echo.

REM 1) Already serving? just open browser
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5500/index.html' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo  Server already running. Opening browser...
  start "" "%URL%"
  echo.
  pause
  exit /b 0
)

REM 2) Port stuck by old process? free it then start
powershell -NoProfile -Command "$conns = Get-NetTCPConnection -LocalPort 5500 -State Listen -ErrorAction SilentlyContinue; foreach ($c in $conns) { $id = $c.OwningProcess; if ($id -and $id -ne 0) { try { Stop-Process -Id $id -Force -ErrorAction Stop; Write-Host ('  Freed port 5500 (PID ' + $id + ')') } catch {} } }" 2>nul

echo  Browser opens automatically when the server is ready.
echo  Close this window to stop the server.
echo.

%RUN_CMD%
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo.
  echo  [ERROR] Server failed to start. Exit code: %ERR%
  echo.
  echo  Retry tip: close other start.bat windows, then run this again.
  echo.
  pause
  exit /b %ERR%
)