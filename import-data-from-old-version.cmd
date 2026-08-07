@echo off
setlocal
title Anthropology Canteen Data Import
cd /d "%~dp0"

echo.
echo Anthropology Canteen data import
echo.
echo Use this only if you unpacked a new version into a new folder.
echo Close Anthropology Canteen first, then drag the old data folder
echo or the old anthropology-canteen-data.json file into this window.
echo If that folder contains API settings, they will be imported too.
echo.
set /p AC_SOURCE_PATH=Old data path:

if "%AC_SOURCE_PATH%"=="" (
  echo.
  echo No path was provided.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $raw=$env:AC_SOURCE_PATH.Trim().Trim('\"'); $targetRoot=(Resolve-Path -LiteralPath '.').Path; $resolved=(Resolve-Path -LiteralPath $raw).Path; $candidate=Join-Path $resolved 'anthropology-canteen-data.json'; if (Test-Path -LiteralPath $candidate -PathType Leaf) { $source=$candidate; $sourceDir=$resolved } elseif ((Test-Path -LiteralPath $resolved -PathType Leaf) -and ((Split-Path -Leaf $resolved) -ieq 'anthropology-canteen-data.json')) { $source=$resolved; $sourceDir=Split-Path -Parent $resolved } else { throw 'Please choose the old data folder or anthropology-canteen-data.json.' }; $null = Get-Content -LiteralPath $source -Raw | ConvertFrom-Json; $destDir=Join-Path $targetRoot 'data'; New-Item -ItemType Directory -Path $destDir -Force | Out-Null; $dest=Join-Path $destDir 'anthropology-canteen-data.json'; if (Test-Path -LiteralPath $dest -PathType Leaf) { $backup=Join-Path $destDir ('anthropology-canteen-data.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json'); Copy-Item -LiteralPath $dest -Destination $backup }; Copy-Item -LiteralPath $source -Destination $dest -Force; $settingsSource=Join-Path $sourceDir 'anthropology-canteen-settings.json'; if (Test-Path -LiteralPath $settingsSource -PathType Leaf) { $null = Get-Content -LiteralPath $settingsSource -Raw | ConvertFrom-Json; Copy-Item -LiteralPath $settingsSource -Destination (Join-Path $destDir 'anthropology-canteen-settings.json') -Force }; Write-Host ''; Write-Host 'Data imported to:' $dest"

if errorlevel 1 (
  echo.
  echo Data import failed. Please check that the selected path exists.
  pause
  exit /b 1
)

echo.
echo Done. You can start Anthropology Canteen now.
pause
