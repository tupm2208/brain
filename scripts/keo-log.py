"""keo-log — kéo nhật ký của một landing về bằng FTP, khi landing CHẾT HẲN.

Làn cứu cuối cùng. Khi tiến trình không khởi động nổi thì không có HTTP nào trả lời và làn đẩy
cũng đã tắt theo, nên hai làn kia đều vô dụng; thứ duy nhất còn lại là tệp trên đĩa hosting.

    python scripts/keo-log.py --env landing_ftp.env --ra logs/keo-ve/<shop>

Dùng `ftplib` của thư viện chuẩn, đúng cách `cong-cu-anh/engine/run_tool.py` đang làm — không thêm
phụ thuộc mới, và khoá vẫn đọc từ cùng bộ biến TOPRUN_LANDING_FTP_* đã có sẵn.

KHÔNG IN MẬT KHẨU ra màn hình, kể cả khi lỗi.
"""

from __future__ import annotations

import argparse
import os
import sys
from ftplib import FTP, FTP_TLS, error_perm
from pathlib import Path

# Tên tệp landing ghi ra (xem server-khach/src/chan-doan/log-sinks.ts).
MAU_TEP = "nhat-ky-"


def doc_env(duong: Path) -> dict[str, str]:
    """Đọc tệp dạng dotenv. Biến đã có trong môi trường thắng."""
    ra: dict[str, str] = {}
    if duong.is_file():
        for dong in duong.read_text(encoding="utf-8").splitlines():
            dong = dong.strip()
            if not dong or dong.startswith("#") or "=" not in dong:
                continue
            ten, _, gia_tri = dong.partition("=")
            ra[ten.strip()] = gia_tri.strip().strip('"').strip("'")
    for ten in list(ra):
        if os.environ.get(ten):
            ra[ten] = os.environ[ten]
    for ten in ("TOPRUN_LANDING_FTP_HOST", "TOPRUN_LANDING_FTP_USER", "TOPRUN_LANDING_FTP_PASS",
                "TOPRUN_LANDING_FTP_DIR", "TOPRUN_LANDING_FTP_PORT", "TOPRUN_LANDING_FTP_TLS"):
        if ten in os.environ:
            ra[ten] = os.environ[ten]
    return ra


def mo_ftp(cau_hinh: dict[str, str]) -> FTP:
    host = cau_hinh.get("TOPRUN_LANDING_FTP_HOST", "").strip()
    user = cau_hinh.get("TOPRUN_LANDING_FTP_USER", "").strip()
    mat_khau = cau_hinh.get("TOPRUN_LANDING_FTP_PASS", "")
    if not host or not user or not mat_khau:
        raise SystemExit(
            "Chua cau hinh FTP: can TOPRUN_LANDING_FTP_HOST/USER/PASS.\n"
            "Chep tu cong-cu-anh/landing_ftp.env.example roi dien."
        )
    cong = int(cau_hinh.get("TOPRUN_LANDING_FTP_PORT", "21") or 21)
    dung_tls = cau_hinh.get("TOPRUN_LANDING_FTP_TLS", "1").strip().lower() not in {"0", "false", "no", "off"}

    if dung_tls:
        ftp: FTP = FTP_TLS()
        ftp.connect(host, cong, timeout=30)
        ftp.login(user, mat_khau)
        ftp.prot_p()  # kenh du lieu cung ma hoa
    else:
        ftp = FTP()
        ftp.connect(host, cong, timeout=30)
        ftp.login(user, mat_khau)
    return ftp


def liet_ke(ftp: FTP, thu_muc: str) -> list[str]:
    try:
        ftp.cwd(thu_muc)
    except error_perm as loi:
        raise SystemExit(f'Khong vao duoc thu muc "{thu_muc}" tren hosting: {loi}') from None
    return sorted(ten for ten in ftp.nlst() if ten.startswith(MAU_TEP) and ten.endswith(".jsonl"))


def main() -> int:
    hoi = argparse.ArgumentParser(description="Keo nhat ky cua mot landing ve bang FTP.")
    hoi.add_argument("--env", default="landing_ftp.env", help="tep cau hinh FTP (mac dinh: landing_ftp.env)")
    hoi.add_argument("--thu-muc", default="", help="thu muc nhat ky tren hosting (mac dinh: <FTP_DIR cha>/landing-logs)")
    hoi.add_argument("--ra", default="logs/keo-ve", help="thu muc luu ve may nay")
    hoi.add_argument("--ngay", type=int, default=3, help="chi lay N tep ngay moi nhat (mac dinh 3)")
    doi_so = hoi.parse_args()

    cau_hinh = doc_env(Path(doi_so.env))
    tu_xa = doi_so.thu_muc or "landing-logs"
    ra = Path(doi_so.ra)
    ra.mkdir(parents=True, exist_ok=True)

    ftp = mo_ftp(cau_hinh)
    try:
        ten_tep = liet_ke(ftp, tu_xa)
        if not ten_tep:
            print(f'Khong thay tep "{MAU_TEP}*.jsonl" nao trong "{tu_xa}".')
            return 1
        # Moi nhat truoc: khi landing vua chet, ngay hom nay la thu dang can.
        chon = ten_tep[-doi_so.ngay:]
        for ten in chon:
            dich = ra / ten
            with dich.open("wb") as tep:
                ftp.retrbinary(f"RETR {ten}", tep.write)
            print(f"  {ten}  ({dich.stat().st_size} byte)")
        print(f"\nDa keo {len(chon)}/{len(ten_tep)} tep ve {ra}")
        return 0
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


if __name__ == "__main__":
    sys.exit(main())
