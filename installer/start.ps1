$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$ROOT     = Split-Path -Parent $PSScriptRoot
$BACKEND  = Join-Path $ROOT "backend"
$PHP      = Join-Path $ROOT "php83\php.exe"
$ROUTER   = Join-Path $PSScriptRoot "spa-router.php"

function Pause-Exit([string]$msg = "اضغط Enter للإغلاق") {
    try { Read-Host $msg | Out-Null } catch { Start-Sleep -Seconds 3 }
}

Write-Host ""
Write-Host "================================================"
Write-Host "  DentaFlow - Starting..."
Write-Host "================================================"

if (-not (Test-Path (Join-Path $ROOT "frontend\dist\index.html"))) {
    Write-Host "[!] الواجهة غير مبنية — تأكد إنك استخدمت نسخة من build.bat" -ForegroundColor Red
    Pause-Exit
    exit 1
}
if (-not (Test-Path $PHP)) {
    Write-Host "[!] php83\php.exe غير موجود" -ForegroundColor Red
    Pause-Exit
    exit 1
}

# ── [1/3] الباك إند بنافذة منفصلة ────────────────────────────────────────
Write-Host "[1/3] Starting backend server (port 8010)..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "title DentaFlow - Backend && cd /d `"$BACKEND`" && `"$PHP`" artisan serve --port=8010"

Write-Host "[*] Waiting for backend..."
$ready = $false
for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:8010/api/branding" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
}
if (-not $ready) {
    Write-Host "[!] الباك إند لم يستجب بعد — تحقق من نافذة DentaFlow - Backend" -ForegroundColor Yellow
}

# ── [2/3] الواجهة (خادم PHP الثابت مع الـ router اللي بيمرّر /api للباك إند) ──
Write-Host "[2/3] Starting frontend server (port 5183)..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "title DentaFlow - Frontend && `"$PHP`" -S 0.0.0.0:5183 `"$ROUTER`""

Start-Sleep -Seconds 2

# ── [3/3] فتح المتصفح ────────────────────────────────────────────────────
Write-Host "[3/3] Opening browser..."
Start-Process "http://localhost:5183"

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  System is running on: http://localhost:5183" -ForegroundColor Green
Write-Host ""
Write-Host "  LAN IP (for other computers in the clinic):"
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    ForEach-Object { Write-Host "    http://$($_.IPAddress):5183" }
Write-Host ""
Write-Host "  Close the 'DentaFlow - Backend' and 'DentaFlow - Frontend'" -ForegroundColor Green
Write-Host "  windows to STOP the system." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Pause-Exit
