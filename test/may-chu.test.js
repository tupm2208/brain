// MAY CHU BO NAO qua HTTP that (cong 0): cac cua license va /tin-den theo ma nhan tin rieng shop.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { taoMayChu } = require("../noi/may-chu");
const { dungBoNao } = require("../noi/chay");
const { sinhKhoaKy } = require("../license/khoa-ky");
const { docVe } = require("../license/ve-may");
const { taoSoLicense } = require("../license/so-license");
const { taoDichVuLicense } = require("../license/dich-vu");

const T0 = new Date("2026-09-14T08:00:00.000Z");
const MANH = ["hang-kho", "don-khach", "gian-hang", "hop-thu", "chatbot-cskh"];
const LOI = ["hang-kho", "don-khach", "gian-hang"];

async function dungMayChu({ xuLyTin = async () => ({ daTraLoi: true }), maNhan = "" } = {}) {
  let t = T0.getTime();
  const gio = { bayGio: () => new Date(t), troi: (ms) => { t += ms; } };
  const khoaKy = sinhKhoaKy();
  const so = await taoSoLicense({ thuMuc: null });
  const license = taoDichVuLicense({ so, khoaKy, gio, diaChiXeon: "https://xeon.test", manhHopLe: MANH, manhLoi: LOI });
  const nhatKy = { tin: () => {}, canhBao: () => {} };
  const mayChu = taoMayChu({ xuLyTin, license, maNhan, nhatKy, gio });
  await new Promise((r) => mayChu.listen(0, "127.0.0.1", r));
  const goc = `http://127.0.0.1:${mayChu.address().port}`;
  const goi = async (duong, { method = "GET", than, ma } = {}) => {
    const tl = await fetch(`${goc}${duong}`, {
      method,
      headers: { "Content-Type": "application/json", ...(ma ? { Authorization: `Bearer ${ma}` } : {}) },
      body: than === undefined ? undefined : (typeof than === "string" ? than : JSON.stringify(than))
    });
    return { ma: tl.status, than: await tl.json().catch(() => null) };
  };
  return { goi, license, khoaKy, gio, dong: () => new Promise((r) => mayChu.close(r)) };
}

const MAY = { maMay: "abcdef0123456789abcdef", tenMay: "may ban hang" };

test("/health song; cua license: khoa cong, kiem, truc, landing dang ky", async () => {
  const { goi, license, khoaKy, gio, dong } = await dungMayChu();
  try {
    const h = await goi("/health");
    assert.equal(h.ma, 200);
    assert.equal(h.than.soShop, 0);

    const kc = await goi("/license/khoa-cong");
    assert.equal(kc.than.keyId, khoaKy.keyId);

    const { key } = await license.capKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });

    const sai = await goi("/license/kiem", { method: "POST", than: { key: "TR-AAAA-AAAA-AAAA-AAAA", ...MAY } });
    assert.equal(sai.ma, 403);
    assert.equal(sai.than.viSao, "key_khong_co");

    const ok = await goi("/license/kiem", { method: "POST", than: { key, ...MAY } });
    assert.equal(ok.ma, 200);
    assert.equal(ok.than.truc, true);
    assert.equal(ok.than.diaChiLanding, "", "landing chua dang ky");
    const d = docVe(ok.than.ve, { khoaCongTheoKeyId: () => khoaKy.khoaCongPem, bayGio: gio.bayGio() });
    assert.equal(d.hopLe, true);
    assert.equal(d.than.maMay, MAY.maMay);

    const truc = await goi("/license/truc", { method: "POST", than: { key, maMay: MAY.maMay } });
    assert.deepEqual(truc.than, { ok: true, truc: true });

    const roi = await goi("/license/roi", { method: "POST", than: { key, maMay: MAY.maMay } });
    assert.equal(roi.ma, 200);
    assert.equal(roi.than.conLai, 0);
    assert.equal((await goi("/license/roi", { method: "POST", than: { key, maMay: MAY.maMay } })).ma, 403);
    assert.equal((await goi("/license/kiem", { method: "POST", than: { key, ...MAY } })).ma, 200, "roi roi vao lai duoc");

    const dk = await goi("/license/landing-dang-ky", { method: "POST", than: { key, diaChi: "https://toprun.site" } });
    assert.equal(dk.ma, 200);
    assert.equal(dk.than.khoaCongPem, khoaKy.khoaCongPem);
    assert.equal(dk.than.diaChiXeon, "https://xeon.test");
    assert.match(dk.than.maNhanTin, /^nt-/);

    const lai = await goi("/license/kiem", { method: "POST", than: { key, ...MAY } });
    assert.equal(lai.than.diaChiLanding, "https://toprun.site", "sau dang ky, OMI nhan dia chi landing trong ve");

    assert.equal((await goi("/license/kiem", { method: "POST", than: "khong json" })).ma, 400);
    assert.equal((await goi("/license/kiem", { method: "POST", than: [1] })).ma, 400);
    assert.equal((await goi("/license/khong-co", { method: "POST", than: {} })).ma, 404);
    assert.equal((await goi("/license/kiem")).ma, 404, "GET vao cua POST");
  } finally { await dong(); }
});

