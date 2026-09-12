// NOI HAI PHAN — mot tin nhan di het duong: hop thu cua server khach -> bo nao -> tra loi.
//
// Bai nay cam server khach THAT (khung + ba module) vao bo nao THAT, khong gia mot ben nao.
// Cai duy nhat gia la mang: `goi` cua bo nao duoc noi thang vao `khung.xuLy` cua server khach.
// Nho vay bai chay trong mot tien trinh, khong mo cong, va van di qua dung cac cua that.

"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const GOC = path.join(__dirname, "..", "..", "server-khach");
const { taoKhung } = require(path.join(GOC, "loi/khung"));
const { taoKhoMysql } = require(path.join(GOC, "loi/cong/kho-mysql"));
const { taoBoDemGoi } = require(path.join(GOC, "loi/cong/han-goi"));
const { taoNhatKyGia, taoGioGia, taoHttpNgoaiGia } = require(path.join(GOC, "loi/cong/co-ban"));
const { taoCongQuyen } = require(path.join(GOC, "loi/cong/quyen"));
const mHangKho = require(path.join(GOC, "modules/hang-kho/module"));
const mHopThu = require(path.join(GOC, "modules/hop-thu/module"));
const mCongBoNao = require(path.join(GOC, "modules/cong-bo-nao/module"));
const mVanChuyen = require(path.join(GOC, "modules/van-chuyen/module"));

const { dungBoNao } = require("../noi/chay");
const { triNhoTrongBoNho } = require("../noi/tri-nho");

const MA_QT = "ma-quan-tri";
const MA_BO_NAO = "ma-bo-nao";
const SHOP = "toprun";

