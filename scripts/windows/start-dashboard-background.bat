@echo off
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0..\..") do set "SKILL_ROOT=%%~fI"
cd /d "%SKILL_ROOT%"
set "MY_WIKI_DASHBOARD_PORT=5173"

echo [%DATE% %TIME%] Starting My Wiki dashboard...>> "%SKILL_ROOT%\assets\dashboard\dashboard-autostart.log"
node "%SKILL_ROOT%\scripts\my-wiki.mjs" dashboard >> "%SKILL_ROOT%\assets\dashboard\dashboard-autostart.log" 2>&1
exit /b %ERRORLEVEL%
