// TRANG QUAN TRI + TRANG MAY tren Xeon, qua HTTP that.
//
// Trang chi la HTML + JS goi API; bai nay kiem API va kiem rang trang thuc su goi dung nhung
// cai id ma HTML co (khong co nut chet), cung cach `omi/test/vo-omi.test.js` lam.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { taoMayChu } = require("../noi/may-chu");
const { taoQuanTri, CSP } = require("../noi/quan-tri");
const { sinhKhoaKy } = require("../license/khoa-ky");
const { taoSoLicense } = require("../license/so-license");
const { taoDichVuLicense } = require("../license/dich-vu");

const T0 = new Date("2026-09-14T08:00:00.000Z");
const MANH = [
  { id: "hang-kho", ten: "Hang hoa & kho", loi: true }, { id: "don-khach", ten: "Don hang", loi: true },
  { id: "gian-hang", ten: "Gian hang", loi: true }, { id: "chatbot-cskh", ten: "Chatbot", loi: false },
  { id: "van-chuyen", ten: "Van chuyen", loi: false }
];
const MAT_KHAU = "mat-khau-cua-anh-dung";

async function dung({ matKhauAdmin = MAT_KHAU } = {}) {
  let t = T0.getTime();
  const gio = { bayGio: () => new Date(t), troi: (ms) => { t += ms; } };
  const khoaKy = sinhKhoaKy();
  const so = await taoSoLicense({ thuMuc: null });
  const license = taoDichVuLicense({ so, khoaKy, gio, manhHopLe: MANH.map((m) => m.id), manhLoi: MANH.filter((m) => m.loi).map((m) => m.id) });
  const canhBao = [];
  const nhatKy = { tin: () => {}, canhBao: (m) => canhBao.push(m) };
  const quanTri = taoQuanTri({ license, matKhauAdmin, danhSachManh: MANH, gio, nhatKy });
  const mayChu = taoMayChu({ xuLyTin: async () => ({}), license, nhatKy, gio, quanTri });
  await new Promise((r) => mayChu.listen(0, "127.0.0.1", r));
  const goc = `http://127.0.0.1:${mayChu.address().port}`;
  let cookie = "";
  const goi = async (duong, { method = "GET", than, tieuDe = {}, khongCookie = false } = {}) => {
    const tl = await fetch(`${goc}${duong}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie && !khongCookie ? { Cookie: cookie } : {}), ...tieuDe },
      body: than === undefined ? undefined : JSON.stringify(than),
      redirect: "manual"
    });
    const sc = tl.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const kieu = tl.headers.get("content-type") || "";
    return { ma: tl.status, tieuDe: tl.headers, than: kieu.includes("json") ? await tl.json() : await tl.text() };
  };
  const post = (duong, than, tuyChon = {}) => goi(duong, { method: "POST", than, tieuDe: { "X-Yeu-Cau": "xeon" }, ...tuyChon });
  return { goi, post, license, gio, canhBao, dong: () => new Promise((r) => mayChu.close(r)) };
}

test("trang HTML/JS/CSS duoc phuc vu voi CSP chat; moi el(...) trong JS co that trong HTML", async () => {
  const { goi, dong } = await dung();
  try {
    for (const [duong, kieu] of [["/quan-tri", "text/html"], ["/quan-tri/app.js", "text/javascript"], ["/quan-tri/chung.css", "text/css"], ["/may", "text/html"], ["/may/app.js", "text/javascript"]]) {
      const r = await goi(duong);
      assert.equal(r.ma, 200, duong);
      assert.ok(r.tieuDe.get("content-type").startsWith(kieu), duong);
      assert.equal(r.tieuDe.get("content-security-policy"), CSP);
    }
    const thuMuc = path.join(__dirname, "..", "noi", "trang");
    for (const [html, js] of [["quan-tri.html", "quan-tri.js"], ["may.html", "may.js"]]) {
      const h = fs.readFileSync(path.join(thuMuc, html), "utf8");
      const j = fs.readFileSync(path.join(thuMuc, js), "utf8");
      assert.ok(!/<script>|<style>|\son[a-z]+="|\sstyle="/.test(h), `${html}: khong inline script/style/handler (CSP chan het)`);
      const ids = [...j.matchAll(/el\("([a-z0-9-]+)"\)/g)].map((m) => m[1]);
      assert.ok(ids.length > 5);
      for (const id of new Set(ids)) assert.ok(h.includes(`id="${id}"`), `${js} goi el("${id}") nhung ${html} khong co`);
    }
  } finally { await dong(); }
});

test("quan tri: chua dang nhap 401; thieu tieu de X-Yeu-Cau 403; sai mat khau 401 va bi dem; dung thi co cookie HttpOnly SameSite=Strict", async () => {
  const { goi, post, canhBao, dong } = await dung();
  try {
    assert.equal((await goi("/quan-tri/api/toi")).than.dangNhap, false);
    assert.equal((await post("/quan-tri/api/key/danh-sach", {})).ma, 401);
    assert.equal((await goi("/quan-tri/api/dang-nhap", { method: "POST", than: { matKhau: MAT_KHAU } })).ma, 403, "khong co tieu de rieng");

    const sai = await post("/quan-tri/api/dang-nhap", { matKhau: "sai" });
    assert.equal(sai.ma, 401);
    assert.match(canhBao.at(-1), /dang nhap sai/);

    const dn = await post("/quan-tri/api/dang-nhap", { matKhau: MAT_KHAU });
    assert.equal(dn.ma, 200);
    const sc = dn.tieuDe.get("set-cookie");
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /SameSite=Strict/);
    assert.match(sc, /Path=\/quan-tri/);
    assert.equal((await goi("/quan-tri/api/toi")).than.dangNhap, true);
    assert.equal((await post("/quan-tri/api/key/danh-sach", {})).ma, 200);

    await post("/quan-tri/api/dang-xuat", {});
    assert.equal((await post("/quan-tri/api/key/danh-sach", {})).ma, 401, "dang xuat la het");
  } finally { await dong(); }
});

test("dang nhap sai 10 lan trong 15 phut thi 429, ke ca mat khau dung", async () => {
  const { post, gio, dong } = await dung();
  try {
    for (let i = 0; i < 10; i += 1) assert.equal((await post("/quan-tri/api/dang-nhap", { matKhau: "sai" })).ma, 401);
    assert.equal((await post("/quan-tri/api/dang-nhap", { matKhau: MAT_KHAU })).ma, 429);
    gio.troi(15 * 60 * 1000 + 1);
    assert.equal((await post("/quan-tri/api/dang-nhap", { matKhau: MAT_KHAU })).ma, 200);
  } finally { await dong(); }
});

test("phien admin het sau 12 gio", async () => {
  const { post, gio, dong } = await dung();
  try {
    await post("/quan-tri/api/dang-nhap", { matKhau: MAT_KHAU });
    gio.troi(11 * 3600 * 1000);
    assert.equal((await post("/quan-tri/api/key/danh-sach", {})).ma, 200);
    gio.troi(2 * 3600 * 1000);
    assert.equal((await post("/quan-tri/api/key/danh-sach", {})).ma, 401);
  } finally { await dong(); }
});

test("mat khau admin ngan hon 12 ky tu: trang quan tri TAT (503), /toi noi ro bat=false", async () => {
  const { goi, post, canhBao, dong } = await dung({ matKhauAdmin: "ngan" });
  try {
    assert.match(canhBao[0], /DANG TAT/);
    assert.equal((await goi("/quan-tri/api/toi")).than.bat, false);
    assert.equal((await post("/quan-tri/api/dang-nhap", { matKhau: "ngan" })).ma, 503);
  } finally { await dong(); }
});

test("vong day du cua anh: cap key -> xem -> doi manh -> gia han -> da may -> chon truc -> khoa -> mo", async () => {
  const { post, license, dong } = await dung();
  try {
    await post("/quan-tri/api/dang-nhap", { matKhau: MAT_KHAU });
    const loi = await post("/quan-tri/api/key/cap", { shop: "TopRun!", tenShop: "x", hetHan: "2027-01-01T00:00:00.000Z" });
    assert.equal(loi.ma, 400);
    assert.match(loi.than.message, /Ma shop/);

    const cap = await post("/quan-tri/api/key/cap", { shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z", soMay: 2 });
    assert.equal(cap.ma, 200);
    assert.match(cap.than.key, /^TR-/);
    assert.equal(cap.than.chiTiet.soMay, 2);
    const key = cap.than.key;

    const ds = await post("/quan-tri/api/key/danh-sach", {});
    assert.equal(ds.than.key.length, 1);
    assert.equal(ds.than.key[0].shop, "toprun");

    assert.equal((await post("/quan-tri/api/key/manh", { key, manh: ["chatbot-cskh", "van-chuyen"] })).than.ok, true);
    assert.deepEqual(license.xemKey(key).manh, ["chatbot-cskh", "don-khach", "gian-hang", "hang-kho", "van-chuyen"]);
    assert.equal((await post("/quan-tri/api/key/manh", { key, manh: ["la"] })).ma, 400);
    assert.equal((await post("/quan-tri/api/key/gia-han", { key, hetHan: "2028-01-01T00:00:00.000Z" })).than.ok, true);
    assert.equal(license.xemKey(key).hetHan, "2028-01-01T00:00:00.000Z");

    await license.kiemMay({ key, maMay: "may-mot-xxxxxxxxxxxx", tenMay: "Máy 1" });
    await license.kiemMay({ key, maMay: "may-hai-xxxxxxxxxxxx", tenMay: "Máy 2" });
    const may = license.xemKey(key).may;
    assert.equal((await post("/quan-tri/api/key/may-truc", { key, mayId: may[1].id })).than.ok, true);
    assert.equal(license.xemKey(key).may[1].truc, true);
    const da = await post("/quan-tri/api/key/da-may", { key, mayId: may[1].id });
    assert.equal(da.than.ok, true);
    assert.equal(da.than.may.length, 1);
    assert.equal(da.than.may[0].truc, true, "truc chuyen ve may con lai");

    assert.equal((await post("/quan-tri/api/key/khoa", { key, lyDo: "test" })).than.ok, true);
    assert.equal(license.xemKey(key).trangThai, "bi_khoa");
    assert.equal((await post("/quan-tri/api/key/mo", { key })).than.ok, true);
    assert.equal(license.xemKey(key).trangThai, "dang_dung");
    assert.equal((await post("/quan-tri/api/key/khong-co", {})).ma, 404);
  } finally { await dong(); }
});

test("trang may cua chu key: key la thu xac thuc; xem, da, chon truc; key sai 403; thieu tieu de 403; goi don 429; khong lo ma may", async () => {
  const { goi, post, license, gio, dong } = await dung();
  try {
    const { key } = await license.capKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2027-01-01T00:00:00.000Z" });
    for (const n of [1, 2, 3]) await license.kiemMay({ key, maMay: `may-${n}-xxxxxxxxxxxxxxxx`, tenMay: `Máy ${n}` });

    assert.equal((await goi("/may/api/xem", { method: "POST", than: { key } })).ma, 403, "thieu X-Yeu-Cau");
    assert.equal((await post("/may/api/xem", { key: "TR-AAAA-AAAA-AAAA-AAAA" })).ma, 403);
    const xem = await post("/may/api/xem", { key });
    assert.equal(xem.ma, 200);
    assert.equal(xem.than.tenShop, "TopRun");
    assert.equal(xem.than.may.length, 3);
    assert.equal(xem.than.may[0].truc, true);
    assert.ok(!JSON.stringify(xem.than).includes("may-1-xxxx"), "khong lo ma may day du");

    const id3 = xem.than.may[2].id;
    assert.equal((await post("/may/api/truc", { key, mayId: id3 })).than.ok, true);
    assert.equal(license.coTruc({ key, maMay: "may-3-xxxxxxxxxxxxxxxx" }).truc, true);
    const da = await post("/may/api/da", { key, mayId: xem.than.may[0].id });
    assert.equal(da.than.ok, true);
    assert.equal(da.than.may.length, 2);
    assert.equal((await license.kiemMay({ key, maMay: "may-4-xxxxxxxxxxxxxxxx", tenMay: "Máy 4" })).ok, true, "da xong thi may thu tu vao");

    for (let i = 0; i < 27; i += 1) await post("/may/api/xem", { key });
    assert.equal((await post("/may/api/xem", { key })).ma, 429);
    gio.troi(15 * 60 * 1000 + 1);
    assert.equal((await post("/may/api/xem", { key })).ma, 200);
  } finally { await dong(); }
});
