@echo off
REM Force a stable code page so this .bat is parsed identically on any PC.
REM (This file is pure ASCII - no national characters in commands/comments.)
chcp 65001 >nul 2>nul
setlocal enabledelayedexpansion

REM ============================================================
REM  PV-Sistema PDF desktop build (PVSPDF.exe)
REM  Run by double-click or from command line:
REM      desktop\csharp\build.bat
REM  Optional: build.bat noobf   - build without obfuscation
REM            build.bat install - build and install to C:\PVSPDF
REM  Script finds project root by itself.
REM ============================================================

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%\..\.."
set "ROOT=%CD%"
popd

set "CS_DIR=%ROOT%\desktop\csharp"
set "APP_DIR=%CS_DIR%\PvsPdfApp"
set "DIST=%CS_DIR%\dist"
set "INSTALL_DIR=C:\PVSPDF"
set "ICON_SRC=%ROOT%\public\app-icon.png"

REM ---------- Build mode ----------
set "OBFUSCATE=1"
set "DO_INSTALL=0"
if /i "%~1"=="noobf" set "OBFUSCATE=0"
if /i "%~1"=="install" set "DO_INSTALL=1"
if /i "%~2"=="install" set "DO_INSTALL=1"
if /i "%~2"=="noobf" set "OBFUSCATE=0"

REM ---------- Read app version (MANUAL) ----------
REM The version is set MANUALLY in desktop\APP_VERSION. No auto-increment.
set "VERSION_FILE=%ROOT%\desktop\APP_VERSION"
if not exist "%VERSION_FILE%" echo 1.0.0> "%VERSION_FILE%"
for /f "usebackq tokens=* delims=" %%v in (`powershell -NoProfile -Command "$p='%VERSION_FILE%'; $v=(Get-Content -Raw $p).Trim(); if($v -notmatch '^\d+\.\d+\.\d+$'){$v='1.0.0'}; Write-Output $v"`) do set "APP_VERSION=%%v"

set "BUILD_LOG=%CS_DIR%\build.log"
echo Build started %DATE% %TIME% > "%BUILD_LOG%"

echo.
echo ============================================================
echo   PV-Sistema PDF - desktop build
echo   Project root: %ROOT%
echo   App version:  %APP_VERSION%
echo   Install dir:  %INSTALL_DIR%
echo   Log file:     %BUILD_LOG%
echo ============================================================
echo.

REM ---------- [0/5] Environment ----------
echo [0/5] Checking environment...
if "%OBFUSCATE%"=="0" echo     MODE: build WITHOUT obfuscation ^(noobf^)
if "%DO_INSTALL%"=="1" echo     MODE: will install to %INSTALL_DIR% after build

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js not found - install LTS from https://nodejs.org
    goto :fail
)
for /f "delims=" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
echo     Node.js: %NODE_VER%

where dotnet >nul 2>nul
if errorlevel 1 (
    echo ERROR: .NET SDK not found - install .NET 8 SDK from
    echo        https://dotnet.microsoft.com/download/dotnet/8.0
    goto :fail
)
dotnet --list-sdks 2>nul | findstr /r "^8\." >nul
if errorlevel 1 (
    echo ERROR: .NET 8 SDK not found. Installed SDKs:
    dotnet --list-sdks
    echo        Install the .NET 8 SDK ^(not just Runtime^) from
    echo        https://dotnet.microsoft.com/download/dotnet/8.0
    goto :fail
)
echo     .NET 8 SDK: OK
echo.

REM ---------- [0/5] Project files ----------
echo [0/5] Checking project files...
set "VITE_CFG=%ROOT%\vite.config.desktop.ts"
if not exist "%ROOT%\package.json" (
    echo ERROR: package.json not found at %ROOT%
    echo        Copy the WHOLE project to this PC, not just the desktop folder.
    goto :fail
)
if not exist "%VITE_CFG%" (
    echo ERROR: vite.config.desktop.ts not found at %VITE_CFG%
    goto :fail
)
if not exist "%APP_DIR%\PvsPdfApp.csproj" (
    echo ERROR: C# project missing: %APP_DIR%
    goto :fail
)
echo     OK
echo.

