# ProxDMR - Deployment Script for Windows PowerShell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    $Host.UI.RawUI.WindowTitle = "ProxDMR - Setup"
} catch {}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "      ProxDMR - Развертывание сервиса     " -ForegroundColor Cyan
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
        Write-Host "[+] Docker найден: $standardPath" -ForegroundColor Green
    }
}

if (-not $dockerExe) {
    Write-Host "[ОШИБКА] Docker не найден в системе!" -ForegroundColor Red
    Write-Host "Убедитесь, что Docker Desktop установлен и запущен." -ForegroundColor Yellow
    Read-Host "Нажмите Enter для выхода"
    exit 1
}

# Verify Docker daemon is running
try {
    $null = & $dockerExe info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ОШИБКА] Служба Docker Desktop не запущена!" -ForegroundColor Red
        Write-Host "Запустите Docker Desktop и дождитесь его готовности." -ForegroundColor Yellow
        Read-Host "Нажмите Enter для выхода"
        exit 1
    }
} catch {
    Write-Host "[ОШИБКА] Не удалось связаться с Docker: $_" -ForegroundColor Red
    Read-Host "Нажмите Enter для выхода"
    exit 1
}

# 2. Prepare .env
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "[+] Создан файл .env из .env.example" -ForegroundColor Green
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
Write-Host "--- 1. Сетевые настройки ---" -ForegroundColor Yellow
$userIpInput = Read-Host "IP-адрес или домен хоста для SSL-сертификата [$autoIp]"
$finalIp = if ([string]::IsNullOrWhiteSpace($userIpInput)) { $autoIp } else { $userIpInput.Trim() }

$userPortInput = Read-Host "Порт веб-интерфейса HTTP/HTTPS [8266]"
$finalPort = if ([string]::IsNullOrWhiteSpace($userPortInput)) { "8266" } else { $userPortInput.Trim() }

Write-Host ""
Write-Host "--- 2. Учетная запись администратора ---" -ForegroundColor Yellow
$userAdminInput = Read-Host "Логин администратора (или ваш позывной) [admin]"
$finalAdmin = if ([string]::IsNullOrWhiteSpace($userAdminInput)) { "admin" } else { $userAdminInput.Trim() }

$userPassInput = Read-Host "Пароль администратора [proxdmr123]"
$finalPass = if ([string]::IsNullOrWhiteSpace($userPassInput)) { "proxdmr123" } else { $userPassInput.Trim() }

Write-Host ""
Write-Host "--- 3. Безопасность и открытая регистрация ---" -ForegroundColor Yellow
$userRegChoice = Read-Host "Запретить регистрацию посторонних пользователей (рекомендуется)? [Y/n]"
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
Write-Host "[+] Настройки успешно сохранены в .env" -ForegroundColor Green
Write-Host ""

# 4. Build and start container
Write-Host "[*] Сборка и запуск контейнера ProxDMR..." -ForegroundColor Cyan
& $dockerExe compose up -d --build

if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] 'docker compose' вернул код $LASTEXITCODE, попытка через 'docker-compose'..." -ForegroundColor Yellow
    docker-compose up -d --build
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host " ProxDMR успешно запущен!" -ForegroundColor Green
    Write-Host "------------------------------------------" -ForegroundColor Green
    Write-Host " Веб-интерфейс:   https://${finalIp}:${finalPort}" -ForegroundColor Cyan
    Write-Host " Логин админа:    $finalAdmin" -ForegroundColor Cyan
    Write-Host " Пароль админа:   $finalPass" -ForegroundColor Cyan
    $regText = if ($allowReg -eq "true") { "Разрешена для всех" } else { "Отключена (закрытый доступ)" }
    Write-Host " Регистрация:     $regText" -ForegroundColor Cyan
    Write-Host "------------------------------------------" -ForegroundColor Green
    Write-Host " (при первом открытии подтвердите самоподписанный SSL-сертификат)" -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor Green
} else {
    Write-Host "[ОШИБКА] Не удалось запустить контейнер ProxDMR." -ForegroundColor Red
}

Write-Host ""
Read-Host "Нажмите Enter для завершения"
