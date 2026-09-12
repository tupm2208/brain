// MAY CHU CUA BO NAO — nhan tin tu server cua khach, tra loi khach.
//
// Duong di mot tin nhan:
//   Khach nhan Fanpage -> Meta -> hop thu cua server khach (kiem chu ky) -> POST /tin-den
//   -> bo may tra loi (hoi nguoc server khach de lay so lieu that) -> POST /api/hop-thu/gui
//
// MOT MAY CHU PHUC VU NHIEU NHA BAN HANG. Nen moi tin phai mang theo `tenant`, va bo nho
// hoi thoai khoa theo (tenant, hoi thoai). Bo may da tu doi chieu tenant mot lan nua —
// khoa nham la shop B nhan cau tra loi ton kho cua shop A.
//
// BA THU BO NAO KHONG LAM:
//   - Khong luu so dien thoai, dia chi, lich su mua. Tri nho hoi thoai da che truoc khi ghi.
//   - Khong tu goi Meta. Tra loi di qua hop thu cua server khach.
//   - Khong chi tien. Khong cong cu nao mo cho bot mang hieu ung tien.

"use strict";

const http = require("http");
const crypto = require("crypto");

const HAN_THAN = 256 * 1024;

function traLoi(res, ma, than) {
  const chu = JSON.stringify(than ?? null);
  res.writeHead(ma, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store"
  });
  res.end(chu);
}

function bangNhau(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

async function docThan(req) {
  return new Promise((xong, hong) => {
    const manh = [];
    let so = 0;
    req.on("data", (m) => {
      so += m.length;
      if (so > HAN_THAN) { hong(Object.assign(new Error("qua lon"), { quaLon: true })); req.destroy(); return; }
      manh.push(m);
    });
    req.on("end", () => xong(Buffer.concat(manh)));
    req.on("error", hong);
  });
}

/**
 * @param xuLyTin  ({ tenant, kenh, nguoi, chu, maTin, luc }) -> Promise<{ daTraLoi, ... }>
 * @param maNhan   ma server khach phai mang khi goi vao (khac ma bo nao goi ra)
 */
function tayNghe({ xuLyTin, maNhan, nhatKy }) {
  const ky = nhatKy ?? { tin: () => {}, canhBao: () => {} };
  return async function (req, res) {
    if (req.method !== "POST" || !String(req.url || "").startsWith("/tin-den")) {
      return traLoi(res, 404, { ok: false, error: "khong_thay" });
    }
    const mang = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!maNhan || !mang || !bangNhau(mang, maNhan)) {
      return traLoi(res, 401, { ok: false, error: "thieu_ma" });
    }
    let than;
    try {
      const tho = await docThan(req);
      than = JSON.parse(tho.toString("utf8"));
    } catch (e) {
      return traLoi(res, e?.quaLon ? 413 : 400, { ok: false, error: "than_khong_hop_le" });
    }
    if (!than?.tenant || !than?.nguoi || typeof than?.chu !== "string") {
      return traLoi(res, 400, { ok: false, error: "thieu_tenant_nguoi_hoac_chu" });
    }
    try {
      const kq = await xuLyTin(than);
      return traLoi(res, 200, { ok: true, ...kq });
    } catch (e) {
      ky.canhBao(`[bo-nao] xu ly tin hong: ${e?.stack || e}`);
      return traLoi(res, 500, { ok: false, error: "loi_he_thong" });
    }
  };
}

function taoMayChu(tuyChon) {
  return http.createServer(tayNghe(tuyChon));
}

module.exports = { taoMayChu, tayNghe };
