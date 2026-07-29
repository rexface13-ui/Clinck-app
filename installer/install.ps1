$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ROOT    = Split-Path -Parent $PSScriptRoot
$BACKEND = Join-Path $ROOT "backend"
$PHP     = Join-Path $ROOT "php83\php.exe"
$LOG     = Join-Path $PSScriptRoot "install_log.txt"
$PG_PASS = "DentaFlow_2026_pg"
$DB_NAME = "dentaflow"

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Add-Content -Path $LOG -Value $line -Encoding UTF8
}
function Pause-Exit([string]$msg = "اضغط Enter للإغلاق") {
    try { Read-Host $msg | Out-Null } catch { Start-Sleep -Seconds 3 }
}
function Step($msg) { Write-Host ""; Write-Host "=== $msg ===" -ForegroundColor Cyan; Log $msg }
function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green; Log "OK: $msg" }
function Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow; Log "WARN: $msg" }
function Err($msg)  { Write-Host "[ERROR] $msg" -ForegroundColor Red; Log "ERROR: $msg" }

# مجلد المثبّتات الأوفلاين (اختياري) — ضع فيه ملف postgresql-*.exe مسبقاً
# لتفادي الاعتماد على الإنترنت (نفس فكرة نظام السبا).
$PREREQS_DIR = Join-Path $PSScriptRoot "prereqs"
function Find-OfflineInstaller([string]$pattern) {
    if (-not (Test-Path $PREREQS_DIR)) { return $null }
    $f = Get-ChildItem -Path $PREREQS_DIR -Filter $pattern -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($f) { return $f.FullName }
    return $null
}

function Invoke-WithRetry {
    param([scriptblock]$Action, [int]$MaxAttempts = 3, [int]$DelaySeconds = 5, [string]$Description = "العملية")
    for ($i = 1; $i -le $MaxAttempts; $i++) {
        try { & $Action; return $true }
        catch {
            Warn "$Description فشلت (محاولة $i/$MaxAttempts): $($_.Exception.Message)"
            if ($i -lt $MaxAttempts) { Start-Sleep -Seconds $DelaySeconds }
        }
    }
    return $false
}

"[$(Get-Date)] Install started" | Out-File -FilePath $LOG -Encoding UTF8

Write-Host ""
Write-Host "============================================"
Write-Host "  DentaFlow - التثبيت الكامل"
Write-Host "============================================"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Err "يجب تشغيل هذا الملف كمسؤول (Run as Administrator) — بالزر اليمين على install.bat"
    Pause-Exit
    exit 1
}
Ok "صلاحيات المسؤول"

# ═══════════════════════════════════════════════════════════════════════════
# [1/6] PHP (مرفق مسبقاً جوا نسخة التنصيب — ما بحتاج تنزيل)
# ═══════════════════════════════════════════════════════════════════════════
Step "[1/6] التحقق من PHP المرفق"
if (-not (Test-Path $PHP)) {
    Err "php83\php.exe غير موجود جوا نسخة التنصيب — تأكد إنك فتحت الـ ZIP كامل"
    Pause-Exit
    exit 1
}
Ok "PHP: $PHP"

# ═══════════════════════════════════════════════════════════════════════════
# [2/6] PostgreSQL — تثبيت تلقائي إذا مو موجود
# ═══════════════════════════════════════════════════════════════════════════
Step "[2/6] التحقق من PostgreSQL"

