// LICENSE TREN XEON — moi dieu anh Dung chot 14/09/2026 co mot bai giu.
//
// Khong mang, khong may khach. So license ghi ra thu muc tam de kiem ca viec khoi dong lai.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { sinhKhoaKy, napHoacSinhKhoaKy, kiemChuKy } = require("../license/khoa-ky");
const { kyVe, docVe, SONG_VE_MS, SONG_VE_DICH_VU_MS } = require("../license/ve-may");
const { taoSoLicense } = require("../license/so-license");
const { taoDichVuLicense, idMay, MAU_KEY, SO_MAY_MAC_DINH } = require("../license/dich-vu");

const T0 = new Date("2026-09-14T08:00:00.000Z");
const MANH = ["hang-kho", "don-khach", "gian-hang", "van-chuyen", "hop-thu", "chatbot-cskh", "mua-ho"];
const LOI = ["hang-kho", "don-khach", "gian-hang"];

function gioGia(batDau = T0) {
  let t = batDau.getTime();
  return { bayGio: () => new Date(t), troi: (ms) => { t += ms; } };
}

async function dungDichVu({ thuMuc = null, gio = gioGia(), khoaKy = sinhKhoaKy() } = {}) {
  const so = await taoSoLicense({ thuMuc });
  const license = taoDichVuLicense({ so, khoaKy, gio, diaChiXeon: "https://xeon.toprun.vn", manhHopLe: MANH, manhLoi: LOI });
  return { license, gio, khoaKy, so };
}

const MAY = (n) => ({ maMay: `may-${n}-${"x".repeat(20)}`, tenMay: `Máy ${n}` });

test("cap key: dung mau TR-XXXX-XXXX-XXXX-XXXX, shop trung thi tu choi, manh la thi tu choi", async () => {
  const { license } = await dungDichVu();
  const { key, shop } = await license.capKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  assert.match(key, MAU_KEY);
  assert.equal(shop, "toprun");
  await assert.rejects(() => license.capKey({ shop: "toprun", tenShop: "x", hetHan: "2027-01-01T00:00:00.000Z" }), /da co key dang dung/);
  await assert.rejects(() => license.capKey({ shop: "shop2", tenShop: "x", manh: ["khong-co"], hetHan: "2027-01-01T00:00:00.000Z" }), /Manh khong co/);
  await assert.rejects(() => license.capKey({ shop: "shop3", tenShop: "x", hetHan: "2020-01-01T00:00:00.000Z" }), /tuong lai/);
  assert.equal(license.xemKey(key).soMay, SO_MAY_MAC_DINH);
  assert.deepEqual(license.xemKey(key).manh, [...LOI, "chatbot-cskh"].sort(), "ba manh loi luon bat");
});

test("ba may vao duoc, may thu tu 'da day' kem ten ba may; may cu vao lai khong them dong", async () => {
  const { license } = await dungDichVu();
  const { key } = await license.capKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2027-01-01T00:00:00.000Z" });
  for (const n of [1, 2, 3]) {
    const kq = await license.kiemMay({ key, ...MAY(n) });
    assert.equal(kq.ok, true, `may ${n} phai vao duoc`);
    assert.ok(kq.ve.startsWith("VM1."));
  }
  const bon = await license.kiemMay({ key, ...MAY(4) });
  assert.equal(bon.ok, false);
  assert.equal(bon.viSao, "da_day");
  assert.deepEqual(bon.may.map((m) => m.tenMay), ["Máy 1", "Máy 2", "Máy 3"]);
  assert.ok(!("maMay" in bon.may[0]), "khong tra ca ma may ra ngoai");

  const lai = await license.kiemMay({ key, ...MAY(2) });
  assert.equal(lai.ok, true);
  assert.equal(license.xemKey(key).may.length, 3);
});

