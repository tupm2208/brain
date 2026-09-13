// HAI TRANG WEB TREN XEON — anh Dung chot 14/09/2026.
//
//   /quan-tri   trang quan tri license: CHI anh vao, mot tai khoan admin (mat khau trong bien
//               moi truong). Cap key, khoa/mo, gia han, doi manh, xem may, da may, chon may truc.
//   /may        trang quan ly may cua CHU KEY: vao bang chinh key. Xem 3 may, da may, chon may
//               truc. Phai nam NGOAI OMI vi may thu tu bi chan thi khong mo duoc OMI de da may khac.
//
// Bao ve:
//   - Mat khau admin so sanh timing-safe; ngan hon 12 ky tu la TAT trang quan tri (fail-closed).
//   - Phien admin la cookie HttpOnly + SameSite=Strict, ky HMAC, song 12 gio.
//   - Moi viec doi du lieu la POST JSON kem tieu de `X-Yeu-Cau: xeon` — trinh duyet khong tu gui
//     duoc tieu de nay tu trang khac, nen khong co CSRF ke ca khi SameSite bi bo qua.
//   - Dang nhap sai bi dem theo dia chi: 10 lan / 15 phut.
//   - Trang /may: key la thu xac thuc; goi don 30 lan / 15 phut moi dia chi.
//   - CSP chat: khong inline script, khong inline style, khong goi ra ngoai.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SONG_PHIEN_MS = 12 * 60 * 60 * 1000;
const COOKIE = "xeon_qt";
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const KIEU = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function bangNhau(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function taoBoDem({ soLan, trongMs, bayGio }) {
  const so = new Map();
  return {
    duoc(khoa) {
      const t = bayGio().getTime();
      const d = (so.get(khoa) ?? []).filter((x) => t - x < trongMs);
      if (d.length >= soLan) { so.set(khoa, d); return false; }
      d.push(t); so.set(khoa, d);
      if (so.size > 10000) so.delete(so.keys().next().value);
      return true;
    }
  };
}

function docCookie(req) {
  const ra = {};
  for (const phan of String(req.headers.cookie || "").split(";")) {
    const i = phan.indexOf("=");
    if (i > 0) ra[phan.slice(0, i).trim()] = phan.slice(i + 1).trim();
  }
  return ra;
}

/**
 * @param license       dich vu license
 * @param matKhauAdmin  mat khau cua anh (XEON_ADMIN_MAT_KHAU); < 12 ky tu = tat trang quan tri
 * @param biMatPhien    bi mat ky cookie phien; khong co thi sinh ngau nhien moi lan khoi dong
 * @param danhSachManh  [{ id, ten, loi }] de ve o checkbox
 * @param https         true thi cookie mang co Secure
 */
function taoQuanTri({ license, matKhauAdmin = "", biMatPhien = "", danhSachManh = [], gio, nhatKy, https = false, thuMucTrang = path.join(__dirname, "trang") }) {
  const ky = nhatKy ?? { tin: () => {}, canhBao: () => {} };
  const bayGio = () => gio.bayGio();
  const adminBat = String(matKhauAdmin || "").length >= 12;
  if (!adminBat) ky.canhBao("[quan-tri] XEON_ADMIN_MAT_KHAU thieu hoac ngan hon 12 ky tu — trang quan tri DANG TAT.");
  const biMat = String(biMatPhien || "") || crypto.randomBytes(32).toString("base64url");

  const demDangNhap = taoBoDem({ soLan: 10, trongMs: 15 * 60 * 1000, bayGio });
  const demMay = taoBoDem({ soLan: 30, trongMs: 15 * 60 * 1000, bayGio });

  // Tep trang doc mot lan luc khoi dong — nho, va khong de ai doc tep khac qua duong nay.
  const trang = new Map();
  for (const ten of ["quan-tri.html", "quan-tri.js", "may.html", "may.js", "chung.css"]) {
    trang.set(ten, fs.readFileSync(path.join(thuMucTrang, ten)));
  }

  function traTep(res, ten) {
    const than = trang.get(ten);
    res.writeHead(200, {
      "Content-Type": KIEU[path.extname(ten)],
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store"
    });
    res.end(than);
  }

  function kyPhien(than) {
    return crypto.createHmac("sha256", biMat).update(than, "utf8").digest("base64url");
  }
  function phatPhien() {
    const t = bayGio().getTime();
    const than = Buffer.from(JSON.stringify({ phatLuc: t, hetLuc: t + SONG_PHIEN_MS }), "utf8").toString("base64url");
    return `${than}.${kyPhien(than)}`;
  }
  function phienHopLe(req) {
    const c = docCookie(req)[COOKIE];
    if (!c) return false;
    const i = c.lastIndexOf(".");
    if (i <= 0) return false;
    const than = c.slice(0, i);
    if (!bangNhau(c.slice(i + 1), kyPhien(than))) return false;
    try {
      const d = JSON.parse(Buffer.from(than, "base64url").toString("utf8"));
      return Number.isFinite(d.hetLuc) && bayGio().getTime() < d.hetLuc;
    } catch { return false; }
  }
  function cookiePhien(gia, hetNgay = false) {
    const phan = [`${COOKIE}=${gia}`, "Path=/quan-tri", "HttpOnly", "SameSite=Strict"];
    if (https) phan.push("Secure");
    if (hetNgay) phan.push("Max-Age=0"); else phan.push(`Max-Age=${Math.floor(SONG_PHIEN_MS / 1000)}`);
    return phan.join("; ");
  }

  /** POST doi du lieu phai co tieu de rieng — chan CSRF. */
  function coTieuDeXeon(req) {
    return String(req.headers["x-yeu-cau"] || "") === "xeon";
  }

  async function xuLyQuanTri(req, res, { docJson, traLoi, duong, method, ip }) {
    if (method === "GET") {
      if (duong === "/quan-tri" || duong === "/quan-tri/") return traTep(res, "quan-tri.html"), true;
      if (duong === "/quan-tri/app.js") return traTep(res, "quan-tri.js"), true;
      if (duong === "/quan-tri/chung.css") return traTep(res, "chung.css"), true;
      if (duong === "/quan-tri/api/toi") return traLoi(res, 200, { ok: true, bat: adminBat, dangNhap: adminBat && phienHopLe(req) }), true;
      if (duong === "/quan-tri/api/manh") return traLoi(res, 200, { ok: true, manh: danhSachManh }), true;
    }
    if (!duong.startsWith("/quan-tri/api/")) return false;
    if (!adminBat) return traLoi(res, 503, { ok: false, error: "quan_tri_dang_tat" }), true;
    if (method !== "POST") return traLoi(res, 404, { ok: false, error: "khong_thay" }), true;
    if (!coTieuDeXeon(req)) return traLoi(res, 403, { ok: false, error: "thieu_tieu_de_xeon" }), true;

    if (duong === "/quan-tri/api/dang-nhap") {
      if (!demDangNhap.duoc(ip)) return traLoi(res, 429, { ok: false, error: "qua_nhieu" }), true;
      const than = await docJson();
      if (!than) return true;
      if (!bangNhau(than.matKhau, matKhauAdmin)) {
        ky.canhBao(`[quan-tri] dang nhap sai tu ${ip}`);
        return traLoi(res, 401, { ok: false, error: "sai_mat_khau" }), true;
      }
      ky.tin(`[quan-tri] admin dang nhap tu ${ip}`);
      return traLoi(res, 200, { ok: true }, { "Set-Cookie": cookiePhien(phatPhien()) }), true;
    }
    if (duong === "/quan-tri/api/dang-xuat") {
      return traLoi(res, 200, { ok: true }, { "Set-Cookie": cookiePhien("", true) }), true;
    }
    if (!phienHopLe(req)) return traLoi(res, 401, { ok: false, error: "chua_dang_nhap" }), true;

    const than = await docJson();
    if (!than) return true;
    try {
      switch (duong) {
        case "/quan-tri/api/key/danh-sach": return traLoi(res, 200, { ok: true, key: license.lietKe() }), true;
        case "/quan-tri/api/key/cap": {
          const kq = await license.capKey({
            shop: than.shop, tenShop: than.tenShop, nganh: than.nganh, manh: than.manh,
            hetHan: than.hetHan, soMay: than.soMay === undefined ? undefined : Number(than.soMay)
          });
          return traLoi(res, 200, { ok: true, ...kq, chiTiet: license.xemKey(kq.key) }), true;
        }
        case "/quan-tri/api/key/khoa": return traLoi(res, 200, { ok: await license.khoaKey(than.key, than.lyDo) }), true;
        case "/quan-tri/api/key/mo": return traLoi(res, 200, { ok: await license.moKey(than.key) }), true;
        case "/quan-tri/api/key/gia-han": return traLoi(res, 200, { ok: await license.giaHan(than.key, than.hetHan) }), true;
        case "/quan-tri/api/key/manh": return traLoi(res, 200, { ok: await license.datManh(than.key, than.manh) }), true;
        case "/quan-tri/api/key/da-may": return traLoi(res, 200, await license.daMay({ key: than.key, mayId: than.mayId })), true;
        case "/quan-tri/api/key/may-truc": return traLoi(res, 200, await license.chonMayTruc({ key: than.key, mayId: than.mayId })), true;
        default: return traLoi(res, 404, { ok: false, error: "khong_thay" }), true;
      }
    } catch (e) {
      return traLoi(res, 400, { ok: false, error: "sai_yeu_cau", message: String(e.message || e) }), true;
    }
  }

  async function xuLyMay(req, res, { docJson, traLoi, duong, method, ip }) {
    if (method === "GET") {
      if (duong === "/may" || duong === "/may/") return traTep(res, "may.html"), true;
      if (duong === "/may/app.js") return traTep(res, "may.js"), true;
      if (duong === "/may/chung.css") return traTep(res, "chung.css"), true;
    }
    if (!duong.startsWith("/may/api/")) return false;
    if (method !== "POST") return traLoi(res, 404, { ok: false, error: "khong_thay" }), true;
    if (!coTieuDeXeon(req)) return traLoi(res, 403, { ok: false, error: "thieu_tieu_de_xeon" }), true;
    if (!demMay.duoc(ip)) return traLoi(res, 429, { ok: false, error: "qua_nhieu" }), true;
    const than = await docJson();
    if (!than) return true;

    const xem = license.xemMay(than.key);
    if (!xem) return traLoi(res, 403, { ok: false, viSao: "key_khong_co" }), true;
    switch (duong) {
      case "/may/api/xem": return traLoi(res, 200, { ok: true, ...xem }), true;
      case "/may/api/da": return traLoi(res, 200, await license.daMay({ key: than.key, mayId: than.mayId })), true;
      case "/may/api/truc": return traLoi(res, 200, await license.chonMayTruc({ key: than.key, mayId: than.mayId })), true;
      default: return traLoi(res, 404, { ok: false, error: "khong_thay" }), true;
    }
  }

  return async function quanTri(req, res, ctx) {
    if (ctx.duong.startsWith("/quan-tri")) return xuLyQuanTri(req, res, ctx);
    if (ctx.duong.startsWith("/may")) return xuLyMay(req, res, ctx);
    return false;
  };
}

module.exports = { taoQuanTri, SONG_PHIEN_MS, COOKIE, CSP };