function Find-PgBin {
    foreach ($v in @("18","17","16","15","14","13")) {
        $p = "C:\Program Files\PostgreSQL\$v\bin"
        if (Test-Path "$p\psql.exe") { return $p }
    }
    return $null
}
function Test-PgWorks($pgBin) {
    if (-not $pgBin) { return $false }
    try { & "$pgBin\psql.exe" --version 2>&1 | Out-Null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

$pgBin = Find-PgBin
if (-not (Test-PgWorks $pgBin)) {
    Warn "PostgreSQL غير مثبّت — جاري التثبيت التلقائي (هيدا بياخد كم دقيقة)"

    $pgExeArgs = @(
        "--mode", "unattended",
        "--unattendedmodeui", "minimal",
        "--superpassword", $PG_PASS,
        "--servicename", "postgresql-x64-18",
        "--servicepassword", $PG_PASS,
        "--serverport", "5432",
        "--disable-components", "stackbuilder"
    )
    $installed = $false

    # أولوية 1: مثبّت أوفلاين محلي (installer\prereqs\postgresql-*.exe)
    $offlinePg = Find-OfflineInstaller "postgresql-*.exe"
    if ($offlinePg) {
        Ok "وُجد مثبّت PostgreSQL أوفلاين: $offlinePg"
        Start-Process -FilePath $offlinePg -ArgumentList $pgExeArgs -Wait -NoNewWindow
        Start-Sleep -Seconds 5
        $pgBin = Find-PgBin
        if (Test-PgWorks $pgBin) { $installed = $true }
    }

    # أولوية 2: winget
    if (-not $installed) {
        Invoke-WithRetry -MaxAttempts 2 -DelaySeconds 10 -Description "تثبيت PostgreSQL عبر winget" -Action {
            $overrideArgs = "--mode unattended --unattendedmodeui minimal --superpassword $PG_PASS --servicename postgresql --servicepassword $PG_PASS --serverport 5432 --enable-components server"
            winget install -e --id PostgreSQL.PostgreSQL.18 --accept-package-agreements --accept-source-agreements --override $overrideArgs
            Start-Sleep -Seconds 3
            $pgBin = Find-PgBin
            if (-not (Test-PgWorks $pgBin)) { throw "الملفات التنفيذية غير موجودة بعد winget" }
        } | Out-Null
        $pgBin = Find-PgBin
        if (Test-PgWorks $pgBin) { $installed = $true }
    }

    # أولوية 3: تحميل مباشر من EnterpriseDB
    if (-not $installed) {
        Warn "winget فشل — جاري التحميل المباشر من EnterpriseDB"
        $installerUrl  = "https://get.enterprisedb.com/postgresql/postgresql-18.0-1-windows-x64.exe"
        $installerPath = Join-Path $env:TEMP "postgresql-18-installer.exe"

        $downloadOk = Invoke-WithRetry -MaxAttempts 3 -DelaySeconds 15 -Description "تحميل مثبّت PostgreSQL" -Action {
            if (Test-Path $installerPath) { Remove-Item $installerPath -Force -ErrorAction SilentlyContinue }
            Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
            if ((Get-Item $installerPath).Length -lt 100MB) { throw "حجم الملف صغير جداً — التحميل غير مكتمل" }
        }
        if ($downloadOk) {
            Start-Process -FilePath $installerPath -ArgumentList $pgExeArgs -Wait -NoNewWindow
            Start-Sleep -Seconds 5
            $pgBin = Find-PgBin
            if (Test-PgWorks $pgBin) { $installed = $true }
        }
    }

    if (-not $installed) {
        Err "فشل تثبيت PostgreSQL بكل الطرق المتاحة"
        Write-Host ""
        Write-Host " الحل: نصّب PostgreSQL 18 يدوياً من https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
        Write-Host " (استخدم كلمة سر: $PG_PASS عند الطلب) ثم أعد تشغيل install.bat" -ForegroundColor Yellow
        Pause-Exit
        exit 1
    }
    Ok "تم تثبيت PostgreSQL"
} else {
    Ok "PostgreSQL موجود مسبقاً: $pgBin"
}

$env:Path += ";$pgBin"

# ═══════════════════════════════════════════════════════════════════════════
# [3/6] الاتصال بـ PostgreSQL
# ═══════════════════════════════════════════════════════════════════════════
Step "[3/6] الاتصال بـ PostgreSQL"

Get-Service | Where-Object { $_.Name -like "*postgres*" } | ForEach-Object {
    if ($_.Status -ne "Running") { try { Start-Service $_.Name -ErrorAction SilentlyContinue } catch {} }
}

function Test-PgConnect($password) {
    $env:PGPASSWORD = $password
    & "$pgBin\psql.exe" -U postgres -c "SELECT 1;" 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

$pgPassword = $null
for ($i = 1; $i -le 15; $i++) {
    foreach ($candidate in @($PG_PASS, "postgres", "")) {
        if (Test-PgConnect $candidate) { $pgPassword = $candidate; break }
    }
    if ($null -ne $pgPassword) { break }
    Write-Host "  [*] انتظار PostgreSQL... ($i/15)"
    Start-Sleep -Seconds 3
}
if ($null -eq $pgPassword) {
    Err "تعذّر الاتصال بـ PostgreSQL — تحقق من services.msc إن خدمة postgresql شغّالة، ثم أعد تشغيل install.bat"
    Pause-Exit
    exit 1
}
Ok "متصل بـ PostgreSQL (كلمة سر postgres: $pgPassword)"

# ═══════════════════════════════════════════════════════════════════════════
# [4/6] إنشاء قاعدة البيانات + ملف .env
# ═══════════════════════════════════════════════════════════════════════════
Step "[4/6] إعداد قاعدة البيانات"

$env:PGPASSWORD = $pgPassword
& "$pgBin\psql.exe" -U postgres -c "CREATE DATABASE $DB_NAME;" 2>&1 | Out-Null
Ok "قاعدة البيانات '$DB_NAME' جاهزة"

$envFile = Join-Path $BACKEND ".env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $BACKEND ".env.example") $envFile
    (Get-Content $envFile) `
        -replace '^DB_PASSWORD=.*', "DB_PASSWORD=$pgPassword" `
        -replace '^DB_DATABASE=.*', "DB_DATABASE=$DB_NAME" |
        Set-Content $envFile -Encoding UTF8
    Ok "تم إنشاء .env تلقائياً ببيانات قاعدة البيانات"
} else {
    Ok ".env موجود مسبقاً — لم يتم استبداله"
}

# ═══════════════════════════════════════════════════════════════════════════
# [5/6] مكتبات PHP + الـ migrations
# ═══════════════════════════════════════════════════════════════════════════
Step "[5/6] تثبيت مكتبات PHP (composer)"
Set-Location $BACKEND
& $PHP composer.phar install --no-dev --optimize-autoloader --no-interaction
if ($LASTEXITCODE -ne 0) {
    Err "فشل composer install"
    Pause-Exit
    exit 1
}
Ok "مكتبات PHP جاهزة"

& $PHP artisan key:generate --force
& $PHP artisan migrate --seed --force
if ($LASTEXITCODE -ne 0) {
    Err "فشل تطبيق الـ migrations"
    Pause-Exit
    exit 1
}
Ok "قاعدة البيانات محدّثة"

# ═══════════════════════════════════════════════════════════════════════════
# [6/6] تجهيز مجلد storage
# ═══════════════════════════════════════════════════════════════════════════
Step "[6/6] لمسة أخيرة"
& $PHP artisan storage:link 2>&1 | Out-Null
Ok "تم"

Log "Installation complete"
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  تم التثبيت بنجاح!" -ForegroundColor Green
Write-Host "  شغّل start.bat لبدء تشغيل النظام" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Pause-Exit