test("may dau tien nhap key la may truc; doi may truc; da may truc thi truc chuyen sang may con lai; da xong thi may thu tu vao duoc", async () => {
  const { license } = await dungDichVu();
  const { key } = await license.capKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2027-01-01T00:00:00.000Z" });
  const m1 = await license.kiemMay({ key, ...MAY(1) });
  const m2 = await license.kiemMay({ key, ...MAY(2) });
  await license.kiemMay({ key, ...MAY(3) });
  assert.equal(m1.truc, true);
  assert.equal(m2.truc, false);
  assert.deepEqual(license.coTruc({ key, maMay: MAY(2).maMay }), { ok: true, truc: false });

  const id2 = idMay(MAY(2).maMay);
  assert.equal(license.xemKey(key).may[1].id, id2, "id tren man hinh la ma ngan bam tu ma may");
  assert.equal((await license.chonMayTruc({ key, mayId: id2 })).ok, true);
  assert.deepEqual(license.coTruc({ key, maMay: MAY(2).maMay }), { ok: true, truc: true });
  assert.deepEqual(license.coTruc({ key, maMay: MAY(1).maMay }), { ok: true, truc: false });

  const da = await license.daMay({ key, mayId: id2 });
  assert.equal(da.ok, true);
  assert.equal(da.may.length, 2);
  assert.equal(da.may.find((m) => m.truc).tenMay, "Máy 1", "may truc bi da thi may con lai dau tien truc");
  assert.equal(license.coTruc({ key, maMay: MAY(2).maMay }).viSao, "may_khong_co");

  assert.equal((await license.kiemMay({ key, ...MAY(4) })).ok, true, "da mot may la co cho cho may thu tu");
  assert.equal((await license.daMay({ key, mayId: "zzzzzz" })).viSao, "may_khong_co");
});

test("key sai / bi khoa / het han: tu choi va noi ro vi sao; mo khoa va gia han thi vao lai duoc", async () => {
  const { license, gio } = await dungDichVu();
  assert.equal((await license.kiemMay({ key: "TR-AAAA-AAAA-AAAA-AAAA", ...MAY(1) })).viSao, "key_khong_co");
  assert.equal((await license.kiemMay({ key: "khong-phai-key", ...MAY(1) })).viSao, "key_khong_co");

  const { key } = await license.capKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2026-10-01T00:00:00.000Z" });
  assert.equal((await license.kiemMay({ key, maMay: "ngan", tenMay: "x" })).viSao, "ma_may_sai");

  await license.khoaKey(key, "chua tra tien");
  const khoa = await license.kiemMay({ key, ...MAY(1) });
  assert.equal(khoa.viSao, "key_bi_khoa");
  assert.equal(khoa.lyDo, "chua tra tien");
  assert.equal(license.xemKey(key).trangThai, "bi_khoa");
  await license.moKey(key);
  assert.equal((await license.kiemMay({ key, ...MAY(1) })).ok, true);

  gio.troi(30 * 24 * 3600 * 1000);
  const het = await license.kiemMay({ key, ...MAY(1) });
  assert.equal(het.viSao, "key_het_han");
  assert.equal(license.xemKey(key).trangThai, "het_han");
  await license.giaHan(key, "2027-06-01T00:00:00.000Z");
  assert.equal((await license.kiemMay({ key, ...MAY(1) })).ok, true);
});

test("key go thuong / co khoang trang van nhan", async () => {
  const { license } = await dungDichVu();
  const { key } = await license.capKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2027-01-01T00:00:00.000Z" });
  assert.equal((await license.kiemMay({ key: ` ${key.toLowerCase()} `, ...MAY(1) })).ok, true);
});

