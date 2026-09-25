# ket-noi-page.ps1 — Chạy 1 lần để:
#   1. Đăng ký landing cho shop theo license key
#   2. Kết nối Fanpage vào shop đó
#
# Mọi giá trị (key, token Fanpage, địa chỉ) đọc từ bo-nao/.env, mục KET_NOI_* — KHÔNG ghi vào script này.
#   powershell -ExecutionPolicy Bypass -File scripts\ket-noi-page.ps1 [-EnvFile duong\toi\.env]
# Yêu cầu: Xeon phải đang chạy tại KET_NOI_XEON

param([string]$EnvFile = (Join-Path (Split-Path -Parent $PSScriptRoot) ".env"))

$ErrorActionPreference = "Stop"

function Doc-Env([string]$Ten) {
  $dong = Get-Content -LiteralPath $EnvFile -Encoding UTF8 | Where-Object { $_ -match ("^\s*" + [regex]::Escape($Ten) + "\s*=") } | Select-Object -First 1
  if (-not $dong) { return "" }
  return (($dong -split "=", 2)[1]).Trim().Trim('"').Trim("'")
}

if (-not (Test-Path -LiteralPath $EnvFile)) { Write-Host "Khong thay $EnvFile" -ForegroundColor Red; exit 1 }
$XEON        = Doc-Env "KET_NOI_XEON"
$KEY         = Doc-Env "KET_NOI_LICENSE_KEY"
$LANDING_URL = Doc-Env "KET_NOI_LANDING_URL"
$PAGE_ID     = Doc-Env "KET_NOI_PAGE_ID"
$PAGE_NAME   = Doc-Env "KET_NOI_PAGE_NAME"
$PAGE_TOKEN  = Doc-Env "KET_NOI_PAGE_TOKEN"
$thieu = @("KET_NOI_XEON", "KET_NOI_LICENSE_KEY", "KET_NOI_LANDING_URL", "KET_NOI_PAGE_ID", "KET_NOI_PAGE_TOKEN") | Where-Object { -not (Doc-Env $_) }
if ($thieu) { Write-Host "Thieu trong ${EnvFile}: $($thieu -join ', ')" -ForegroundColor Red; exit 1 }

Write-Host "`n=== Ket noi Fanpage vao Xeon ===" -ForegroundColor Cyan

# --- Buoc 0: Kiem tra Xeon ---
Write-Host "`n[0] Kiem tra Xeon tai $XEON ..."
try {
    $health = Invoke-RestMethod -Uri "$XEON/health" -Method GET -TimeoutSec 10
    if ($health.ok) {
        Write-Host "    Xeon SONG — $($health.soShop) shop, luc $($health.luc)" -ForegroundColor Green
    } else {
        Write-Host "    Xeon tra loi nhung ok=false" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "    KHONG GOI DUOC Xeon: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "    Dam bao Xeon dang chay tai $XEON" -ForegroundColor Yellow
    exit 1
}

# --- Buoc 1: Dang ky landing ---
Write-Host "`n[1] Dang ky landing $LANDING_URL cho key $KEY ..."
$bodyDangKy = @{ key = $KEY; diaChi = $LANDING_URL } | ConvertTo-Json -Depth 2
try {
    $resDangKy = Invoke-RestMethod -Uri "$XEON/license/landing-dang-ky" -Method POST `
        -ContentType "application/json; charset=utf-8" -Body $bodyDangKy -TimeoutSec 15
} catch {
    Write-Host "    LOI: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

if (-not $resDangKy.ok) {
    Write-Host "    THAT BAI: $($resDangKy.viSao)" -ForegroundColor Red
    exit 1
}

$inboxToken = $resDangKy.maNhanTin
Write-Host "    THANH CONG!" -ForegroundColor Green
Write-Host "    Shop:        $($resDangKy.shop)"
Write-Host "    Inbox token: $inboxToken"
Write-Host "    Dia chi Xeon: $($resDangKy.diaChiXeon)"

# --- Buoc 2: Ket noi Fanpage ---
Write-Host "`n[2] Ket noi page $PAGE_ID ($PAGE_NAME) vao shop ..."
$bodyTrang = @{
    trang = @(
        @{ ma = $PAGE_ID; ten = $PAGE_NAME; token = $PAGE_TOKEN }
    )
    dangKyNhanTin = $true
} | ConvertTo-Json -Depth 3

try {
    $resTrang = Invoke-RestMethod -Uri "$XEON/meta/trang" -Method POST `
        -ContentType "application/json; charset=utf-8" -Body $bodyTrang `
        -Headers @{ Authorization = "Bearer $inboxToken" } -TimeoutSec 30
} catch {
    Write-Host "    LOI: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

if (-not $resTrang.ok) {
    Write-Host "    THAT BAI: $($resTrang | ConvertTo-Json -Depth 3)" -ForegroundColor Red
    exit 1
}

Write-Host "    KET QUA:" -ForegroundColor Green
foreach ($kq in $resTrang.ketQua) {
    $icon = if ($kq.ok) { "[OK]" } else { "[FAIL]" }
    $color = if ($kq.ok) { "Green" } else { "Red" }
    $detail = if ($kq.ok) {
        "ten=$($kq.ten), dangKyNhanTin=$($kq.daDangKyNhanTin)"
    } else {
        "viSao=$($kq.viSao) $($kq.chiTiet)"
    }
    Write-Host "    $icon Page $($kq.ma): $detail" -ForegroundColor $color
}

# --- Xong ---
Write-Host "`n=== HOAN TAT ===" -ForegroundColor Cyan
Write-Host "Luu y:" -ForegroundColor Yellow
Write-Host "  - Inbox token MOI: $inboxToken"
Write-Host "  - Landing can cap nhat inbox token nay de goi /tin-den ve Xeon"
Write-Host "  - Tu bay gio Meta gui webhook -> Xeon -> landing tai $LANDING_URL"
Write-Host ""
