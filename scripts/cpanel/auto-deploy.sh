#!/bin/bash
# Tự deploy khi có commit mới trên origin/main — chạy bằng cPanel Cron Jobs.
# Cron ví dụ (mỗi 3 phút):
#   */3 * * * * /bin/bash /home/nhtopzxi/repositories/brain/scripts/cpanel/auto-deploy.sh >> /home/nhtopzxi/brain-logs/cron-stderr.log 2>&1
# Không cần Node env (chỉ dùng git + bash).
set -eo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

LOG_DIR="$HOME/brain-logs"
mkdir -p "$LOG_DIR"
DEPLOY_LOG="$LOG_DIR/auto-deploy.log"
LOCK="$ROOT/tmp/auto-deploy.lock"
MAX_LOG_LINES=200

# ---- Khoá chạy chồng ----
mkdir -p "$ROOT/tmp"
cleanup() { rm -f "$LOCK"; }

if [ -f "$LOCK" ]; then
  lock_pid=$(head -1 "$LOCK" 2>/dev/null || echo "")
  lock_time=$(sed -n '2p' "$LOCK" 2>/dev/null || echo "0")
  now=$(date +%s)
  age=$(( now - ${lock_time:-0} ))
  # Lock quá 10 phút hoặc PID đã chết → xoá lock cũ
  if [ "$age" -lt 600 ] && kill -0 "$lock_pid" 2>/dev/null; then
    exit 0
  fi
  rm -f "$LOCK"
fi
echo "$$" > "$LOCK"
date +%s >> "$LOCK"
trap cleanup EXIT

# ---- Kiểm tra commit mới ----
git fetch origin --quiet 2>/dev/null || {
  echo "$(date '+%F %T') FETCH HỎNG" >> "$DEPLOY_LOG"
  exit 1
}

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

# ---- Có commit mới → merge + build ----
SHORT_OLD=$(git rev-parse --short HEAD)

if ! git merge --ff-only origin/main 2>&1; then
  echo "$(date '+%F %T') MERGE HỎNG ${SHORT_OLD} → $(git rev-parse --short origin/main) — có thay đổi tay trên hosting?" >> "$DEPLOY_LOG"
  exit 1
fi

SHORT_NEW=$(git rev-parse --short HEAD)
echo "$(date '+%F %T') merge ${SHORT_OLD} → ${SHORT_NEW}, bắt đầu build..." >> "$DEPLOY_LOG"

# Gọi đúng build.sh hiện có (cùng logic với nút "Deploy HEAD Commit" trên cPanel)
if bash "$ROOT/scripts/cpanel/build.sh" >> "$DEPLOY_LOG" 2>&1; then
  echo "$(date '+%F %T') BUILD XONG ${SHORT_NEW}" >> "$DEPLOY_LOG"
else
  echo "$(date '+%F %T') BUILD HỎNG ${SHORT_NEW} — xem build-*.log trong ~/brain-logs/" >> "$DEPLOY_LOG"
fi

# ---- Cắt log giữ tối đa MAX_LOG_LINES dòng ----
if [ -f "$DEPLOY_LOG" ]; then
  line_count=$(wc -l < "$DEPLOY_LOG")
  if [ "$line_count" -gt "$MAX_LOG_LINES" ]; then
    tail -n "$MAX_LOG_LINES" "$DEPLOY_LOG" > "$DEPLOY_LOG.tmp"
    mv "$DEPLOY_LOG.tmp" "$DEPLOY_LOG"
  fi
fi