test("ve may: soi duoc bang khoa cong, mang dung shop/may/manh/truc; sua mot ky tu la sai; het han sau 7 gio; khoa la thi khong biet", async () => {
  const { license, gio, khoaKy } = await dungDichVu();
  const { key } = await license.capKey({ shop: "toprun", tenShop: "TopRun", manh: ["van-chuyen"], hetHan: "2027-01-01T00:00:00.000Z" });
  const { ve, hetLuc } = await license.kiemMay({ key, ...MAY(1) });
  assert.equal(hetLuc, T0.getTime() + SONG_VE_MS);

  const khoaCongTheoKeyId = (id) => (id === khoaKy.keyId ? khoaKy.khoaCongPem : null);
  const d = docVe(ve, { khoaCongTheoKeyId, bayGio: gio.bayGio() });
  assert.equal(d.hopLe, true);
  assert.equal(d.than.vai, "quan-tri");
  assert.equal(d.than.shop, "toprun");
  assert.equal(d.than.maMay, MAY(1).maMay);
  assert.equal(d.than.truc, true);
  assert.deepEqual(d.than.manh, [...LOI, "van-chuyen"].sort());
  assert.equal(d.than.keyId, khoaKy.keyId);

  // Sua mot ky tu trong than (doi shop) -> chu ky sai.
  const [tt, than, ky] = ve.split(".");
  const thanSua = Buffer.from(Buffer.from(than, "base64url").toString("utf8").replace('"toprun"', '"shop-b"'), "utf8").toString("base64url");
  assert.equal(docVe(`${tt}.${thanSua}.${ky}`, { khoaCongTheoKeyId, bayGio: gio.bayGio() }).viSao, "chu_ky_sai");
  assert.equal(docVe("VM1.abc", { khoaCongTheoKeyId, bayGio: gio.bayGio() }).viSao, "sai_hinh_dang");
  assert.equal(docVe("xyz", { khoaCongTheoKeyId, bayGio: gio.bayGio() }).viSao, "sai_hinh_dang");

  // Khoa la (landing chua biet keyId nay).
  assert.equal(docVe(ve, { khoaCongTheoKeyId: () => null, bayGio: gio.bayGio() }).viSao, "khong_biet_khoa");
  // Ky bang khoa khac nhung cung keyId -> chu ky sai.
  const khac = sinhKhoaKy();
  assert.equal(docVe(ve, { khoaCongTheoKeyId: () => khac.khoaCongPem, bayGio: gio.bayGio() }).viSao, "chu_ky_sai");

  gio.troi(SONG_VE_MS - 1000);
  assert.equal(docVe(ve, { khoaCongTheoKeyId, bayGio: gio.bayGio() }).hopLe, true, "con 1 giay van song");
  gio.troi(2000);
  assert.equal(docVe(ve, { khoaCongTheoKeyId, bayGio: gio.bayGio() }).viSao, "het_han");
});

test("ve tu tuong lai (dong ho lech qua 5 phut) bi tu choi; lech it thi cho qua", () => {
  const khoaKy = sinhKhoaKy();
  const t = T0.getTime();
  const ve = kyVe({ vai: "quan-tri", shop: "s", tenShop: "S", maMay: "m", tenMay: "M", manh: [], truc: false, phatLuc: t + 10 * 60 * 1000, hetLuc: t + 8 * 3600 * 1000 }, khoaKy);
  const soi = (luc) => docVe(ve, { khoaCongTheoKeyId: () => khoaKy.khoaCongPem, bayGio: new Date(luc) });
  assert.equal(soi(t).viSao, "chua_toi_gio");
  assert.equal(soi(t + 6 * 60 * 1000).hopLe, true);
  assert.throws(() => kyVe({ vai: "la", shop: "s", phatLuc: t, hetLuc: t + 1 }, khoaKy), /vai/);
  assert.throws(() => kyVe({ vai: "quan-tri", shop: "s", phatLuc: t, hetLuc: t }, khoaKy), /hetLuc/);
});

