// MAY CHU CUA BO NAO — nhan tin tu server cua khach, tra loi khach, va CAP LICENSE.
//
// Duong di mot tin nhan:
//   Khach nhan Fanpage -> Meta -> hop thu cua server khach (kiem chu ky) -> POST /tin-den
//   -> bo may tra loi (hoi nguoc server khach de lay so lieu that) -> POST /api/hop-thu/gui
//
// MOT MAY CHU PHUC VU NHIEU NHA BAN HANG. Landing goi /tin-den bang MA NHAN TIN RIENG cua shop
// (cap luc landing dang ky); shop la ai suy tu ma, KHONG doc tu than tin — doc tu than tin la
// shop A gui duoc tin mao danh shop B va doc duoc ngu canh hoi thoai cua B.
//
// Cac cua license (anh Dung chot 14/09/2026):
//   POST /license/kiem              OMI mo len / moi 6 gio: { key, maMay, tenMay } -> ve may
//   POST /license/truc              OMI moi 5 phut: { key, maMay } -> { truc }
//   POST /license/landing-dang-ky   bo cai landing: { key, diaChi } -> khoa cong Xeon + ma nhan tin
//   GET  /license/khoa-cong         khoa cong ky cua Xeon
//   GET  /health                    con song khong
//
// BA THU BO NAO KHONG LAM:
//   - Khong luu so dien thoai, dia chi, lich su mua. Tri nho hoi thoai da che truoc khi ghi.
//   - Khong tu goi Meta. Tra loi di qua hop thu cua server khach.
//   - Khong chi tien. Khong cong cu nao mo cho bot mang hieu ung tien.

"use strict";

const http = require("http");
const crypto = require("crypto");

const HAN_THAN = 256 * 1024;
/** Chan goi don vao cua license: mot dia chi 60 lan / 15 phut la du cho moi may thu that. */
const HAN_GOI_LICENSE = { soLan: 60, trongMs: 15 * 60 * 1000 };

