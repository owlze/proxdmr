@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ==========================================
echo       ProxDMR -- Windows Setup
echo ==========================================
echo.

:: Add Docker Desktop to PATH if needed
if exist "C:\Program Files\Docker\Docker\resources\bin\docker.exe" (
    set "PATH=C:\Program Files\Docker\Docker\resources\bin;%PATH%"
)

:: Verify Docker is accessible
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Docker command not found!
    echo Please make sure Docker Desktop is installed and running.
    echo.
    pause
    exit /b 1
)

:: Prepare .env
if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo [+] Created .env from template
    ) else (
        type nul > .env
    )
)

:: Auto-detect IP using route print
set "AUTO_IP="
for /f "tokens=4" %%a in ('route print ^| findstr 0.0.0.0.*0.0.0.0') do (
    if not defined AUTO_IP set "AUTO_IP=%%a"
)
if not defined AUTO_IP set "AUTO_IP=127.0.0.1"

echo.
echo --- 1. Network Settings ---
set "FINAL_IP=%AUTO_IP%"
set /p "USER_IP=Host IP or domain for SSL [%AUTO_IP%]: "
if defined USER_IP set "FINAL_IP=%USER_IP%"

set "FINAL_PORT=8266"
set /p "USER_PORT=Web interface port [8266]: "
if defined USER_PORT set "FINAL_PORT=%USER_PORT%"

echo.
echo --- 2. Administrator Account ---
set "ADMIN_USER=admin"
set /p "USER_ADMIN=Admin username [admin]: "
if defined USER_ADMIN set "ADMIN_USER=%USER_ADMIN%"

set "ADMIN_PASS=proxdmr123"
set /p "USER_PASS=Admin password [proxdmr123]: "
if defined USER_PASS set "ADMIN_PASS=%USER_PASS%"

echo.
echo --- 3. Security and Registration ---
set "ALLOW_REG=false"
set /p "USER_REG=Disable open registration? [Y/n]: "
if /i "%USER_REG%"=="n" set "ALLOW_REG=true"
if /i "%USER_REG%"=="no" set "ALLOW_REG=true"

:: Update .env file using PowerShell helper to keep utf8 encoding clean
powershell -NoProfile -Command ^
  "$path = Join-Path (Get-Location) '.env';" ^
  "$c = if (Test-Path $path) { Get-Content $path } else { @() };" ^
  "$h = [ordered]@{'HOST_IP'='%FINAL_IP%'; 'PORT'='%FINAL_PORT%'; 'ADMIN_USER'='%ADMIN_USER%'; 'ADMIN_PASSWORD'='%ADMIN_PASS%'; 'ALLOW_REGISTRATION'='%ALLOW_REG%'};" ^
  "$res = @();" ^
  "foreach ($line in $c) {" ^
  "  $matched = $false;" ^
  "  foreach ($k in @($h.Keys)) {" ^
  "    if ($line -match ('^' + $k + '=')) { $res += ($k + '=' + $h[$k]); $h.Remove($k); $matched = $true; break }" ^
  "  }" ^
  "  if (-not $matched) { $res += $line }" ^
  "};" ^
  "foreach ($k in @($h.Keys)) { $res += ($k + '=' + $h[$k]) };" ^
  "[IO.File]::WriteAllLines($path, $res, [System.Text.Encoding]::UTF8)"

echo.
echo [+] Configuration saved to .env
echo.

:: Start container
echo [*] Starting ProxDMR container via Docker Compose...
docker compose up -d --build
if %errorlevel% neq 0 (
    echo [!] "docker compose" failed, trying "docker-compose"...
    docker-compose up -d --build
)

if %errorlevel% neq 0 goto :START_FAILED

echo.
echo ==========================================
echo  ProxDMR successfully started!
echo ------------------------------------------
echo  Web URL:        https://%FINAL_IP%:%FINAL_PORT%
echo  Admin User:     %ADMIN_USER%
echo  Admin Password: %ADMIN_PASS%
echo  Registration:   %ALLOW_REG%
echo ------------------------------------------
echo  First visit: accept self-signed SSL certificate in browser
echo ==========================================
goto :DONE

:START_FAILED
echo.
echo [ERROR] Failed to start ProxDMR container.

:DONE

echo.
pause
