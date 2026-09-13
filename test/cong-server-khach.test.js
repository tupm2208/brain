// CONG TOI SERVER KHACH — sau dot L5 (14/09/2026): cong cu doc tu landing, ngu canh khong bi vut,
// offline chi 30 giay, dem muc luc dung, tri nho o landing, bao "can nguoi".

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { taoCongServerKhach, CONG_CU_MAC_DINH, LAM_MOI_CONG_CU_MS, OFFLINE_MS } = require("../noi/cong-server-khach");
const { dungBoNao } = require("../noi/chay");
const { sinhKhoaKy } = require("../license/khoa-ky");
const { taoSoLicense } = require("../license/so-license");
const { taoDichVuLicense } = require("../license/dich-vu");

const T0 = Date.parse("2026-09-14T08:00:00.000Z");

/** Landing gia: ghi lai moi loi goi, tra loi theo duong. */
function landingGia({ congCu = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "storefront.link"], hong = () => false } = {}) {
  const daGoi = [];
  const triNho = new Map();
  const goi = async (url, tuyChon = {}) => {
    const u = new URL(String(url));
    const than = tuyChon.body ? JSON.parse(String(tuyChon.body)) : null;
    daGoi.push({ duong: u.pathname, method: tuyChon.method || "GET", than, ma: String(tuyChon.headers?.Authorization || "").replace(/^Bearer /, "") });
    if (hong(u.pathname)) throw new Error("mat mang");
    const tra = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });
    if (u.pathname === "/api/bo-nao/cong-cu" && (tuyChon.method || "GET") === "GET") return tra({ ok: true, congCu });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      if (!congCu.includes(than.ten)) return tra({ ok: false, error: "cong_cu_khong_co", dangMo: congCu }, 400);
      if (than.ten === "catalog.count") return tra({ ok: true, data: { total: 4834 } });
      if (than.ten === "catalog.search") return tra({ ok: true, data: { items: [{ id: "DV1", code: "DV1", name: "Pegasus 40", priceFrom: 1, variantCount: 1 }], truncated: false } });
      return tra({ ok: true, data: { rows: [], asOf: "", truncated: false } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) {
      const id = decodeURIComponent(u.pathname.split("/").pop());
      if ((tuyChon.method || "GET") === "PUT") { triNho.set(id, than.trangThai); return tra({ ok: true, capNhatLuc: "x" }); }
      return tra({ ok: true, trangThai: triNho.get(id) ?? null });
    }
    if (u.pathname === "/api/hop-thu/gui") return tra({ ok: true, ketQua: { guiNgay: true } });
    if (u.pathname === "/api/hop-thu/can-nguoi") return tra({ ok: true });
    return tra({ ok: false, error: "khong_thay" }, 404);
  };
  return { goi, daGoi, triNho };
}

function dungCong({ landing = landingGia(), t = { luc: T0 } } = {}) {
  const gio = { now: () => new Date(t.luc) };
  const canhBao = [];
  const cong = taoCongServerKhach({ diaChi: "https://shop.vn/", ma: () => "ve-dich-vu", goi: landing.goi, nhatKy: { tin: () => {}, canhBao: (m) => canhBao.push(m) }, gio });
  return { cong, gio, t, canhBao, landing };
}

test("danh sach cong cu: ban lui truoc khi hoi; sau lamMoiCongCu la danh sach cua landing; cu sau 5 phut", async () => {
  const { cong, t } = dungCong();
  assert.deepEqual(cong.tools.available(), CONG_CU_MAC_DINH);
  assert.equal(cong.congCuCu(), true);
  const ds = await cong.lamMoiCongCu();
  assert.ok(ds.includes("policy.get"));
  assert.ok(ds.includes("catalog.count"));
  assert.deepEqual(cong.tools.available(), ds);
  assert.equal(cong.congCuCu(), false);
  t.luc += LAM_MOI_CONG_CU_MS + 1;
  assert.equal(cong.congCuCu(), true, "qua 5 phut la cu");
});

test("landing chet luc hoi cong cu: giu ban lui (hoac danh sach cu), va canh bao mot lan", async () => {
  const hong = { co: true };
  const landing = landingGia({ hong: (d) => hong.co && d === "/api/bo-nao/cong-cu" });
  const { cong, canhBao } = dungCong({ landing });
  await cong.lamMoiCongCu();
  assert.deepEqual(cong.tools.available(), CONG_CU_MAC_DINH);
  assert.ok(canhBao.some((m) => /tam dung ban lui/.test(m)));
  hong.co = false;
  const ds = await cong.lamMoiCongCu();
  assert.ok(ds.includes("policy.get"));
  hong.co = true;
  await cong.lamMoiCongCu();
  assert.ok(cong.tools.available().includes("policy.get"), "hong lan sau thi giu danh sach da co");
});

