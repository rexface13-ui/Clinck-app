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

# php83 وvendor مو جزء من الريبو (كبار وما بتغيّروا) — لو انحذفوا من الشجرة
# البعيدة بالغلط بأي وقت، "git reset --hard" رح يمسحهم من عندك كمان. منحفظ
# نسخة احتياطية قبل الـ reset ونرجّعها لو انمسحت.
$php83Backup = Join-Path $env:TEMP "dentaflow_php83_backup"
$php83Path = Join-Path $ROOT "php83"
if ((Test-Path $php83Path) -and -not (Test-Path $php83Backup)) {
    Copy-Item $php83Path $php83Backup -Recurse -Force
}

git reset --hard origin/main
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] فشل السحب" -ForegroundColor Red
    Pause-Exit
    exit 1
}

if (-not (Test-Path $php83Path) -and (Test-Path $php83Backup)) {
    Write-Host "[!] php83 انمسح مع التحديث — جاري استرجاعه..." -ForegroundColor Yellow
    Copy-Item $php83Backup $php83Path -Recurse -Force
    Write-Host "[OK] تم استرجاع php83" -ForegroundColor Green
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

# قاعدة البيانات ما بتنلمس هون عن قصد. تحديث الكود بيرجع بسحب نسخة قديمة،
# أما تعديل البيانات فما إله رجعة — فصار بملف لحاله (migrate.bat) بيتشغّل
# لما تكون واقف قدام الجهاز ومستعد تشوف النتيجة.
Write-Host ""
Write-Host "=== [3/3] فحص قاعدة البيانات ===" -ForegroundColor Cyan
$pending = & $PHP artisan migrate:status --pending 2>&1 | Out-String
# مش بالـ exit code (بترجع صفر بالحالتين) ولا بكلمة "Pending" لحالها (موجودة
# كمان بجملة "No pending migrations.") — التمييز بالجملة نفسها.
$hasPending = $pending -notmatch "No pending migrations"

Write-Host "[OK] الكود تحدّث. قاعدة البيانات ما انلمست." -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  تم تحديث الكود بنجاح!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green

if ($hasPending) {
    Write-Host ""
    Write-Host "[!] في تحديثات لقاعدة البيانات لسا ما انطبقت:" -ForegroundColor Yellow
    Write-Host $pending
    Write-Host "    شغّل migrate.bat لتطبيقها (بياخد نسخة احتياطية أول)." -ForegroundColor Yellow
    Write-Host "    النظام ممكن ما يشتغل صح قبل ما تطبّقها." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "  ما في تحديثات لقاعدة البيانات — شغّل start.bat." -ForegroundColor Green
}

Write-Host ""
Pause-Exit
