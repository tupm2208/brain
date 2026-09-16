# ket-noi-page.ps1 — Chạy 1 lần để:
#   1. Đăng ký landing (https://landing.toprun.site) cho shop toprun
#   2. Kết nối Fanpage 649128068789611 vào shop toprun
#
# Yêu cầu: Xeon phải đang chạy tại https://brain.toprun.site

$ErrorActionPreference = "Stop"

$XEON        = "https://brain.toprun.site"
$KEY         = "TR-5WF7-R3FD-2PSL-WZHU"
$LANDING_URL = "https://landing.toprun.site"
$PAGE_ID     = "649128068789611"
$PAGE_NAME   = "TopRun"
$PAGE_TOKEN  = "EAAUCMhzGJoMBSfCE8mZBZAwU1ZCJTmq8oRbiifmXb4qNWrKBOstEGz3UR5uaqPU3Ea7J4GYoZBbW4Ns6qFZCVq7mAhL8FrNCtJqaAnABbixNmcp2NQvZBZBL60PKt50lwkRwcuFyxiQZABn2gQXgRy2UAcsaDZCP70tTBPtyn4F2wkJF8XMIOUoKKb25JWUDGJbMjRoqhxwZDZD"

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
