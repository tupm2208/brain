#!/bin/bash
# Build bộ não (Xeon) trên cPanel KHÔNG cần Terminal.
# .cpanel.yml gọi script này khi bấm Git Version Control -> Manage -> Pull or Deploy -> "Deploy HEAD Commit".
# Làm: npm install (cả devDependencies — cần typescript) -> nối lại gói workspace -> npm run build -> báo khởi động lại.
# Nhật ký: ~/brain-logs/build-<giờ>.log (mở bằng File Manager).
# -E: trap ERR chạy cả trong hàm (vd cpanel_node_env), không thì hỏng trong hàm là thoát câm.
set -Eeo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ -z "${BUILD_LOG:-}" ]; then
  LOG_DIR="$HOME/brain-logs"
  mkdir -p "$LOG_DIR"
  export BUILD_LOG="$LOG_DIR/build-$(date +%Y%m%d-%H%M%S).log"
  # Chạy lại chính script qua đường ống để mọi dòng vào cả nhật ký lẫn log deploy của cPanel.
  # Không dùng `exec > >(tee ...)`: shell bị giam (jailshell) của cPanel không có /dev/fd.
  bash "${BASH_SOURCE[0]}" "$@" 2>&1 | tee -a "$BUILD_LOG"
  exit "${PIPESTATUS[0]}"
fi
trap 'echo "[build] HỎNG ở dòng $LINENO — xem các dòng ngay trên."' ERR

echo "[build] $(date '+%F %T') tại $ROOT"
cd "$ROOT"
# shellcheck source=node-env.sh
source "$ROOT/scripts/cpanel/node-env.sh"
cpanel_node_env "$ROOT"
echo "[build] node $(node -v), npm $(npm -v)"

# Where npm will install — on cPanel `node_modules` is a symlink into the nodevenv; printed so a failed
# deploy log already says it.
echo "[build] node_modules -> $(readlink node_modules || echo 'thư mục thật'), npm prefix: $(npm prefix)"

# Application mode "Production" đặt NODE_ENV=production: npm sẽ bỏ devDependencies và thiếu typescript.
npm install --include=dev --no-audit --no-fund

# Trên cPanel `node_modules` là symlink sang nodevenv. npm nối gói workspace (@sp/contract, @sp/brain,
# @sp/xeon) bằng đường TƯƠNG ĐỐI tính từ app root; nhìn từ thư mục thật trong nodevenv thì đường đó trỏ
# vào chỗ không có -> "Cannot find module @sp/brain". Nối lại bằng đường tuyệt đối, vô hại ở máy thường.
for pkg in "$ROOT"/packages/*/; do
  name="$(node -p "require(process.argv[1]).name" "${pkg}package.json")"
  mkdir -p "node_modules/$(dirname "$name")"
  rm -rf "node_modules/$name"
  ln -s "${pkg%/}" "node_modules/$name"
  echo "[build] nối $name -> ${pkg%/}"
done

# Every third-party dependency must be on disk before tsc runs — otherwise say WHICH one is missing
# here, instead of fifty type errors. (15/09/2026 on cPanel: npm there did not see the workspaces and
# installed only the root's three packages; @anthropic-ai/sdk is now a root dependency as well.)
for dep in @anthropic-ai/sdk typescript @types/node; do
  if [ ! -e "node_modules/$dep/package.json" ] && [ ! -e "packages/xeon/node_modules/$dep/package.json" ]; then
    echo "[build] THIẾU $dep sau npm install — node_modules: $(readlink node_modules || echo 'thư mục thật'), npm prefix: $(npm prefix)"
    exit 1
  fi
done

# A build-info file from another machine (git tracked two until 15/09/2026) makes `tsc --build` think a
# package is already built and skip its .d.ts — every import of it then becomes `any`. Build from scratch.
rm -f packages/*/tsconfig.tsbuildinfo

npm run build
test -f packages/xeon/dist/main.js

# Passenger/LiteSpeed khởi động lại app khi tệp này đổi giờ sửa (nếu không ăn, dùng Run JS script -> tien-trinh:tat).
mkdir -p tmp
touch tmp/restart.txt
echo "[build] XONG $(date '+%F %T') — bấm Restart (hoặc Run JS script -> tien-trinh:tat) để nạp bản mới."
