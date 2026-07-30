$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ROOT    = Split-Path -Parent $PSScriptRoot
$BACKEND = Join-Path $ROOT "backend"
$PHP     = Join-Path $ROOT "php83\php.exe"
$ENVFILE = Join-Path $BACKEND ".env"

function Pause-Exit([string]$msg = "اضغط Enter للإغلاق") {
    try { Read-Host $msg | Out-Null } catch { Start-Sleep -Seconds 3 }
}

function Read-EnvValue([string]$key) {
    if (-not (Test-Path $ENVFILE)) { return $null }
    $line = Get-Content $ENVFILE | Where-Object { $_ -match "^$key=" } | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line -replace "^$key=", "").Trim('"')
}

Write-Host ""
Write-Host "============================================"
Write-Host "  تحديث النظام من GitHub"
Write-Host "============================================"
Write-Host ""

# التوكن ورابط الريبو يُقرأان من backend\.env (GITHUB_UPDATE_TOKEN /
# GITHUB_UPDATE_REPO) بدل ما يكونوا مكتوبين مباشرة بهالسكربت — هيك ما
# بتنكشف بيانات الدخول لو حدا فتح ملفات التنصيب بالغلط.
$token = Read-EnvValue "GITHUB_UPDATE_TOKEN"
$repo  = Read-EnvValue "GITHUB_UPDATE_REPO"
if (-not $token -or -not $repo) {
    Write-Host "[ERROR] GITHUB_UPDATE_TOKEN و/أو GITHUB_UPDATE_REPO مو معبّيين بـ backend\.env" -ForegroundColor Red
    Write-Host "        ضيفهم متل: GITHUB_UPDATE_REPO=github.com/OWNER/REPO.git" -ForegroundColor Yellow
    Pause-Exit
    exit 1
}
$repoUrl = "https://$token@$repo"

Write-Host "[!] تأكد من إيقاف النظام (سكّر نوافذ Backend/Frontend) قبل التحديث" -ForegroundColor Yellow
Pause-Exit "اضغط Enter للمتابعة"

Write-Host ""
Write-Host "=== [1/3] سحب آخر نسخة من GitHub ===" -ForegroundColor Cyan
Set-Location $ROOT

# النسخة المنزّلة (ZIP) ما فيها مجلد .git أصلاً (تمّ حذفه قصداً قبل الرفع
# حتى ما ينكشف التوكن) — أول تحديث بيبلّش الريبو محلياً من الصفر بدل ما
# يفترض وجوده، وإلا git remote/fetch بتفشل بصمت وما كان في نسخة كاملة.
if (-not (Test-Path (Join-Path $ROOT ".git"))) {
    Write-Host "[*] أول تحديث — تجهيز git محلياً..." -ForegroundColor Yellow
    git init -q
    git remote add origin $repoUrl
} else {
    git remote set-url origin $repoUrl 2>&1 | Out-Null
}

git fetch origin
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] فشل الاتصال بـ GitHub — تحقق من الإنترنت والتوكن" -ForegroundColor Red
    Pause-Exit
    exit 1
}
git reset --hard origin/main
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] فشل السحب" -ForegroundColor Red
    Pause-Exit
    exit 1
}
Write-Host "[OK] تم جلب أحدث كود" -ForegroundColor Green

Write-Host ""
Write-Host "=== [2/3] تحديث مكتبات PHP ===" -ForegroundColor Cyan
Set-Location $BACKEND
& $PHP (Join-Path $ROOT "composer.phar") install --no-dev --optimize-autoloader --no-interaction
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] فشل composer install" -ForegroundColor Red
    Pause-Exit
    exit 1
}
Write-Host "[OK] تم" -ForegroundColor Green

Write-Host ""
Write-Host "=== [3/3] تحديث قاعدة البيانات ===" -ForegroundColor Cyan
& $PHP artisan migrate --force
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] فشل تحديث قاعدة البيانات" -ForegroundColor Red
    Pause-Exit
    exit 1
}
Write-Host "[OK] تم" -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  تم التحديث بنجاح!" -ForegroundColor Green
Write-Host "  شغّل start.bat لتشغيل النظام" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Pause-Exit
