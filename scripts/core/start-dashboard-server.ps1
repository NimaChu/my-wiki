$ErrorActionPreference = "Stop"

$skill = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dashboard = Join-Path $skill "assets\dashboard"
$log = Join-Path $dashboard "vite.log"
$port = if ($env:MY_WIKI_DASHBOARD_PORT) { $env:MY_WIKI_DASHBOARD_PORT } else { "5173" }
$server = Join-Path $dashboard "server.mjs"

Start-Process -WindowStyle Hidden -FilePath "node.exe" -WorkingDirectory $dashboard -ArgumentList @(
  $server,
  $port
) -RedirectStandardOutput $log -RedirectStandardError (Join-Path $dashboard "vite-error.log")
