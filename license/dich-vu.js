// DICH VU LICENSE — noi quyet dinh "key nay, may nay, co duoc dung khong". Anh Dung chot 14/09/2026.
//
// Nhung gi da chot, moi dong mot bai kiem tra:
//   - Moi key 3 may (mac dinh). Ma may la hash o cung, do OMI tinh; o day chi la mot chuoi.
//   - May thu tu: "da day", kem ten ba may dang ngoi. Chu key vao trang quan ly may de da.
//   - May DAU TIEN nhap key la may truc mac dinh. Chu key doi may truc tren trang quan ly may.
//   - OMI gui { key, maMay } moi lan mo va moi 6 gio; nhan ve VE MAY ky so song 7 gio.
//   - Landing tu dang ky voi Xeon luc cai bang chinh key; nhan khoa cong Xeon + ma nhan tin rieng.
//   - Bo nao chi phuc vu shop co key con han, co manh chatbot, va landing da dang ky.
//
// Key la mot chuoi ngau nhien de go: TR-XXXX-XXXX-XXXX-XXXX, khong co 0/O/1/I. Key KHONG ky so —
// Xeon la noi kiem, ky so chi can cho VE (thu landing phai tu soi ma khong hoi Xeon).

"use strict";

const crypto = require("crypto");
const { kyVe, SONG_VE_MS, SONG_VE_DICH_VU_MS } = require("./ve-may");

const SO_MAY_MAC_DINH = 3;
const BANG_CHU_KEY = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAU_KEY = /^TR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const MAU_SHOP = /^[a-z][a-z0-9-]{1,40}$/;
const MAU_MA_MAY = /^[A-Za-z0-9_-]{8,128}$/;
const MANH_CHATBOT = "chatbot-cskh";

function sinhKey() {
  const b = crypto.randomBytes(16);
  const c = [...b].map((x) => BANG_CHU_KEY[x % BANG_CHU_KEY.length]).join("");
  return `TR-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}-${c.slice(12, 16)}`;
}

function chuanKey(key) {
  return String(key || "").trim().toUpperCase().replace(/\s+/g, "");
}