test("/tin-den: shop suy tu ma nhan tin rieng; ma la 401; tenant trong than khac ma thi 403; thieu truong 400", async () => {
  const daNhan = [];
  const { goi, license, dong } = await dungMayChu({ xuLyTin: async (tin) => { daNhan.push(tin); return { daTraLoi: true }; } });
  try {
    const a = await license.capKey({ shop: "shop-a", tenShop: "A", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
    const b = await license.capKey({ shop: "shop-b", tenShop: "B", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
    const dkA = await license.landingDangKy({ key: a.key, diaChi: "https://a.vn" });
    await license.landingDangKy({ key: b.key, diaChi: "https://b.vn" });

    assert.equal((await goi("/tin-den", { method: "POST", than: { nguoi: "k", chu: "hi" } })).ma, 401, "khong ma");
    assert.equal((await goi("/tin-den", { method: "POST", than: { nguoi: "k", chu: "hi" }, ma: "nt-la" })).ma, 401, "ma la");

    const ok = await goi("/tin-den", { method: "POST", than: { nguoi: "k1", chu: "con hang khong" }, ma: dkA.maNhanTin });
    assert.equal(ok.ma, 200);
    assert.equal(daNhan[0].tenant, "shop-a", "tenant suy tu ma, than khong can ghi");

    // Landing cua A co ghi tenant "shop-b" -> mao danh -> 403, khong xu ly.
    const mao = await goi("/tin-den", { method: "POST", than: { tenant: "shop-b", nguoi: "k1", chu: "x" }, ma: dkA.maNhanTin });
    assert.equal(mao.ma, 403);
    assert.equal(mao.than.error, "tenant_khong_khop");
    assert.equal(daNhan.length, 1);

    const trung = await goi("/tin-den", { method: "POST", than: { tenant: "shop-a", nguoi: "k1", chu: "x" }, ma: dkA.maNhanTin });
    assert.equal(trung.ma, 200, "ghi dung tenant thi van qua");

    assert.equal((await goi("/tin-den", { method: "POST", than: { chu: "x" }, ma: dkA.maNhanTin })).ma, 400);
    assert.equal((await goi("/tin-den", { method: "POST", than: { nguoi: "k", chu: 5 }, ma: dkA.maNhanTin })).ma, 400);
  } finally { await dong(); }
});

test("ma nhan tin CHUNG (che do cu, chay thu) van dung duoc va tenant doc tu than", async () => {
  const daNhan = [];
  const { goi, dong } = await dungMayChu({ maNhan: "ma-chung-thu", xuLyTin: async (tin) => { daNhan.push(tin); return {}; } });
  try {
    const ok = await goi("/tin-den", { method: "POST", than: { tenant: "toprun", nguoi: "k", chu: "hi" }, ma: "ma-chung-thu" });
    assert.equal(ok.ma, 200);
    assert.equal(daNhan[0].tenant, "toprun");
    assert.equal((await goi("/tin-den", { method: "POST", than: { nguoi: "k", chu: "hi" }, ma: "ma-chung-thu" })).ma, 400, "ma chung ma khong ghi tenant");
  } finally { await dong(); }
});

test("goi don vao /license bi chan 429 sau 60 lan trong 15 phut, het 15 phut lai duoc", async () => {
  const { goi, gio, dong } = await dungMayChu();
  try {
    for (let i = 0; i < 60; i += 1) assert.equal((await goi("/license/khoa-cong")).ma, 200);
    assert.equal((await goi("/license/khoa-cong")).ma, 429);
    gio.troi(15 * 60 * 1000 + 1);
    assert.equal((await goi("/license/khoa-cong")).ma, 200);
  } finally { await dong(); }
});

test("bo nao ban license: chi phuc vu shop dang hoat dong, goi landing bang ve dich-vu ky tu Xeon", async () => {
  let t = T0.getTime();
  const gio = { bayGio: () => new Date(t) };
  const khoaKy = sinhKhoaKy();
  const so = await taoSoLicense({ thuMuc: null });
  const license = taoDichVuLicense({ so, khoaKy, gio, manhHopLe: MANH, manhLoi: LOI });
  const cacGoi = [];
  const goi = async (url, tuyChon = {}) => {
    cacGoi.push({ url: String(url), ma: String(tuyChon.headers?.Authorization || "").replace(/^Bearer /, "") });
    return { ok: true, status: 200, json: async () => ({ ok: true, data: { items: [] } }) };
  };
  const canhBao = [];
  const boNao = dungBoNao({ license, goi, nhatKy: { tin: () => {}, canhBao: (m) => canhBao.push(m) }, dongHo: { now: () => new Date(t) } });

  const kq0 = await boNao.xuLyTin({ tenant: "toprun", kenh: "facebook", nguoi: "k", chu: "hi" });
  assert.equal(kq0.viSao, "khong_phuc_vu_shop");
  assert.match(canhBao.at(-1), /khong_co_key/);

  const { key } = await license.capKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.landingDangKy({ key, diaChi: "https://toprun.site" });
  const kq = await boNao.xuLyTin({ tenant: "toprun", kenh: "facebook", nguoi: "k", chu: "hi" });
  assert.equal(typeof kq.daTraLoi, "boolean");
  assert.ok(cacGoi.length > 0, "co goi sang landing");
  assert.ok(cacGoi.every((g) => g.url.startsWith("https://toprun.site/")));
  const d = docVe(cacGoi[0].ma, { khoaCongTheoKeyId: () => khoaKy.khoaCongPem, bayGio: new Date(t) });
  assert.equal(d.hopLe, true);
  assert.equal(d.than.vai, "dich-vu");
  assert.equal(d.than.shop, "toprun");

  // Ve dich vu duoc dung lai trong 1 gio, gan het thi xin ve moi.
  const veDau = cacGoi[0].ma;
  await boNao.xuLyTin({ tenant: "toprun", kenh: "facebook", nguoi: "k", chu: "hi" });
  assert.equal(cacGoi.at(-1).ma, veDau, "chua gan het han thi dung lai");
  t += 56 * 60 * 1000;
  await boNao.xuLyTin({ tenant: "toprun", kenh: "facebook", nguoi: "k", chu: "hi" });
  assert.notEqual(cacGoi.at(-1).ma, veDau, "con duoi 5 phut thi ve moi");
});
