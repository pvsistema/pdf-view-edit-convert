@echo off
chcp 65001 >nul 2>nul
setlocal

REM ============================================================
REM  PV-Sistema PDF - remove installed copy from C:\PVSPDF
REM  Run as Administrator.
REM ============================================================

set "INSTALL_DIR=C:\PVSPDF"

echo.
echo ============================================================
echo   PV-Sistema PDF - uninstall
echo   Folder: %INSTALL_DIR%
echo ============================================================
echo.

if not exist "%INSTALL_DIR%" (
    echo Nothing to remove - folder not found.
    pause
    exit /b 0
)

choice /C YN /M "Remove the program and all its files"
if errorlevel 2 goto :cancel

taskkill /F /IM PVSPDF.exe >nul 2>nul
timeout /t 1 /nobreak >nul

echo Removing shortcuts...
powershell -NoProfile -Command ^
  "$p=[Environment]::GetFolderPath('Desktop')+'\ПВ-Система PDF.lnk'; if(Test-Path $p){Remove-Item $p -Force}" >nul 2>nul
powershell -NoProfile -Command ^
  "$p=[Environment]::GetFolderPath('Programs')+'\ПВ-Система PDF.lnk'; if(Test-Path $p){Remove-Item $p -Force}" >nul 2>nul

echo Removing program folder...
rmdir /S /Q "%INSTALL_DIR%"

if exist "%INSTALL_DIR%" (
    echo.
    echo WARNING: some files could not be removed.
    echo          Close the program and run this file as Administrator.
) else (
    echo.
    echo Done - the program has been removed.
)

echo.
pause
exit /b 0

:cancel
echo Cancelled.
pause
exit /b 0