test("landing dang ky: dia chi sai tu choi; dung thi nhan khoa cong + ma nhan tin; ma nhan tin suy ra shop; dang ky lai la ma cu chet", async () => {
  const { license, khoaKy } = await dungDichVu();
  const { key } = await license.capKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2027-01-01T00:00:00.000Z" });
  assert.equal((await license.landingDangKy({ key, diaChi: "ftp://x" })).viSao, "dia_chi_sai");
  assert.equal((await license.landingDangKy({ key, diaChi: "https://toprun.site/admin" })).viSao, "dia_chi_sai");
  assert.equal((await license.landingDangKy({ key: "TR-AAAA-AAAA-AAAA-AAAA", diaChi: "https://toprun.site" })).viSao, "key_khong_co");

  const dk = await license.landingDangKy({ key, diaChi: "https://toprun.site/" });
  assert.equal(dk.ok, true);
  assert.equal(dk.shop, "toprun");
  assert.equal(dk.keyId, khoaKy.keyId);
  assert.equal(dk.khoaCongPem, khoaKy.khoaCongPem);
  assert.equal(dk.diaChiXeon, "https://xeon.toprun.vn");
  assert.match(dk.maNhanTin, /^nt-[A-Za-z0-9_-]{20,}$/);
  assert.equal(license.shopTuMaNhanTin(dk.maNhanTin), "toprun");
  assert.equal(license.shopTuMaNhanTin("nt-khong-co"), null);
  assert.equal(license.shopTuMaNhanTin(""), null);
  assert.equal(license.xemKey(key).landing.diaChi, "https://toprun.site", "bo dau / cuoi");
  assert.ok(!JSON.stringify(license.xemKey(key)).includes(dk.maNhanTin), "xemKey khong lo ma nhan tin");
  assert.ok(!JSON.stringify(license.lietKe()).includes(dk.maNhanTin));

  const dk2 = await license.landingDangKy({ key, diaChi: "https://toprun.site" });
  assert.notEqual(dk2.maNhanTin, dk.maNhanTin);
  assert.equal(license.shopTuMaNhanTin(dk.maNhanTin), null, "ma cu chet");
  assert.equal(license.shopTuMaNhanTin(dk2.maNhanTin), "toprun");
});

test("bo nao chi phuc vu shop: co key con han + mua chatbot + landing da dang ky; ve dich vu vai dich-vu song 1 gio", async () => {
  const { license, gio, khoaKy } = await dungDichVu();
  assert.equal(license.shopDangPhucVu("toprun").viSao, "khong_co_key");

  const { key } = await license.capKey({ shop: "toprun", tenShop: "TopRun", manh: ["hop-thu"], hetHan: "2026-10-01T00:00:00.000Z" });
  assert.equal(license.shopDangPhucVu("toprun").viSao, "chua_mua_chatbot");
  await license.datManh(key, ["hop-thu", "chatbot-cskh"]);
  assert.equal(license.shopDangPhucVu("toprun").viSao, "landing_chua_dang_ky");
  await license.landingDangKy({ key, diaChi: "https://toprun.site" });
  const pv = license.shopDangPhucVu("toprun");
  assert.equal(pv.ok, true);
  assert.equal(pv.diaChi, "https://toprun.site");

  const { ve, hetLuc } = license.veDichVu("toprun");
  assert.equal(hetLuc, T0.getTime() + SONG_VE_DICH_VU_MS);
  const d = docVe(ve, { khoaCongTheoKeyId: () => khoaKy.khoaCongPem, bayGio: gio.bayGio() });
  assert.equal(d.hopLe, true);
  assert.equal(d.than.vai, "dich-vu");
  assert.equal(d.than.shop, "toprun");

  await license.khoaKey(key, "x");
  assert.equal(license.shopDangPhucVu("toprun").viSao, "khong_co_key");
  assert.throws(() => license.veDichVu("toprun"), /khong co key/);
  await license.moKey(key);
  gio.troi(60 * 24 * 3600 * 1000);
  assert.equal(license.shopDangPhucVu("toprun").viSao, "key_het_han");
});

