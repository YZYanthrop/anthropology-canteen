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

set "AC_SOURCE_PATH=%AC_SOURCE_PATH:"=%"
set "AC_NODE=%~dp0runtime\node.exe"
set "AC_IMPORTER=%~dp0tools\import-data.mjs"

if not exist "%AC_NODE%" (
  echo.
  echo The bundled Node.js runtime is missing.
  pause
  exit /b 1
)
if not exist "%AC_IMPORTER%" (
  echo.
  echo The data import tool is missing.
  pause
  exit /b 1
)

"%AC_NODE%" "%AC_IMPORTER%" --source "%AC_SOURCE_PATH%" --target-root "%~dp0"

if errorlevel 1 (
  echo.
  echo Data import failed. Existing data was left unchanged.
  pause
  exit /b 1
)

echo.
echo Done. You can start Anthropology Canteen now.
pause
