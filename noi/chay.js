// DIEM KHOI DONG cua bo nao.
//
// Day la CHO DUY NHAT doc bien moi truong va ghep cac manh lai:
//   bo may tra loi (packages/brain) + dich vu license (license/) + cong toi server khach
//   (noi/cong-server-khach) + may chu nhan tin (noi/may-chu) + tri nho hoi thoai.
//
// Mot Xeon phuc vu NHIEU nha ban hang. Shop nao duoc phuc vu, landing cua no o dau, di bang ve
// nao — tat ca doc tu SO LICENSE (anh Dung chot 14/09/2026). Them mot khach = cap mot key tren
// trang quan tri, khong sua ma, khong sua bien moi truong.
//
// Bien moi truong:
//   PORT                   cong nghe (mac dinh 4200)
//   XEON_THU_MUC_DU_LIEU   thu muc giu so license + khoa ky (mac dinh bo-nao/du-lieu)
//   XEON_DIA_CHI           dia chi cong khai cua Xeon, tra cho landing luc dang ky (vd https://xeon.toprun.vn)
//   XEON_ADMIN_MAT_KHAU    mat khau trang quan tri /quan-tri (tu 12 ky tu; thieu = trang tat)
//   XEON_BI_MAT_PHIEN      bi mat ky cookie phien admin (khong co thi sinh moi lan khoi dong)
//   XEON_HTTPS=1           cookie phien mang co Secure (khi Xeon dung sau HTTPS)
//   TIN_PROXY=1            tin IP trong tieu de (khi co nginx/Cloudflare dung truoc)
//   MA_NHAN_TIN            (CU, chi de chay thu) ma chung cho moi shop; kem SHOP_JSON
//   SHOP_JSON              (CU, chi de chay thu) {"toprun":{"diaChi":"http://...","ma":"...","nganh":"giay-chay"}}

"use strict";

const path = require("path");
const { loadPack, handleTurn, redactPII } = require("@sp/brain");
const { taoCongServerKhach } = require("./cong-server-khach");
const { taoMayChu } = require("./may-chu");
const { taoQuanTri } = require("./quan-tri");
const { triNhoTrongBoNho } = require("./tri-nho");

/** Xin ve dich vu cua shop, giu lai toi khi con 5 phut la xin ve moi. */
function maTuVeDichVu(license, shop, gio) {
  let hienTai = null;
  return () => {
    const t = gio.now().getTime();
    if (!hienTai || hienTai.hetLuc - t < 5 * 60 * 1000) hienTai = license.veDichVu(shop);
    return hienTai.ve;
  };
}

/**
 * @param license   dich vu license (ban that). Co no thi `cacShop` bi bo qua.
 * @param cacShop   (CU, chay thu) { [tenant]: { diaChi, ma, nganh } }
 */
function dungBoNao({ license = null, cacShop = {}, triNho = triNhoTrongBoNho(), goi, nhatKy, dongHo } = {}) {
  const ky = nhatKy ?? { tin: (...d) => console.log(...d), canhBao: (...d) => console.warn(...d) };
  const gio = dongHo ?? { now: () => new Date() };

  const shop = new Map();

  if (!license) {
    for (const [tenant, c] of Object.entries(cacShop)) {
      if (!c?.diaChi) throw new Error(`Shop "${tenant}" thiếu địa chỉ server.`);
      shop.set(tenant, {
        cong: taoCongServerKhach({ diaChi: c.diaChi, ma: c.ma, goi, nhatKy: ky }),
        pack: loadPack(c.nganh || "giay-chay")
      });
    }
  }

  /** Tim (hay dung) cai cong toi landing cua shop. Ban license: soi license moi lan tin den. */
  function caiCuaShop(tenant) {
    if (!license) return shop.get(tenant) ?? null;
    const pv = license.shopDangPhucVu(tenant);
    if (!pv.ok) {
      ky.canhBao(`[bo-nao] khong phuc vu shop "${tenant}": ${pv.viSao}`);
      return null;
    }
    const daCo = shop.get(tenant);
    if (daCo && daCo.diaChi === pv.diaChi && daCo.nganh === pv.nganh) return daCo;
    const cai = {
      diaChi: pv.diaChi, nganh: pv.nganh,
      cong: taoCongServerKhach({ diaChi: pv.diaChi, ma: maTuVeDichVu(license, tenant, gio), goi, nhatKy: ky }),
      pack: loadPack(pv.nganh || "giay-chay")
    };
    shop.set(tenant, cai);
    return cai;
  }

  async function xuLyTin(tin) {
    const tenant = String(tin.tenant || "");
    const cai = caiCuaShop(tenant);
    if (!cai) return { daTraLoi: false, viSao: "khong_phuc_vu_shop" };

    const kq = await handleTurn(cai.pack, {
      tools: cai.cong.tools,
      catalog: cai.cong.catalog,
      memory: triNho,
      clock: gio
    }, {
      tenant,
      // Moi khach tren moi kenh la mot hoi thoai rieng.
      conversationId: String(tin.maHoiThoai || `${tin.kenh || "facebook"}:${tin.nguoi}`),
      text: String(tin.chu || ""),
      imageCount: Number(tin.soAnh || 0),
      at: String(tin.luc || gio.now().toISOString())
    });

    // Bo may co ba loi ra. "handoff" la co y KHONG tra loi: chuyen cho nguoi that con hon
    // noi sai. Van ghi nhat ky de nguoi ban hang biet co viec dang cho.
    if (kq.action === "handoff") {
      ky.tin(`[bo-nao] chuyen nguoi that: ${tenant} / ${tin.nguoi}`);
      return { daTraLoi: false, viSao: "chuyen_nguoi_that", traLoi: kq.reply };
    }

    await cai.cong.guiTinTraLoi({ kenh: tin.kenh, nguoi: tin.nguoi, chu: kq.reply });
    return {
      daTraLoi: true,
      hanhDong: kq.action,
      // Nhat ky KHONG mang nguyen van cau khach — che so dien thoai truoc.
      traLoi: redactPII(kq.reply)
    };
  }

  return { xuLyTin, shop };
}

