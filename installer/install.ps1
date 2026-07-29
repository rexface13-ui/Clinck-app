$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ROOT    = Split-Path -Parent $PSScriptRoot
$BACKEND = Join-Path $ROOT "backend"
$PHP     = Join-Path $ROOT "php83\php.exe"
$LOG     = Join-Path $PSScriptRoot "install_log.txt"

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

"[$(Get-Date)] Install started" | Out-File -FilePath $LOG -Encoding UTF8

Write-Host ""
Write-Host "============================================"
Write-Host "  DentaFlow - Installation"
Write-Host "============================================"

# ── هذا السكربت يفترض إنك ركّبت PostgreSQL يدوياً مسبقاً (نفس طريقة جهاز
# التطوير) — ما فيه تنزيل/تثبيت أوفلاين تلقائي لـ PostgreSQL هون على عكس
# نظام السبا، لأنه القرار كان نتنصيب متل ما هو موجود عندك حالياً.
Step "[1/5] التحقق من PHP المرفق"
if (-not (Test-Path $PHP)) {
    Err "php83\php.exe غير موجود جوا نسخة التنصيب — تأكد إنك فتحت الـ ZIP كامل"
    Pause-Exit
    exit 1
}
Ok "PHP: $PHP"

Step "[2/5] تثبيت مكتبات PHP (composer)"
Set-Location $BACKEND
& $PHP composer.phar install --no-dev --optimize-autoloader --no-interaction
if ($LASTEXITCODE -ne 0) {
    Err "فشل composer install"
    Pause-Exit
    exit 1
}
Ok "مكتبات PHP جاهزة"

Step "[3/5] إعداد ملف .env"
$envFile = Join-Path $BACKEND ".env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $BACKEND ".env.example") $envFile
    Write-Host ""
    Write-Host "لازم تعبّي بيانات الاتصال بقاعدة البيانات (PostgreSQL) بملف:" -ForegroundColor Yellow
    Write-Host "  $envFile" -ForegroundColor Yellow
    Write-Host "افتحه بالنوتباد، عدّل DB_DATABASE / DB_USERNAME / DB_PASSWORD حسب" -ForegroundColor Yellow
    Write-Host "قاعدة البيانات يلي عملتها، احفظ، وبعدين ارجع اضغط Enter هون." -ForegroundColor Yellow
    Pause-Exit "اضغط Enter بعد ما تعدّل وتحفظ .env"
} else {
    Ok ".env موجود مسبقاً — لم يتم استبداله"
}

& $PHP artisan key:generate --force
Ok "تم توليد APP_KEY"

Step "[4/5] الاتصال بقاعدة البيانات وتطبيق الـ migrations"
& $PHP artisan migrate --seed --force
if ($LASTEXITCODE -ne 0) {
    Err "فشل الاتصال بقاعدة البيانات أو تطبيق الـ migrations"
    Write-Host ""
    Write-Host " تحقق يدوياً:" -ForegroundColor Yellow
    Write-Host "  1. إن قاعدة البيانات المذكورة بـ .env موجودة فعلاً بـ PostgreSQL"
    Write-Host "  2. إن اسم المستخدم/كلمة السر بـ .env صحيحين"
    Write-Host "  3. إن خدمة postgresql شغّالة (services.msc)"
    Write-Host "  ثم شغّل install.bat مرة ثانية"
    Write-Host ""
    Pause-Exit
    exit 1
}
Ok "قاعدة البيانات جاهزة"

Step "[5/5] تجهيز مجلد storage"
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