REM ---------- [1/5] Frontend ----------
echo [1/5] Building frontend (desktop mode)...
cd /d "%ROOT%"
call npm install || goto :fail
call npx --no-install vite build --config "%VITE_CFG%" || goto :fail

if not exist "%ROOT%\dist-desktop\index.html" (
    echo ERROR: frontend build failed - no index.html
    goto :fail
)
echo     OK
echo.

REM ---------- [2/5] Icon ----------
echo [2/5] Application icon (pvspdf.ico)...
if exist "%APP_DIR%\pvspdf.ico" del /Q "%APP_DIR%\pvspdf.ico"
if exist "%ROOT%\public\favicon.ico" (
    copy /Y "%ROOT%\public\favicon.ico" "%APP_DIR%\pvspdf.ico" >nul
)
if exist "%APP_DIR%\pvspdf.ico" (
    echo     OK - icon ready
) else (
    echo     WARNING: icon not found - building with default icon
)
echo.

REM ---------- [3/5] PVSPDF.exe ----------
if "%OBFUSCATE%"=="1" (
    echo [3/5] Building PVSPDF.exe ^(C#^) with obfuscation...
) else (
    echo [3/5] Building PVSPDF.exe ^(C#^) WITHOUT obfuscation ^(noobf mode^)...
)
cd /d "%APP_DIR%"

REM Kill a running instance so files are not locked
taskkill /F /IM PVSPDF.exe >nul 2>nul
timeout /t 1 /nobreak >nul

if exist "%DIST%" rmdir /S /Q "%DIST%"

set "OBF_OUTDIR=bin\Release\net8.0-windows\win-x64"

echo     Compiling...
call dotnet build -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:Version=%APP_VERSION% -o "%OBF_OUTDIR%" || goto :fail

if "%OBFUSCATE%"=="0" goto :publish

echo     Installing Obfuscar tool...
call dotnet tool install --tool-path "%CS_DIR%\.tools" Obfuscar.GlobalTool
set "OBFUSCAR=%CS_DIR%\.tools\obfuscar.console.exe"
if not exist "%OBFUSCAR%" (
    echo     ERROR: Obfuscar tool did not install.
    echo            Likely no internet / blocked nuget.org / proxy on this PC.
    echo            Fix network access, or run WITHOUT obfuscation:
    echo                desktop\csharp\build.bat noobf
    goto :fail
)

echo     Obfuscating PVSPDF.dll...
set "OBF_IN=%APP_DIR%\%OBF_OUTDIR%"
set "OBF_OUT=%APP_DIR%\%OBF_OUTDIR%\obf"
powershell -NoProfile -Command "(Get-Content -Raw -LiteralPath '%APP_DIR%\obfuscar.xml').Replace('@@INPATH@@', $env:OBF_IN).Replace('@@OUTPATH@@', $env:OBF_OUT) | Set-Content -Encoding UTF8 -LiteralPath '%APP_DIR%\obfuscar.gen.xml'" || goto :fail
"%OBFUSCAR%" "%APP_DIR%\obfuscar.gen.xml" || goto :fail
copy /Y "%APP_DIR%\%OBF_OUTDIR%\obf\PVSPDF.dll" "%APP_DIR%\%OBF_OUTDIR%\PVSPDF.dll" || goto :fail

:publish
echo     Packing single-file PVSPDF.exe...
call dotnet publish -c Release -r win-x64 --self-contained true --no-build -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "%DIST%" || goto :fail

if not exist "%DIST%\PVSPDF.exe" (
    echo ERROR: PVSPDF.exe was not produced
    goto :fail
)
if "%OBFUSCATE%"=="1" ( echo     OK ^(obfuscated^) ) else ( echo     OK ^(NOT obfuscated^) )
echo.

REM ---------- [4/5] Pack frontend next to exe ----------
echo [4/5] Packing interface files...
if exist "%DIST%\web" rmdir /S /Q "%DIST%\web"
xcopy /E /I /Y /Q "%ROOT%\dist-desktop" "%DIST%\web" >nul || goto :fail
if not exist "%DIST%\web\index.html" (
    echo ERROR: interface files were not copied
    goto :fail
)
powershell -NoProfile -Command "Set-Content -NoNewline -Path '%DIST%\app_version.txt' -Value '%APP_VERSION%'" || goto :fail
if exist "%APP_DIR%\pvspdf.ico" copy /Y "%APP_DIR%\pvspdf.ico" "%DIST%\pvspdf.ico" >nul

REM Clean up debug files from dist
del /Q "%DIST%\*.pdb" >nul 2>nul
echo     OK
echo.

REM ---------- [5/5] Install to C:\PVSPDF ----------
echo [5/5] Install step...
if "%DO_INSTALL%"=="0" (
    echo     Skipped ^(run "build.bat install" to copy into %INSTALL_DIR%^)
    goto :done
)

echo     Installing into %INSTALL_DIR% ...
taskkill /F /IM PVSPDF.exe >nul 2>nul
timeout /t 1 /nobreak >nul

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if exist "%INSTALL_DIR%\web" rmdir /S /Q "%INSTALL_DIR%\web"
xcopy /E /I /Y /Q "%DIST%" "%INSTALL_DIR%" >nul
if errorlevel 1 (
    echo ERROR: could not copy into %INSTALL_DIR%
    echo        Run this .bat as Administrator.
    goto :fail
)

echo     Creating desktop shortcut...
powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\ПВ-Система PDF.lnk');" ^
  "$s.TargetPath='%INSTALL_DIR%\PVSPDF.exe';" ^
  "$s.WorkingDirectory='%INSTALL_DIR%';" ^
  "$s.IconLocation='%INSTALL_DIR%\pvspdf.ico';" ^
  "$s.Description='ПВ-Система PDF';" ^
  "$s.Save()" >nul 2>nul

echo     Creating Start menu shortcut...
powershell -NoProfile -Command ^
  "$d=[Environment]::GetFolderPath('Programs');" ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($d+'\ПВ-Система PDF.lnk');" ^
  "$s.TargetPath='%INSTALL_DIR%\PVSPDF.exe';" ^
  "$s.WorkingDirectory='%INSTALL_DIR%';" ^
  "$s.IconLocation='%INSTALL_DIR%\pvspdf.ico';" ^
  "$s.Save()" >nul 2>nul

echo     OK - installed
echo.

:done
echo Done!
echo.
echo ============================================================
echo   Build finished successfully.
echo   Output folder: %DIST%
echo     PVSPDF.exe        (version %APP_VERSION%)
echo     web\              (interface files)
echo     app_version.txt
echo   Run: PVSPDF.exe
echo ------------------------------------------------------------
if "%DO_INSTALL%"=="1" (
    echo   INSTALLED TO: %INSTALL_DIR%
    echo   Shortcuts created on Desktop and in Start menu.
) else (
    echo   TO INSTALL ON THIS PC:
    echo     desktop\csharp\build.bat install
    echo   ^(copies everything into %INSTALL_DIR% and makes shortcuts^)
)
echo ------------------------------------------------------------
echo   NOTE: the PC needs Microsoft Edge WebView2 Runtime.
echo         On Windows 10/11 it is present by default.
echo         Otherwise: https://developer.microsoft.com/microsoft-edge/webview2/
echo ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo ============================================================
echo   BUILD ABORTED - error on one of the steps.
echo   Read the message above and fix the cause.
echo   Full log: %BUILD_LOG%
echo ============================================================
echo.
pause
exit /b 1
