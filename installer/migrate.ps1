$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ROOT    = Split-Path -Parent $PSScriptRoot
$BACKEND = Join-Path $ROOT "backend"
$PHP     = Join-Path $ROOT "php83\php.exe"
$BACKUPS = Join-Path $BACKEND "storage\app\backups"

function Pause-Exit([string]$msg = "اضغط Enter للإغلاق") {
    try { Read-Host $msg | Out-Null } catch { Start-Sleep -Seconds 3 }
}

Write-Host ""
Write-Host "============================================"
Write-Host "  تحديث قاعدة البيانات"
Write-Host "============================================"
Write-Host ""

if (-not (Test-Path $PHP)) {
    Write-Host "[ERROR] ما لقيت php83\php.exe — شغّل هالملف من داخل مجلد النظام" -ForegroundColor Red
    Pause-Exit
    exit 1
}

Set-Location $BACKEND

# 1) شو اللي رح ينطبق — قبل ما نلمس إشي
Write-Host "=== [1/4] شو رح ينطبق ===" -ForegroundColor Cyan
$pending = & $PHP artisan migrate:status --pending 2>&1 | Out-String

if ($LASTEXITCODE -ne 0) {
    Write-Host $pending
    Write-Host "[ERROR] ما قدرنا نقرا حالة قاعدة البيانات. تأكد إنه PostgreSQL شغّال." -ForegroundColor Red
    Pause-Exit
    exit 1
}

# artisan بترجّع exit code صفر بالحالتين، وكلمة "pending" موجودة بجملة
# "No pending migrations." كمان — فالتمييز بيصير بهالجملة بالذات، مش بالكلمة.
if ($pending -match "No pending migrations") {
    Write-Host "[OK] قاعدة البيانات محدّثة أصلاً — ما في إشي ينطبق." -ForegroundColor Green
    Write-Host ""
    Pause-Exit
    exit 0
}

Write-Host $pending

Write-Host "[!] هاي التعديلات بتتطبق على بيانات العيادة الحقيقية." -ForegroundColor Yellow
Write-Host "    تأكد إنه النظام موقّف (سكّر نوافذ Backend/Frontend) قبل ما تكمّل." -ForegroundColor Yellow
Write-Host ""
$answer = Read-Host "اكتب: نعم — للمتابعة، أو أي إشي تاني للإلغاء"

if ($answer -ne "نعم") {
    Write-Host ""
    Write-Host "[OK] انلغى. ما انلمست ولا بيانة." -ForegroundColor Green
    Pause-Exit
    exit 0
}

# 2) نسخة احتياطية — وإذا فشلت ما بنكمّل
# التعديلات اللي بتصلّح بيانات قديمة ما إلها رجعة، فلازم يكون في نقطة رجوع.
Write-Host ""
Write-Host "=== [2/4] نسخة احتياطية قبل التعديل ===" -ForegroundColor Cyan

$before = @(Get-ChildItem $BACKUPS -Filter *.dump -ErrorAction SilentlyContinue).Count
& $PHP artisan backup:create
$after = @(Get-ChildItem $BACKUPS -Filter *.dump -ErrorAction SilentlyContinue).Count

if ($after -le $before) {
    Write-Host ""
    Write-Host "[ERROR] ما انأخذت نسخة احتياطية — وقّفنا قبل ما نلمس أي بيانات." -ForegroundColor Red
    Write-Host "        القاعدة زي ما هي. جرّب تاخد نسخة من صفحة النسخ الاحتياطي أول." -ForegroundColor Yellow
    Pause-Exit
    exit 1
}

$latest = Get-ChildItem $BACKUPS -Filter *.dump | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host "[OK] النسخة: $($latest.Name)" -ForegroundColor Green

# 3) التطبيق
Write-Host ""
Write-Host "=== [3/4] تطبيق التعديلات ===" -ForegroundColor Cyan
& $PHP artisan migrate --force

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] فشل تحديث قاعدة البيانات." -ForegroundColor Red
    Write-Host "        في نسخة احتياطية انأخذت قبل شوي: $($latest.Name)" -ForegroundColor Yellow
    Write-Host "        فيك ترجعلها من صفحة النسخ الاحتياطي بالنظام." -ForegroundColor Yellow
    Pause-Exit
    exit 1
}

# 4) تأكيد إنه ما ضل إشي معلّق
Write-Host ""
Write-Host "=== [4/4] تأكيد ===" -ForegroundColor Cyan
$stillPending = & $PHP artisan migrate:status --pending 2>&1 | Out-String

if ($stillPending -notmatch "No pending migrations") {
    Write-Host $stillPending
    Write-Host "[!] لسا في تعديلات ما انطبقت — شغّل الملف كمان مرة." -ForegroundColor Yellow
    Pause-Exit
    exit 1
}

Write-Host "[OK] ما ضل إشي معلّق." -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  تم تحديث قاعدة البيانات بنجاح!" -ForegroundColor Green
Write-Host "  شغّل start.bat لتشغيل النظام" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Pause-Exit
# صريح، عشان migrate.bat ترجّع صفر عند النجاح مهما صار بآخر سطر.
exit 0