// Tu dot 2b, hang hoa nam tren bang MySQL — nen bo bai nay can MySQL that.
//   TOPRUN_MYSQL_URL=mysql://root:...@127.0.0.1:3307/toprun_modules_test npm run test:mysql
const DUONG = String(process.env.TOPRUN_MYSQL_URL || "").trim();
const boQua = DUONG ? {} : { skip: "chua dat TOPRUN_MYSQL_URL — bo qua bai noi hai phan" };
if (DUONG && /:3306\//.test(DUONG)) throw new Error("Cong 3306 la du lieu that cua landing. Dung 3307.");

const MON = {
  code: "DV1234", name: "Giày chạy Nike Pegasus 40", brand: "Nike", listPrice: 3500000,
  sizes: [
    { size: "42", qty: 3, price: 2890000, warehouseId: "wh_yen", warehouse: "Yên" },
    { size: "43", qty: 0, price: 2890000, warehouseId: "wh_yen", warehouse: "Yên" }
  ]
};

/** Dung ca hai phan, noi mang gia giua chung. */
// Mot ket noi dung chung cho ca bo bai — mo moi bai mot ket noi thi cuoi bo treo vi con
// ket noi chua dong.
let khoChung = null;
async function khoDungChung(nhatKy) {
  if (!khoChung) {
    khoChung = await taoKhoMysql({ duongKetNoi: DUONG, nhatKy });
    await khoChung.chayLuocDo("hang-kho", mHangKho.luocDo);
  }
  return khoChung;
}
after(async () => { if (khoChung) await khoChung.dong(); });

async function dungCaHai({ mon = [MON] } = {}) {
  const nhatKy = taoNhatKyGia();
  const gio = taoGioGia();
  const kho = await khoDungChung(nhatKy);
  for (const b of ["hang_kho_giu_cho", "hang_kho_bien_the", "hang_kho_mon", "hang_kho_ma_chan"]) {
    await kho.cauLenh(`DELETE FROM \`${b}\``, []);
  }
  const daGui = [];

  const khung = taoKhung({
    cong: {
      kho, nhatKy, gio,
      // Graph API gia: ghi lai tin da gui cho khach.
      httpNgoai: {
        async goi(url, tuyChon = {}) {
          daGui.push({ url: String(url), than: JSON.parse(String(tuyChon.body || "{}")) });
          return { ok: true, status: 200, json: async () => ({ message_id: "m.1" }), text: async () => "" };
        }
      },
      quyen: taoCongQuyen({ maQuanTri: MA_QT, maDichVu: MA_BO_NAO }),
      hanGoi: taoBoDemGoi({ gio })
    },
    nhatKy,
    toKhais: [mHangKho, mVanChuyen, mHopThu, mCongBoNao],
    cauHinh: {
      "hang-kho": {},
      "hop-thu": { verifyToken: "v", appSecret: "", tokenTrang: "tk" },
      "cong-bo-nao": { diaChiWeb: "https://toprun.site" },
      "van-chuyen": { hangMacDinh: "spx", spx: {} }
    }
  });

  await khung.xuLy({
    method: "POST", duong: "/api/products", truyVan: {}, ip: "1.1.1.1",
    tieuDe: { authorization: `Bearer ${MA_QT}` }, doc: async () => mon
  });

  // "Mang" gia: bien mot loi goi HTTP thanh mot loi goi thang vao khung cua server khach.
  const goi = async (url, tuyChon = {}) => {
    const u = new URL(String(url));
    const ra = await khung.xuLy({
      method: tuyChon.method || "GET",
      duong: u.pathname,
      truyVan: Object.fromEntries(u.searchParams),
      tieuDe: Object.fromEntries(Object.entries(tuyChon.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
      ip: "1.1.1.1",
      doc: async () => JSON.parse(String(tuyChon.body || "{}")),
      tho: async () => Buffer.from(String(tuyChon.body || ""), "utf8")
    });
    return {
      ok: ra.ma >= 200 && ra.ma < 300,
      status: ra.ma,
      json: async () => ra.than,
      text: async () => JSON.stringify(ra.than)
    };
  };

  const boNao = dungBoNao({
    cacShop: { [SHOP]: { diaChi: "https://toprun.site", ma: MA_BO_NAO, nganh: "giay-chay" } },
    triNho: triNhoTrongBoNho(),
    goi,
    nhatKy,
    dongHo: { now: () => new Date("2026-09-12T10:00:00.000Z") }
  });

  const nhan = (chu, nguoi = "khach-1", maHoiThoai = "hoi-thoai-1") =>
    boNao.xuLyTin({ tenant: SHOP, kenh: "facebook", nguoi, chu, maHoiThoai, luc: "2026-09-12T10:00:00.000Z" });

  return { khung, kho, nhatKy, daGui, boNao, nhan };
}

test("bo nao hoi duoc ton that qua cong cua server khach", { ...boQua }, async (t) => {
  const { boNao } = await dungCaHai();
  const cong = boNao.shop.get(SHOP).cong;

  const tim = await cong.tools.call("catalog.search", { q: "pegasus", limit: 5 });
  assert.equal(tim.ok, true, JSON.stringify(tim));
  assert.equal(tim.data.items.length, 1);
  assert.equal(tim.data.items[0].code, "DV1234");

  const ton = await cong.tools.call("stock.lookup", { code: "DV1234", variantLabel: "42" });
  assert.equal(ton.ok, true);
  assert.equal(ton.data.rows.length, 1);
  assert.equal(ton.data.rows[0].qty, 3);
  assert.equal(ton.data.rows[0].price, 2890000);
});

test("TEN KHO va MA KHO khong duoc gui sang bo nao", { ...boQua }, async (t) => {
  const { boNao } = await dungCaHai();
  const ton = await boNao.shop.get(SHOP).cong.tools.call("stock.lookup", { code: "DV1234" });
  const chu = JSON.stringify(ton.data.rows);
  assert.ok(!/Yên/.test(chu), `ten kho lot sang bo nao: ${chu}`);
  // Ma kho that cung mang ten nguoi ("wh_yen") va ten doi tac ("supersports_..."), nen no
  // duoc bam di. Bo nao chi dem so nguon hang, khong doc noi dung ma nay.
  assert.ok(!/wh_yen/.test(chu), `ma kho that lot sang bo nao: ${chu}`);
  for (const d of ton.data.rows) assert.match(d.warehouseId, /^kho_[0-9a-f]{8}$/);

  // Bam di nhung van DEM dung: kho that chi co mot, nen ma mu cung chi mot — bo nao noi
  // "tai 1 kho" la dung. (Hai kho khac nhau ra hai ma khac nhau: bai o server khach giu.)
  assert.equal(new Set(ton.data.rows.map((d) => d.warehouseId)).size, 1);
});

test("khach hoi con hang khong — bot tra loi va tin di ra dung duong hop thu", { ...boQua }, async (t) => {
  const { nhan, daGui } = await dungCaHai();
  const kq = await nhan("shop còn Pegasus 40 size 42 không");

  assert.equal(kq.daTraLoi, true, JSON.stringify(kq));
  assert.equal(daGui.length, 1, "phai gui dung mot tin");
  assert.match(daGui[0].url, /graph\.facebook\.com/);
  assert.equal(daGui[0].than.recipient.id, "khach-1");
  assert.ok(String(daGui[0].than.message.text).length > 0);
});

test("size da het thi bot KHONG noi la con", { ...boQua }, async (t) => {
  const { nhan, daGui } = await dungCaHai();
  await nhan("còn Pegasus 40 size 43 không");
  const traLoi = String(daGui[0]?.than?.message?.text ?? "");
  assert.ok(traLoi.length > 0, "phai co cau tra loi");
  assert.ok(!/còn hàng size 43|còn size 43/i.test(traLoi), `bot noi con hang khi da het: ${traLoi}`);
});

test("cong cu goi ten la thi bi tu choi, va noi ro cai gi dang mo", { ...boQua }, async (t) => {
  const { boNao } = await dungCaHai();
  const kq = await boNao.shop.get(SHOP).cong.tools.call("chay_cau_lenh", {});
  assert.equal(kq.ok, false);
  assert.equal(kq.error.code, "tool_failed");
});

test("khong co ma dich vu thi khong goi duoc cong cu nao", { ...boQua }, async (t) => {
  const { khung } = await dungCaHai();
  const ra = await khung.xuLy({
    method: "POST", duong: "/api/bo-nao/cong-cu", truyVan: {}, tieuDe: {},
    doc: async () => ({ ten: "catalog.search", input: { q: "x" } })
  });
  assert.equal(ra.ma, 401);
});

test("chua bat manh Don hang thi cong cu tra don KHONG mo, bot van tra loi duoc ton kho", { ...boQua }, async (t) => {
  const { boNao, khung } = await dungCaHai();
  const cong = boNao.shop.get(SHOP).cong;

  const kq = await cong.tools.call("order.lookup", { conversationId: "c1", phoneGivenInConversation: "0911111111" });
  assert.equal(kq.ok, false, "manh chua mua thi cong cu phai dong");

  const danhSach = await khung.xuLy({
    method: "GET", duong: "/api/bo-nao/cong-cu", truyVan: {},
    tieuDe: { authorization: `Bearer ${MA_BO_NAO}` }
  });
  assert.ok(danhSach.than.congCu.includes("stock.lookup"));
  assert.ok(!danhSach.than.congCu.includes("order.lookup"), "cong cu cua manh chua mua khong duoc liet ke");

  // Va bot van tra loi duoc cau hoi ton kho — tat mot manh khong keo sap bot.
  const ton = await cong.tools.call("stock.lookup", { code: "DV1234", variantLabel: "42" });
  assert.equal(ton.ok, true);
});

test("co manh Don hang: tra don CHI khop so khach TU GO trong hoi thoai", { ...boQua }, async (t) => {
  // Module gia dong vai Don hang — du de thu LUAT, khong can MySQL.
  const daHoi = [];
  const donGia = {
    id: "don-khach", ten: "Don gia", mang: "van-hanh", chay: "server-khach", phienBan: "0.0.1",
    capDichVu: {
      "don-khach.tim": async (ctx, dieuKien) => {
        daHoi.push(dieuKien);
        return [{ id: "ORD-1", status: "pending", createdAt: "", total: 100, paidAmount: 0, remainingAmount: 100, items: [] }];
      },
      "don-khach.doc": async () => null
    }
  };

  const nhatKy = taoNhatKyGia();
  const gio = taoGioGia();
  const kho = await khoDungChung(nhatKy);
  const khung = taoKhung({
    cong: {
      kho, nhatKy, gio, httpNgoai: taoHttpNgoaiGia(),
      quyen: taoCongQuyen({ maDichVu: MA_BO_NAO }), hanGoi: taoBoDemGoi({ gio })
    },
    nhatKy, toKhais: [mHangKho, donGia, mCongBoNao],
    cauHinh: { "hang-kho": {}, "cong-bo-nao": { diaChiWeb: "https://toprun.site" } }
  });

  const goiCongCu = (input) => khung.xuLy({
    method: "POST", duong: "/api/bo-nao/cong-cu", truyVan: {},
    tieuDe: { authorization: `Bearer ${MA_BO_NAO}` }, ip: "1.1.1.1",
    doc: async () => ({ ten: "order.lookup", input })
  });

  const khongSo = await goiCongCu({ conversationId: "c1", phoneGivenInConversation: "" });
  assert.equal(khongSo.ma, 200);
  assert.deepEqual(khongSo.than.data.orders, [], "khong co so khach tu go thi khong tra don nao");
  assert.equal(daHoi.length, 0, "thieu so thi khong duoc hoi xuong module Don hang");

  const coSo = await goiCongCu({ conversationId: "c1", phoneGivenInConversation: "0911111111" });
  assert.equal(coSo.than.data.orders.length, 1);
  assert.equal(daHoi[0].dienThoai, "0911111111", "phai loc dung theo so khach tu go");
});

test("mat mang: bo nao biet la mat, khong khang dinh con hang", { ...boQua }, async (t) => {
  const { boNao } = await dungCaHai();
  const cong = boNao.shop.get(SHOP).cong;
  assert.equal(cong.tools.online(), true);

  // Ep loi goi mang hong.
  const hong = require("../noi/cong-server-khach").taoCongServerKhach({
    diaChi: "https://toprun.site", ma: "x",
    goi: async () => { throw new Error("dut mang"); },
    nhatKy: { tin: () => {}, canhBao: () => {} }
  });
  const kq = await hong.tools.call("stock.lookup", { code: "DV1234" });
  assert.equal(kq.ok, false);
  assert.equal(kq.error.code, "link_down");
  assert.equal(hong.tools.online(), false, "mat mang thi phai biet la mat");
  assert.deepEqual(await hong.catalog.search("toprun", "pegasus", 5), [], "mat mang thi tra rong, khong bia");
});

test("may chu bo nao: thieu ma thi tu choi, du ma thi nhan tin", async () => {
  const { tayNghe } = require("../noi/may-chu");
  const daNhan = [];
  const tay = tayNghe({ xuLyTin: async (t) => { daNhan.push(t); return { daTraLoi: true }; }, maNhan: "ma-nhan" });

  const goiThu = async (tieuDe, than) => {
    // Node that luon phat Buffer tren `req`; phat chuoi la bai gia sai voi doi thuc.
    const req = Object.assign(require("node:stream").Readable.from([Buffer.from(JSON.stringify(than), "utf8")]), {
      method: "POST", url: "/tin-den", headers: tieuDe
    });
    let ma = 0; let ra = null;
    const res = {
      writeHead: (m) => { ma = m; },
      end: (chu) => { ra = chu ? JSON.parse(chu) : null; }
    };
    await tay(req, res);
    return { ma, ra };
  };

  assert.equal((await goiThu({}, { tenant: "t", nguoi: "n", chu: "a" })).ma, 401);
  assert.equal((await goiThu({ authorization: "Bearer sai" }, { tenant: "t", nguoi: "n", chu: "a" })).ma, 401);

  const dung = await goiThu({ authorization: "Bearer ma-nhan" }, { tenant: "t", nguoi: "n", chu: "a" });
  assert.equal(dung.ma, 200);
  assert.equal(daNhan.length, 1);

  const thieu = await goiThu({ authorization: "Bearer ma-nhan" }, { tenant: "t" });
  assert.equal(thieu.ma, 400);
});

test("tin cua shop khong quen thi bo qua, khong tra loi bua", { ...boQua }, async (t) => {
  const { boNao, daGui } = await dungCaHai();
  const kq = await boNao.xuLyTin({ tenant: "shop-la", kenh: "facebook", nguoi: "x", chu: "còn hàng không" });
  assert.equal(kq.daTraLoi, false);
  assert.equal(kq.viSao, "khong_biet_shop");
  assert.equal(daGui.length, 0);
});

test("hai shop khac nhau khong dung chung tri nho hoi thoai", async () => {
  const { triNhoTrongBoNho: tao } = require("../noi/tri-nho");
  const tn = tao();
  await tn.save({ tenant: "shop-a", conversationId: "c1", turns: [{ role: "customer", text: "a" }] });
  assert.equal(await tn.load("shop-b", "c1"), null, "shop B khong duoc doc hoi thoai cua shop A");
  assert.notEqual(await tn.load("shop-a", "c1"), null);
});