/** Dung dich vu license tu thu muc du lieu. Tach ra de bai kiem tra va trang quan tri dung chung. */
async function dungLicense({ thuMuc, diaChiXeon, nhatKy, gio }) {
  const { napHoacSinhKhoaKy } = require("../license/khoa-ky");
  const { taoSoLicense } = require("../license/so-license");
  const { taoDichVuLicense } = require("../license/dich-vu");
  const { MODULE_IDS, CORE_MODULE_IDS } = require("@sp/contract");
  const khoaKy = napHoacSinhKhoaKy(thuMuc);
  if (khoaKy.moiSinh) nhatKy.tin(`[license] sinh khoa ky moi ${khoaKy.keyId} o ${thuMuc}`);
  const so = await taoSoLicense({ thuMuc, nhatKy });
  return taoDichVuLicense({ so, khoaKy, gio, nhatKy, diaChiXeon, manhHopLe: MODULE_IDS, manhLoi: CORE_MODULE_IDS });
}

/** Danh sach manh de ve checkbox tren trang quan tri: id, ten nguoi doc, co phai manh loi. */
function danhSachManhDeVe() {
  const { MODULES, MODULE_IDS } = require("@sp/contract");
  return MODULE_IDS.map((id) => ({ id, ten: MODULES[id].name, loi: !!MODULES[id].core }));
}

if (require.main === module) {
  const cong = Number(process.env.PORT || 4200);
  const nhatKy = { tin: (...d) => console.log(...d), canhBao: (...d) => console.warn(...d) };
  const gio = { bayGio: () => new Date() };
  const thuMuc = String(process.env.XEON_THU_MUC_DU_LIEU || "").trim() || path.join(__dirname, "..", "du-lieu");
  const diaChiXeon = String(process.env.XEON_DIA_CHI || "").trim();
  if (!diaChiXeon) nhatKy.canhBao("[bo-nao] CHUA co XEON_DIA_CHI — landing dang ky se khong biet goi ve dau.");

  dungLicense({ thuMuc, diaChiXeon, nhatKy, gio }).then((license) => {
    const cacShopCu = JSON.parse(process.env.SHOP_JSON || "{}");
    const dungMaChung = Object.keys(cacShopCu).length > 0;
    if (dungMaChung) nhatKy.canhBao("[bo-nao] SHOP_JSON dang bat — che do CU, chi de chay thu. Ban that: cap key tren trang quan tri.");

    const { xuLyTin } = dungBoNao(dungMaChung ? { cacShop: cacShopCu, nhatKy } : { license, nhatKy });
    const quanTri = taoQuanTri({
      license, gio, nhatKy,
      matKhauAdmin: String(process.env.XEON_ADMIN_MAT_KHAU || ""),
      biMatPhien: String(process.env.XEON_BI_MAT_PHIEN || ""),
      https: String(process.env.XEON_HTTPS || "").trim() === "1",
      danhSachManh: danhSachManhDeVe()
    });
    taoMayChu({
      xuLyTin, license, nhatKy, gio, quanTri,
      maNhan: dungMaChung ? String(process.env.MA_NHAN_TIN || "").trim() : "",
      tinProxy: String(process.env.TIN_PROXY || "").trim() === "1"
    }).listen(cong, () => {
      console.log(`[bo-nao] nghe o cong ${cong}, ${license.soShop()} shop co key, khoa ky ${license.khoaCong().keyId}`);
    });
  }).catch((e) => {
    console.error("[bo-nao] khong khoi dong duoc:", e.message);
    process.exitCode = 1;
  });
}

module.exports = { dungBoNao, dungLicense, maTuVeDichVu, danhSachManhDeVe };
