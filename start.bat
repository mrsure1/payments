@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  ========================================
echo   Smart Expense Tracker - Local Server
echo  ========================================
echo.
echo  Google login does NOT work on file://
echo  Opening http://localhost:5500 ...
echo.

set "PY="
where python >nul 2>&1 && set "PY=python"
if not defined PY (
  where py >nul 2>&1 && set "PY=py"
)

if not defined PY (
  echo  [ERROR] Python not found.
  echo  Install Python, or open index.html directly.
  echo  (Google login will not work with file://)
  echo.
  start "" "%~dp0index.html"
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:5500/index.html' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo  Server already running. Opening browser...
  start "" "http://localhost:5500/index.html"
  echo.
  echo  Close this window when done. (Server keeps running elsewhere)
  pause
  exit /b 0
)

echo  Starting Python server...
echo  URL: http://localhost:5500/index.html
echo.
echo  Browser will open shortly.
echo  Closing this window stops the server.
echo.

start "open-browser" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5500/index.html"

"%PY%" -m http.server 5500
if errorlevel 1 (
  echo.
  echo  [ERROR] Failed to start server.
  echo  Is port 5500 already in use?
  pause
  exit /b 1
)