test("call: mang theo ngu canh (ma hoi thoai + khoa chong trung) len landing, va ve dich vu trong Authorization", async () => {
  const { cong, landing } = dungCong();
  await cong.lamMoiCongCu();
  const kq = await cong.tools.call("stock.lookup", { code: "DV1" }, { conversationId: "facebook:k1", idempotencyKey: "facebook:k1:t:stock.lookup" });
  assert.equal(kq.ok, true);
  const goi = landing.daGoi.find((g) => g.method === "POST" && g.duong === "/api/bo-nao/cong-cu");
  assert.deepEqual(goi.than.nguCanh, { conversationId: "facebook:k1", idempotencyKey: "facebook:k1:t:stock.lookup" });
  assert.equal(goi.ma, "ve-dich-vu");
  const la = await cong.tools.call("chay_lenh", {});
  assert.equal(la.ok, false);
  assert.equal(la.error.code, "tool_failed");
});

test("online(): mat mang thi offline 30 giay roi thu lai — khong offline vinh vien", async () => {
  const hong = { co: true };
  const landing = landingGia({ hong: () => hong.co });
  const { cong, t } = dungCong({ landing });
  assert.equal(cong.tools.online(), true);
  const kq = await cong.tools.call("stock.lookup", { code: "x" });
  assert.equal(kq.error.code, "link_down");
  assert.equal(cong.tools.online(), false);
  t.luc += OFFLINE_MS - 1000;
  assert.equal(cong.tools.online(), false);
  t.luc += 2000;
  assert.equal(cong.tools.online(), true, "het 30 giay la cho bot thu lai");
  hong.co = false;
  await cong.lamMoiCongCu();
  assert.equal((await cong.tools.call("stock.lookup", { code: "x" })).ok, true);
  assert.equal(cong.tools.online(), true);
});

test("catalog.size(): hoi catalog.count, ra so that; landing khong mo catalog.count thi 0", async () => {
  const { cong } = dungCong();
  await cong.lamMoiCongCu();
  assert.equal(await cong.catalog.size("toprun"), 4834);
  const it = await cong.catalog.search("toprun", "pegasus", 5);
  assert.equal(it[0].code, "DV1");
  const { cong: cong2 } = dungCong({ landing: landingGia({ congCu: ["catalog.search"] }) });
  await cong2.lamMoiCongCu();
  assert.equal(await cong2.catalog.size("toprun"), 0);
});

test("tri nho: load chua co -> null; save roi load lai o landing; bao can nguoi di dung duong", async () => {
  const { cong, landing } = dungCong();
  assert.equal(await cong.triNho.load("toprun", "facebook:k1"), null);
  const st = { tenant: "toprun", conversationId: "facebook:k1", turns: [] };
  await cong.triNho.save(st);
  assert.deepEqual(await cong.triNho.load("toprun", "facebook:k1"), st);
  assert.ok(landing.daGoi.some((g) => g.method === "PUT" && g.duong === "/api/bo-nao/tri-nho/facebook%3Ak1"));
  assert.equal(await cong.baoCanNguoi({ kenh: "facebook", nguoi: "k1", maHoiThoai: "facebook:k1", lyDo: "khong chac", tinCuoi: "x" }), true);
  const cn = landing.daGoi.find((g) => g.duong === "/api/hop-thu/can-nguoi");
  assert.equal(cn.than.maHoiThoai, "facebook:k1");
});

test("bo nao ban license: tri nho di qua landing (khong con RAM), va lech bo luat / cong cu duoc canh bao mot lan", async () => {
  const gio = { bayGio: () => new Date(T0) };
  const khoaKy = sinhKhoaKy();
  const so = await taoSoLicense({ thuMuc: null });
  const license = taoDichVuLicense({ so, khoaKy, gio, manhHopLe: ["hang-kho", "chatbot-cskh"], manhLoi: ["hang-kho"] });
  const { key } = await license.capKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.landingDangKy({ key, diaChi: "https://shop.vn" });

  const landing = landingGia({ congCu: ["catalog.search", "stock.lookup", "catalog.count", "storefront.link"] });
  const canhBao = [];
  const boNao = dungBoNao({ license, goi: landing.goi, nhatKy: { tin: () => {}, canhBao: (m) => canhBao.push(m) }, dongHo: { now: () => new Date(T0) } });
  await boNao.xuLyTin({ tenant: "toprun", kenh: "facebook", nguoi: "k1", chu: "shop có Pegasus 40 size 42 không", maHoiThoai: "facebook:k1" });
  assert.ok(landing.daGoi.some((g) => g.duong === "/api/bo-nao/tri-nho/facebook%3Ak1" && g.method === "GET"), "doc tri nho tu landing");
  assert.ok(landing.daGoi.some((g) => g.duong === "/api/bo-nao/tri-nho/facebook%3Ak1" && g.method === "PUT"), "ghi tri nho ve landing");
  assert.ok(landing.triNho.get("facebook:k1"), "trang thai hoi thoai nam o landing");
  assert.ok(canhBao.some((m) => /landing khong mo/.test(m) && /policy\.get/.test(m)), `phai canh bao lech: ${canhBao.join(" | ")}`);
  await boNao.xuLyTin({ tenant: "toprun", kenh: "facebook", nguoi: "k1", chu: "còn không", maHoiThoai: "facebook:k1" });
  assert.equal(canhBao.filter((m) => /landing khong mo/.test(m)).length, 1, "canh bao mot lan");
});
