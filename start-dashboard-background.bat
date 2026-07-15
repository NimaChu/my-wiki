@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

if not exist "tools\wiki-dashboard" exit /b 1

echo [%DATE% %TIME%] Starting Agent Wiki dashboard...>> "tools\wiki-dashboard\dashboard-autostart.log"

call npm --prefix "tools\wiki-dashboard" run graph >> "tools\wiki-dashboard\dashboard-autostart.log" 2>&1
if errorlevel 1 exit /b %ERRORLEVEL%

call :is_alive
if "%ERRORLEVEL%"=="0" (
  call :start_watcher
  echo [%DATE% %TIME%] Dashboard already running at http://127.0.0.1:5173/>> "tools\wiki-dashboard\dashboard-autostart.log"
  exit /b 0
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\start-dashboard-server.ps1"

for /l %%I in (1,1,20) do (
  powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1" >nul
  call :is_alive
  if "!ERRORLEVEL!"=="0" (
    call :start_watcher
    exit /b 0
  )
)

echo [%DATE% %TIME%] Dashboard failed to respond at http://127.0.0.1:5173/>> "tools\wiki-dashboard\dashboard-autostart.log"
exit /b 1

:start_watcher
start "" /b node "%~dp0src\watch-graph.mjs" >nul 2>&1
exit /b 0

:is_alive
powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2; if ($r.StatusCode -lt 500) { exit 0 } } catch {}; exit 1"
exit /b %ERRORLEVEL%