function bangNhau(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function laDiaChiHopLe(d) {
  try {
    const u = new URL(String(d || ""));
    return (u.protocol === "http:" || u.protocol === "https:") && u.pathname === "/" && !u.search && !u.hash;
  } catch {
    return false;
  }
}

/** Ma ngan cua mot may de goi ten tren man hinh: bam tu ma may, khong doi, khong lo ma may. */
function idMay(maMay) {
  return crypto.createHash("sha256").update(String(maMay), "utf8").digest("base64url").slice(0, 10);
}

/** Ban cua mot may de dua ra man hinh — khong co gi bi mat, nhung van khong in ca ma may. */
function mayGon(m, mayTruc) {
  return {
    id: idMay(m.maMay),
    tenMay: m.tenMay,
    ghepLuc: m.ghepLuc,
    kiemLuc: m.kiemLuc,
    truc: m.maMay === mayTruc
  };
}

/**
 * @param so        so license (`taoSoLicense`)
 * @param khoaKy    { khoaRiengPem, khoaCongPem, keyId }
 * @param gio       { bayGio: () => Date }
 * @param diaChiXeon  dia chi cong khai cua Xeon, tra cho landing luc dang ky de no biet goi ve dau
 * @param manhHopLe   danh sach ma manh duoc phep khai; manhLoi luon bat
 */
function taoDichVuLicense({ so, khoaKy, gio, nhatKy, diaChiXeon = "", manhHopLe = [], manhLoi = [] }) {
  const ky = nhatKy ?? { tin: () => {}, canhBao: () => {} };
  const bayGio = () => gio.bayGio();

  function tim(key) {
    const k = chuanKey(key);
    if (!MAU_KEY.test(k)) return null;
    return so.doc().cacKey[k] ?? null;
  }

  function manhBat(dong) {
    return [...new Set([...manhLoi, ...(dong.manh ?? [])])].sort();
  }

  function trangThaiKey(dong) {
    if (dong.khoaLuc) return "bi_khoa";
    if (Date.parse(dong.hetHan) <= bayGio().getTime()) return "het_han";
    return "dang_dung";
  }

  /** Ban cua mot key de dua ra man hinh quan tri — KHONG mang ma nhan tin. */
  function keyGon(dong) {
    return {
      key: dong.key, shop: dong.shop, tenShop: dong.tenShop, nganh: dong.nganh,
      manh: manhBat(dong), hetHan: dong.hetHan, capLuc: dong.capLuc,
      trangThai: trangThaiKey(dong), khoaLuc: dong.khoaLuc || "", lyDoKhoa: dong.lyDoKhoa || "",
      soMay: dong.soMay, may: (dong.may ?? []).map((m) => mayGon(m, dong.mayTruc)),
      landing: dong.landing ? { diaChi: dong.landing.diaChi, dangKyLuc: dong.landing.dangKyLuc } : null
    };
  }

  function kyVeMay(dong, may) {
    const phatLuc = bayGio().getTime();
    return {
      ve: kyVe({
        vai: "quan-tri", shop: dong.shop, tenShop: dong.tenShop,
        maMay: may.maMay, tenMay: may.tenMay,
        manh: manhBat(dong), truc: dong.mayTruc === may.maMay,
        phatLuc, hetLuc: phatLuc + SONG_VE_MS
      }, khoaKy),
      hetLuc: phatLuc + SONG_VE_MS
    };
  }

  return {
    // ---------- viec cua anh (trang quan tri) ----------

    async capKey({ shop, tenShop, nganh = "giay-chay", manh = [], hetHan, soMay = SO_MAY_MAC_DINH } = {}) {
      const s = String(shop || "").trim().toLowerCase();
      if (!MAU_SHOP.test(s)) throw new Error("Ma shop phai la chu thuong-so-gach noi, 2–41 ky tu, bat dau bang chu.");
      if (typeof tenShop !== "string" || tenShop.trim() === "") throw new Error("Thieu ten shop.");
      if (!Array.isArray(manh)) throw new Error("`manh` phai la mang.");
      for (const m of manh) if (!manhHopLe.includes(m)) throw new Error(`Manh khong co: "${m}".`);
      const han = Date.parse(String(hetHan || ""));
      if (!Number.isFinite(han)) throw new Error("`hetHan` phai la ngay ISO.");
      if (han <= bayGio().getTime()) throw new Error("`hetHan` phai o tuong lai.");
      if (!Number.isInteger(soMay) || soMay < 1 || soMay > 20) throw new Error("`soMay` phai tu 1 den 20.");

      return so.capNhat((st) => {
        for (const d of Object.values(st.cacKey)) {
          if (d.shop === s && !d.khoaLuc) throw new Error(`Shop "${s}" da co key dang dung (${d.key}). Khoa key cu truoc.`);
        }
        let key = sinhKey();
        while (st.cacKey[key]) key = sinhKey();
        st.cacKey[key] = {
          key, shop: s, tenShop: tenShop.trim(), nganh: String(nganh || "giay-chay"),
          manh: [...new Set(manh)].sort(), hetHan: new Date(han).toISOString(), soMay,
          capLuc: bayGio().toISOString(), khoaLuc: "", lyDoKhoa: "",
          may: [], mayTruc: "", landing: null
        };
        ky.tin(`[license] cap key cho shop "${s}"`);
        return { key, shop: s };
      });
    },

    xemKey(key) {
      const d = tim(key);
      return d ? keyGon(d) : null;
    },

    lietKe() {
      return Object.values(so.doc().cacKey)
        .sort((a, b) => String(b.capLuc).localeCompare(String(a.capLuc)))
        .map(keyGon);
    },

    async khoaKey(key, lyDo = "") {
      return so.capNhat((st) => {
        const d = st.cacKey[chuanKey(key)];
        if (!d) return false;
        d.khoaLuc = bayGio().toISOString();
        d.lyDoKhoa = String(lyDo || "");
        ky.tin(`[license] khoa key cua "${d.shop}": ${d.lyDoKhoa || "khong ghi ly do"}`);
        return true;
      });
    },

    async moKey(key) {
      return so.capNhat((st) => {
        const d = st.cacKey[chuanKey(key)];
        if (!d) return false;
        d.khoaLuc = ""; d.lyDoKhoa = "";
        return true;
      });
    },

    async giaHan(key, hetHan) {
      const han = Date.parse(String(hetHan || ""));
      if (!Number.isFinite(han) || han <= bayGio().getTime()) throw new Error("`hetHan` phai la ngay ISO o tuong lai.");
      return so.capNhat((st) => {
        const d = st.cacKey[chuanKey(key)];
        if (!d) return false;
        d.hetHan = new Date(han).toISOString();
        return true;
      });
    },

    async datManh(key, manh) {
      if (!Array.isArray(manh)) throw new Error("`manh` phai la mang.");
      for (const m of manh) if (!manhHopLe.includes(m)) throw new Error(`Manh khong co: "${m}".`);
      return so.capNhat((st) => {
        const d = st.cacKey[chuanKey(key)];
        if (!d) return false;
        d.manh = [...new Set(manh)].sort();
        return true;
      });
    },

    // ---------- viec cua OMI ----------

    /**
     * OMI mo len / moi 6 gio: { key, maMay, tenMay } -> ve may.
     * May chua co trong so thi ghi them neu con cho; day thi tu choi kem ten cac may dang ngoi.
     */
    async kiemMay({ key, maMay, tenMay } = {}) {
      const d = tim(key);
      if (!d) return { ok: false, viSao: "key_khong_co" };
      if (d.khoaLuc) return { ok: false, viSao: "key_bi_khoa", lyDo: d.lyDoKhoa || "" };
      if (trangThaiKey(d) === "het_han") return { ok: false, viSao: "key_het_han", hetHan: d.hetHan };
      const ma = String(maMay || "").trim();
      if (!MAU_MA_MAY.test(ma)) return { ok: false, viSao: "ma_may_sai" };
      const ten = String(tenMay || "").trim().slice(0, 80);

      const kq = await so.capNhat((st) => {
        const dong = st.cacKey[d.key];
        const luc = bayGio().toISOString();
        let may = dong.may.find((m) => m.maMay === ma);
        if (!may) {
          if (dong.may.length >= dong.soMay) {
            return { ok: false, viSao: "da_day", soMay: dong.soMay, may: dong.may.map((m) => mayGon(m, dong.mayTruc)) };
          }
          may = { maMay: ma, tenMay: ten || `may-${dong.may.length + 1}`, ghepLuc: luc, kiemLuc: luc };
          dong.may.push(may);
          if (!dong.mayTruc) dong.mayTruc = ma;        // may dau tien nhap key = may truc mac dinh
          ky.tin(`[license] shop "${dong.shop}": may moi "${may.tenMay}" (${dong.may.length}/${dong.soMay})`);
        } else {
          may.kiemLuc = luc;
          if (ten) may.tenMay = ten;
        }
        return { ok: true, dong, may };
      });
      if (!kq.ok) return kq;

      const { ve, hetLuc } = kyVeMay(kq.dong, kq.may);
      return {
        ok: true, ve, hetLuc,
        shop: kq.dong.shop, tenShop: kq.dong.tenShop, nganh: kq.dong.nganh,
        manh: manhBat(kq.dong), truc: kq.dong.mayTruc === kq.may.maMay,
        diaChiLanding: kq.dong.landing?.diaChi || "",
        hetHan: kq.dong.hetHan
      };
    },

    /** Goi nhe moi 5 phut: may nay co dang truc khong. Khong ghi so, khong cap ve. */
    coTruc({ key, maMay } = {}) {
      const d = tim(key);
      if (!d || d.khoaLuc || trangThaiKey(d) === "het_han") return { ok: false, viSao: "key_khong_dung" };
      const ma = String(maMay || "").trim();
      if (!d.may.some((m) => m.maMay === ma)) return { ok: false, viSao: "may_khong_co" };
      return { ok: true, truc: d.mayTruc === ma };
    },

    // ---------- viec cua chu key (trang quan ly may) ----------

    /** Xem may cua key — cho trang quan ly may. Khong bao gio tra ca ma may. */
    xemMay(key) {
      const d = tim(key);
      if (!d) return null;
      return { shop: d.shop, tenShop: d.tenShop, soMay: d.soMay, trangThai: trangThaiKey(d), may: d.may.map((m) => mayGon(m, d.mayTruc)) };
    },

    /** Da mot may theo `id` (ma ngan hien tren man hinh). */
    async daMay({ key, mayId } = {}) {
      return so.capNhat((st) => {
        const d = st.cacKey[chuanKey(key)];
        if (!d) return { ok: false, viSao: "key_khong_co" };
        const i = d.may.findIndex((m) => idMay(m.maMay) === String(mayId || ""));
        if (i < 0) return { ok: false, viSao: "may_khong_co" };
        const [bo] = d.may.splice(i, 1);
        if (d.mayTruc === bo.maMay) d.mayTruc = d.may[0]?.maMay || "";
        ky.tin(`[license] shop "${d.shop}": da may "${bo.tenMay}"`);
        return { ok: true, may: d.may.map((m) => mayGon(m, d.mayTruc)) };
      });
    },

    /** May tu roi key (nut "Roi may nay" trong OMI): bo chinh no khoi so, tra cho cho may khac. */
    async roiMay({ key, maMay } = {}) {
      return so.capNhat((st) => {
        const d = st.cacKey[chuanKey(key)];
        if (!d) return { ok: false, viSao: "key_khong_co" };
        const ma = String(maMay || "").trim();
        const i = d.may.findIndex((m) => m.maMay === ma);
        if (i < 0) return { ok: false, viSao: "may_khong_co" };
        const [bo] = d.may.splice(i, 1);
        if (d.mayTruc === bo.maMay) d.mayTruc = d.may[0]?.maMay || "";
        ky.tin(`[license] shop "${d.shop}": may "${bo.tenMay}" tu roi key`);
        return { ok: true, conLai: d.may.length };
      });
    },

    async chonMayTruc({ key, mayId } = {}) {
      return so.capNhat((st) => {
        const d = st.cacKey[chuanKey(key)];
        if (!d) return { ok: false, viSao: "key_khong_co" };
        const may = d.may.find((m) => idMay(m.maMay) === String(mayId || ""));
        if (!may) return { ok: false, viSao: "may_khong_co" };
        d.mayTruc = may.maMay;
        return { ok: true, may: d.may.map((m) => mayGon(m, d.mayTruc)) };
      });
    },

    // ---------- viec cua landing ----------

    /**
     * Landing goi MOT lan luc cai (bo cai hoi key). Nhan ve khoa cong Xeon + ma nhan tin rieng.
     * Dang ky lai (cai lai hosting) la ma nhan tin cu chet — chi mot landing song cho moi shop.
     */
    async landingDangKy({ key, diaChi } = {}) {
      const d = tim(key);
      if (!d) return { ok: false, viSao: "key_khong_co" };
      if (d.khoaLuc) return { ok: false, viSao: "key_bi_khoa" };
      if (trangThaiKey(d) === "het_han") return { ok: false, viSao: "key_het_han" };
      const dc = String(diaChi || "").trim().replace(/\/+$/, "");
      if (!laDiaChiHopLe(`${dc}/`)) return { ok: false, viSao: "dia_chi_sai" };

      const maNhanTin = `nt-${crypto.randomBytes(24).toString("base64url")}`;
      await so.capNhat((st) => {
        const dong = st.cacKey[d.key];
        dong.landing = { diaChi: dc, dangKyLuc: bayGio().toISOString(), maNhanTin };
        ky.tin(`[license] shop "${dong.shop}": landing dang ky o ${dc}`);
      });
      return {
        ok: true, shop: d.shop, tenShop: d.tenShop,
        keyId: khoaKy.keyId, khoaCongPem: khoaKy.khoaCongPem,
        maNhanTin, diaChiXeon
      };
    },

    /** Landing goi /tin-den bang ma nhan tin — ma nao la shop nao. Khong doc tenant tu than tin. */
    shopTuMaNhanTin(ma) {
      const m = String(ma || "").trim();
      if (!m) return null;
      for (const d of Object.values(so.doc().cacKey)) {
        if (d.landing?.maNhanTin && bangNhau(m, d.landing.maNhanTin)) return d.shop;
      }
      return null;
    },

    // ---------- viec cua bo nao ----------

    /** Bo nao co phuc vu shop nay khong, va noi chuyen voi landing nao. */
    shopDangPhucVu(shop) {
      const d = Object.values(so.doc().cacKey).find((x) => x.shop === shop && !x.khoaLuc);
      if (!d) return { ok: false, viSao: "khong_co_key" };
      if (trangThaiKey(d) === "het_han") return { ok: false, viSao: "key_het_han" };
      if (!manhBat(d).includes(MANH_CHATBOT)) return { ok: false, viSao: "chua_mua_chatbot" };
      if (!d.landing?.diaChi) return { ok: false, viSao: "landing_chua_dang_ky" };
      return { ok: true, shop: d.shop, diaChi: d.landing.diaChi, nganh: d.nganh, manh: manhBat(d) };
    },

    /** Ve vai `dich-vu` de bo nao goi vao landing. Song 1 gio; nguoi goi tu xin lai khi gan het. */
    veDichVu(shop) {
      const d = Object.values(so.doc().cacKey).find((x) => x.shop === shop && !x.khoaLuc);
      if (!d) throw new Error(`Shop "${shop}" khong co key dang dung.`);
      const phatLuc = bayGio().getTime();
      return {
        ve: kyVe({
          vai: "dich-vu", shop: d.shop, tenShop: d.tenShop, maMay: "xeon", tenMay: "bo-nao",
          manh: manhBat(d), truc: false, phatLuc, hetLuc: phatLuc + SONG_VE_DICH_VU_MS
        }, khoaKy),
        hetLuc: phatLuc + SONG_VE_DICH_VU_MS
      };
    },

    khoaCong: () => ({ keyId: khoaKy.keyId, khoaCongPem: khoaKy.khoaCongPem }),
    soShop: () => Object.values(so.doc().cacKey).filter((d) => !d.khoaLuc).length
  };
}

module.exports = { taoDichVuLicense, sinhKey, chuanKey, idMay, MAU_KEY, SO_MAY_MAC_DINH, MANH_CHATBOT };