function traLoi(res, ma, than, tieuDe = {}) {
  const chu = JSON.stringify(than ?? null);
  res.writeHead(ma, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    ...tieuDe
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

async function docJson(req, res) {
  try {
    const tho = await docThan(req);
    const than = tho.length === 0 ? {} : JSON.parse(tho.toString("utf8"));
    if (!than || typeof than !== "object" || Array.isArray(than)) throw new Error("khong phai doi tuong");
    return than;
  } catch (e) {
    traLoi(res, e?.quaLon ? 413 : 400, { ok: false, error: "than_khong_hop_le" });
    return null;
  }
}

function maBearer(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

/** Bo dem goi don trong bo nho, theo dia chi. Du cho mot Xeon; khong can Redis. */
function taoBoDemGoi({ soLan, trongMs, bayGio }) {
  const so = new Map();
  return {
    duoc(khoa) {
      const t = bayGio().getTime();
      const d = so.get(khoa) ?? [];
      const conSong = d.filter((x) => t - x < trongMs);
      if (conSong.length >= soLan) { so.set(khoa, conSong); return false; }
      conSong.push(t);
      so.set(khoa, conSong);
      if (so.size > 10000) so.delete(so.keys().next().value);
      return true;
    }
  };
}

function ipCua(req, tinProxy) {
  if (tinProxy) {
    const x = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (x) return x;
  }
  return String(req.socket?.remoteAddress || "");
}

/**
 * @param xuLyTin   ({ tenant, kenh, nguoi, chu, maTin, luc }) -> Promise<{ daTraLoi, ... }>
 * @param license   dich vu license (tuy chon — khong co thi cac cua /license tra 503)
 * @param maNhan    (CU, chi de chay thu) mot ma chung cho moi shop; tenant doc tu than tin
 * @param quanTri   (dot L2) ham xu ly cac cua /quan-tri va /may; nhan (req, res, { docJson }) tra true neu da xu ly
 */
function tayNghe({ xuLyTin, license = null, maNhan = "", nhatKy, gio, tinProxy = false, quanTri = null }) {
  const ky = nhatKy ?? { tin: () => {}, canhBao: () => {} };
  const bayGio = gio?.bayGio ?? (() => new Date());
  const hanGoi = taoBoDemGoi({ ...HAN_GOI_LICENSE, bayGio });
  if (maNhan) ky.canhBao("[bo-nao] MA_NHAN_TIN dung chung dang bat — chi de chay thu; ban that dung ma nhan tin rieng tung shop.");

  return async function (req, res) {
    const duong = String(req.url || "").split("?")[0];
    const method = req.method || "GET";

    if (method === "GET" && duong === "/health") {
      return traLoi(res, 200, { ok: true, license: !!license, soShop: license ? license.soShop() : 0, luc: bayGio().toISOString() });
    }

    if (duong.startsWith("/license/")) {
      if (!license) return traLoi(res, 503, { ok: false, error: "license_chua_bat" });
      if (!hanGoi.duoc(ipCua(req, tinProxy))) return traLoi(res, 429, { ok: false, error: "qua_nhieu" });

      if (method === "GET" && duong === "/license/khoa-cong") return traLoi(res, 200, { ok: true, ...license.khoaCong() });
      if (method !== "POST") return traLoi(res, 404, { ok: false, error: "khong_thay" });
      const than = await docJson(req, res);
      if (!than) return undefined;

      try {
        if (duong === "/license/kiem") {
          const kq = await license.kiemMay({ key: than.key, maMay: than.maMay, tenMay: than.tenMay });
          return traLoi(res, kq.ok ? 200 : 403, kq);
        }
        if (duong === "/license/truc") {
          const kq = license.coTruc({ key: than.key, maMay: than.maMay });
          return traLoi(res, kq.ok ? 200 : 403, kq);
        }
        if (duong === "/license/roi") {
          const kq = await license.roiMay({ key: than.key, maMay: than.maMay });
          return traLoi(res, kq.ok ? 200 : 403, kq);
        }
        if (duong === "/license/landing-dang-ky") {
          const kq = await license.landingDangKy({ key: than.key, diaChi: than.diaChi });
          return traLoi(res, kq.ok ? 200 : 403, kq);
        }
      } catch (e) {
        ky.canhBao(`[bo-nao] license ${duong} hong: ${e?.stack || e}`);
        return traLoi(res, 500, { ok: false, error: "loi_he_thong" });
      }
      return traLoi(res, 404, { ok: false, error: "khong_thay" });
    }

    if (quanTri && (duong.startsWith("/quan-tri") || duong.startsWith("/may"))) {
      const daXuLy = await quanTri(req, res, { docJson: () => docJson(req, res), traLoi, duong, method, ip: ipCua(req, tinProxy) });
      if (daXuLy) return undefined;
    }

    if (method === "POST" && duong === "/tin-den") {
      const ma = maBearer(req);
      if (!ma) return traLoi(res, 401, { ok: false, error: "thieu_ma" });

      // Shop la ai: suy tu ma nhan tin rieng. Ma chung (cu) chi de chay thu.
      let tenant = license ? license.shopTuMaNhanTin(ma) : null;
      let bangMaChung = false;
      if (!tenant && maNhan && bangNhau(ma, maNhan)) bangMaChung = true;
      if (!tenant && !bangMaChung) return traLoi(res, 401, { ok: false, error: "thieu_ma" });

      const than = await docJson(req, res);
      if (!than) return undefined;
      if (bangMaChung) tenant = String(than.tenant || "");
      else if (than.tenant && String(than.tenant) !== tenant) {
        ky.canhBao(`[bo-nao] landing cua "${tenant}" gui tin ghi tenant "${than.tenant}" — bo tin`);
        return traLoi(res, 403, { ok: false, error: "tenant_khong_khop" });
      }
      if (!tenant || !than.nguoi || typeof than.chu !== "string") {
        return traLoi(res, 400, { ok: false, error: "thieu_tenant_nguoi_hoac_chu" });
      }
      try {
        const kq = await xuLyTin({ ...than, tenant });
        return traLoi(res, 200, { ok: true, ...kq });
      } catch (e) {
        ky.canhBao(`[bo-nao] xu ly tin hong: ${e?.stack || e}`);
        return traLoi(res, 500, { ok: false, error: "loi_he_thong" });
      }
    }

    return traLoi(res, 404, { ok: false, error: "khong_thay" });
  };
}

function taoMayChu(tuyChon) {
  return http.createServer(tayNghe(tuyChon));
}

module.exports = { taoMayChu, tayNghe, docJson, traLoi, HAN_GOI_LICENSE };
