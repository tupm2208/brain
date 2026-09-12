// DIEM KHOI DONG cua bo nao.
//
// Day la CHO DUY NHAT doc bien moi truong va ghep cac manh lai:
//   bo may tra loi (packages/brain) + cong toi server khach (noi/cong-server-khach)
//   + may chu nhan tin (noi/may-chu) + tri nho hoi thoai.
//
// Mot Xeon phuc vu NHIEU nha ban hang: moi shop mot dong trong `SHOP`, moi dong co dia chi
// server rieng, ma rieng, va bo luat nganh rieng. Them mot khach = them mot dong cau hinh,
// khong sua ma — dung luat "khong nhanh rieng cho tung khach".

"use strict";

const { loadPack, handleTurn, redactPII } = require("@sp/brain");
const { taoCongServerKhach } = require("./cong-server-khach");
const { taoMayChu } = require("./may-chu");
const { triNhoTrongBoNho } = require("./tri-nho");

/**
 * @param cauHinhShop { [tenant]: { diaChi, ma, nganh } }
 */
function dungBoNao({ cacShop = {}, triNho = triNhoTrongBoNho(), goi, nhatKy, dongHo } = {}) {
  const ky = nhatKy ?? { tin: (...d) => console.log(...d), canhBao: (...d) => console.warn(...d) };
  const gio = dongHo ?? { now: () => new Date() };

  const shop = new Map();
  for (const [tenant, c] of Object.entries(cacShop)) {
    if (!c?.diaChi) throw new Error(`Shop "${tenant}" thiếu địa chỉ server.`);
    shop.set(tenant, {
      cong: taoCongServerKhach({ diaChi: c.diaChi, ma: c.ma, goi, nhatKy: ky }),
      pack: loadPack(c.nganh || "giay-chay")
    });
  }

  async function xuLyTin(tin) {
    const cai = shop.get(String(tin.tenant || ""));
    if (!cai) {
      ky.canhBao(`[bo-nao] khong biet shop "${tin.tenant}" — bo tin`);
      return { daTraLoi: false, viSao: "khong_biet_shop" };
    }

    const kq = await handleTurn(cai.pack, {
      tools: cai.cong.tools,
      catalog: cai.cong.catalog,
      memory: triNho,
      clock: gio
    }, {
      tenant: tin.tenant,
      // Moi khach tren moi kenh la mot hoi thoai rieng.
      conversationId: String(tin.maHoiThoai || `${tin.kenh || "facebook"}:${tin.nguoi}`),
      text: String(tin.chu || ""),
      imageCount: Number(tin.soAnh || 0),
      at: String(tin.luc || gio.now().toISOString())
    });

    // Bo may co ba loi ra. "handoff" la co y KHONG tra loi: chuyen cho nguoi that con hon
    // noi sai. Van ghi nhat ky de nguoi ban hang biet co viec dang cho.
    if (kq.action === "handoff") {
      ky.tin(`[bo-nao] chuyen nguoi that: ${tin.tenant} / ${tin.nguoi}`);
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

if (require.main === module) {
  const cong = Number(process.env.PORT || 4200);
  const cacShop = JSON.parse(process.env.SHOP_JSON || "{}");
  if (Object.keys(cacShop).length === 0) {
    console.error("[bo-nao] SHOP_JSON rong — chua co shop nao de phuc vu.");
    process.exitCode = 1;
  } else {
    const { xuLyTin } = dungBoNao({ cacShop });
    taoMayChu({ xuLyTin, maNhan: String(process.env.MA_NHAN_TIN || "").trim() }).listen(cong, () => {
      console.log(`[bo-nao] nghe o cong ${cong}, phuc vu ${Object.keys(cacShop).length} shop`);
    });
  }
}

module.exports = { dungBoNao };
