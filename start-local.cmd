@echo off
setlocal
title Anthropology Canteen
cd /d "%~dp0"

if not exist "runtime\node.exe" (
  echo.
  echo The portable runtime is missing.
  echo Please extract the complete ZIP file before starting.
  echo.
  pause
  exit /b 1
)

start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "$deadline=(Get-Date).AddMinutes(2); do { try { $response=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000' -TimeoutSec 2; if ($response.StatusCode -ge 200) { Start-Process 'http://anthropology-canteen.localhost:3000'; exit } } catch {}; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $deadline)"

echo.
echo Starting Anthropology Canteen...
echo No installation is required.
echo.
"runtime\node.exe" "portable-server.mjs"

echo.
echo Anthropology Canteen has stopped.
pause