test("so ghi xuong tep va nap lai: khoi dong lai Xeon van nho may da ghep va ma nhan tin", async () => {
  const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "xeon-license-"));
  const khoaKy = napHoacSinhKhoaKy(thuMuc);
  assert.equal(khoaKy.moiSinh, true);
  const a = await dungDichVu({ thuMuc, khoaKy });
  const { key } = await a.license.capKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2027-01-01T00:00:00.000Z" });
  await a.license.kiemMay({ key, ...MAY(1) });
  const dk = await a.license.landingDangKy({ key, diaChi: "https://toprun.site" });

  const khoaKy2 = napHoacSinhKhoaKy(thuMuc);
  assert.equal(khoaKy2.moiSinh, false);
  assert.equal(khoaKy2.keyId, khoaKy.keyId, "nap lai dung khoa cu");
  const b = await dungDichVu({ thuMuc, khoaKy: khoaKy2 });
  assert.equal(b.license.xemKey(key).may.length, 1);
  assert.equal(b.license.shopTuMaNhanTin(dk.maNhanTin), "toprun");
  const kq = await b.license.kiemMay({ key, ...MAY(1) });
  assert.equal(kq.ok, true);
  assert.equal(b.license.xemKey(key).may.length, 1, "khong ghi may hai lan");

  // Khoa rieng nam trong tep rieng, khong nam trong so.
  const so = fs.readFileSync(path.join(thuMuc, "license.json"), "utf8");
  assert.ok(!so.includes("PRIVATE KEY"));
  assert.ok(fs.existsSync(path.join(thuMuc, "xeon.ky.key.pem")));
  fs.rmSync(thuMuc, { recursive: true, force: true });
});

test("so sai hinh dang thi tu choi khoi dong, khong ghi de", async () => {
  const thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "xeon-license-hong-"));
  fs.writeFileSync(path.join(thuMuc, "license.json"), JSON.stringify({ gi: 1 }));
  await assert.rejects(() => taoSoLicense({ thuMuc }), /khong dung hinh dang/);
  assert.equal(fs.readFileSync(path.join(thuMuc, "license.json"), "utf8"), JSON.stringify({ gi: 1 }));
  fs.rmSync(thuMuc, { recursive: true, force: true });
});

test("khoa ky: ky roi kiem duoc; khoa khac kiem la sai; chu ky hong khong nem", () => {
  const k = sinhKhoaKy();
  const { kyChuoi } = require("../license/khoa-ky");
  const s = kyChuoi(k.khoaRiengPem, "xin chao");
  assert.equal(kiemChuKy(k.khoaCongPem, "xin chao", s), true);
  assert.equal(kiemChuKy(k.khoaCongPem, "xin chao!", s), false);
  assert.equal(kiemChuKy(sinhKhoaKy().khoaCongPem, "xin chao", s), false);
  assert.equal(kiemChuKy("khong phai pem", "xin chao", s), false);
  assert.equal(kiemChuKy(k.khoaCongPem, "xin chao", "@@@"), false);
  assert.match(k.keyId, /^ky-[A-Za-z0-9_-]{16}$/);
});

test("may tu roi key: bo chinh no, tra cho; may truc roi thi truc chuyen; roi lan hai la may_khong_co", async () => {
  const { license } = await dungDichVu();
  const { key } = await license.capKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2027-01-01T00:00:00.000Z" });
  for (const n of [1, 2, 3]) await license.kiemMay({ key, ...MAY(n) });
  assert.equal((await license.kiemMay({ key, ...MAY(4) })).viSao, "da_day");
  const roi = await license.roiMay({ key, maMay: MAY(1).maMay });
  assert.deepEqual(roi, { ok: true, conLai: 2 });
  assert.equal(license.xemKey(key).may.find((m) => m.truc).tenMay, "Máy 2", "may truc roi thi may ke tiep truc");
  assert.equal((await license.kiemMay({ key, ...MAY(4) })).ok, true, "co cho cho may 4");
  assert.equal((await license.roiMay({ key, maMay: MAY(1).maMay })).viSao, "may_khong_co");
  assert.equal((await license.roiMay({ key: "TR-AAAA-AAAA-AAAA-AAAA", maMay: MAY(1).maMay })).viSao, "key_khong_co");
});
