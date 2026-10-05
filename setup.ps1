# ProxDMR - Deployment Script for Windows PowerShell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    $Host.UI.RawUI.WindowTitle = "ProxDMR - Setup"
} catch {}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "         ProxDMR - Setup & Deploy         " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Search Docker
$dockerCmd = Get-Command "docker" -ErrorAction SilentlyContinue
$dockerExe = if ($dockerCmd) { $dockerCmd.Source } else { $null }

if (-not $dockerExe) {
    $standardPath = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
    if (Test-Path $standardPath) {
        $dockerExe = $standardPath
        $env:PATH = "C:\Program Files\Docker\Docker\resources\bin;" + $env:PATH
        Write-Host "[+] Docker found: $standardPath" -ForegroundColor Green
    }
}

if (-not $dockerExe) {
    Write-Host "[ERROR] Docker not found on the system!" -ForegroundColor Red
    Write-Host "Please ensure Docker Desktop is installed and running." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Verify Docker daemon is running
try {
    $null = & $dockerExe info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Docker Desktop service is not running!" -ForegroundColor Red
        Write-Host "Start Docker Desktop and wait until it is ready." -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }
} catch {
    Write-Host "[ERROR] Failed to contact Docker daemon: $_" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# 2. Prepare .env
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "[+] Created .env file from template" -ForegroundColor Green
    } else {
        New-Item -ItemType File -Path ".env" | Out-Null
    }
}

# 3. Detect Host IP
$autoIp = "127.0.0.1"
try {
    $ipObj = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { 
        $_.InterfaceAlias -notmatch "(Loopback|vEthernet|WSL|Virtual|Bluetooth)" -and 
        $_.IPv4Address -notlike "127.*" -and 
        $_.IPv4Address -notlike "169.254.*" 
    } | Select-Object -First 1

    if ($ipObj) {
        $autoIp = $ipObj.IPv4Address
    }
} catch {}

if ($autoIp -eq "127.0.0.1") {
    try {
        $s = New-Object System.Net.Sockets.UdpClient
        $s.Connect("8.8.8.8", 80)
        $autoIp = $s.Client.LocalEndPoint.Address.ToString()
        $s.Close()
    } catch {}
}

Write-Host ""
Write-Host "--- 1. Network Settings ---" -ForegroundColor Yellow
$userIpInput = Read-Host "Host IP or domain for SSL certificate [$autoIp]"
$finalIp = if ([string]::IsNullOrWhiteSpace($userIpInput)) { $autoIp } else { $userIpInput.Trim() }

$userPortInput = Read-Host "Web interface port HTTP/HTTPS [8266]"
$finalPort = if ([string]::IsNullOrWhiteSpace($userPortInput)) { "8266" } else { $userPortInput.Trim() }

Write-Host ""
Write-Host "--- 2. Administrator Account ---" -ForegroundColor Yellow
$userAdminInput = Read-Host "Admin username or callsign [admin]"
$finalAdmin = if ([string]::IsNullOrWhiteSpace($userAdminInput)) { "admin" } else { $userAdminInput.Trim() }

$userPassInput = Read-Host "Admin password [proxdmr123]"
$finalPass = if ([string]::IsNullOrWhiteSpace($userPassInput)) { "proxdmr123" } else { $userPassInput.Trim() }

Write-Host ""
Write-Host "--- 3. Security & Open Registration ---" -ForegroundColor Yellow
$userRegChoice = Read-Host "Disable public user registration (recommended)? [Y/n]"
$allowReg = if ($userRegChoice -match "^[nN]") { "true" } else { "false" }

# Helper to save variable to .env
function Set-EnvVar($key, $val) {
    $envContent = Get-Content ".env" -ErrorAction SilentlyContinue
    $newLines = @()
    $found = $false
    foreach ($line in $envContent) {
        if ($line -match "^$key=") {
            $newLines += "$key=$val"
            $found = $true
        } else {
            $newLines += $line
        }
    }
    if (-not $found) {
        $newLines += "$key=$val"
    }
    [IO.File]::WriteAllLines((Join-Path $scriptDir ".env"), $newLines, [System.Text.Encoding]::UTF8)
}

Set-EnvVar "HOST_IP" $finalIp
Set-EnvVar "PORT" $finalPort
Set-EnvVar "ADMIN_USER" $finalAdmin
Set-EnvVar "ADMIN_PASSWORD" $finalPass
Set-EnvVar "ALLOW_REGISTRATION" $allowReg

Write-Host ""
Write-Host "[+] Configuration saved to .env" -ForegroundColor Green
Write-Host ""

# 4. Build and start container
Write-Host "[*] Building and starting ProxDMR container..." -ForegroundColor Cyan
& $dockerExe compose up -d --build

if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] 'docker compose' returned exit code $LASTEXITCODE, falling back to 'docker-compose'..." -ForegroundColor Yellow
    docker-compose up -d --build
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host " ProxDMR successfully running!" -ForegroundColor Green
    Write-Host "------------------------------------------" -ForegroundColor Green
    Write-Host " Web UI:          https://${finalIp}:${finalPort}" -ForegroundColor Cyan
    Write-Host " Admin Login:     $finalAdmin" -ForegroundColor Cyan
    Write-Host " Admin Password:  $finalPass" -ForegroundColor Cyan
    $regText = if ($allowReg -eq "true") { "Allowed (Open)" } else { "Disabled (Private access)" }
    Write-Host " Registration:    $regText" -ForegroundColor Cyan
    Write-Host "------------------------------------------" -ForegroundColor Green
    Write-Host " (accept the self-signed SSL certificate on first browser access)" -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Failed to start ProxDMR container." -ForegroundColor Red
}

Write-Host ""
Read-Host "Press Enter to finish"
