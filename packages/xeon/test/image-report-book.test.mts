/**
 * Ảnh báo sai (04/10/2026, anh chốt mockup JqdSZxWYSkeGKmsguZqX9K): shop báo sai → ảnh tạm ẩn ở mọi shop
 * chờ duyệt → ảnh chuẩn thì trả lại, sai thì chặn hẳn; hàng nhái một lần là chặn trang nguồn, lý do
 * khác hạ bậc khi đủ ba mã; mỗi shop một ngày có trần lời báo có tác dụng mọi shop.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  ImageReportBook, ImageSourceDirectory, INDUSTRY_DIRECTORY, LicenseLedger, LicenseService, ManualClock, MemoryLogger, ProductLibrary,
  createXeonServer, generateSigningKey, imageKey, matchesDomain, parseSourceLists
} from "@sp/xeon";
import { ProductLibraryController } from "../dist/http/product-library-controller.js";
import { checkBlocksFree } from "@sp/brain";

const T0 = new Date("2026-10-04T03:00:00.000Z");
const img = (key: string, extra: Partial<{ trang: string; host: string; hang: string; maCung: string[] }> = {}) => ({
  key, assets: [`https://${key}`], anh: `https://${key}`, trang: extra.trang ?? "", host: extra.host ?? "", hang: extra.hang ?? "", maCung: extra.maCung ?? []
});

test("Danh tinh tam anh bo tham so; mau ten mien khop dau ten mien hoac sau dau cham", () => {
  assert.equal(imageKey("https://WWW.Shop.test/a/b.JPG?v=12&width=1000"), "shop.test/a/b.jpg");
  assert.equal(imageKey("//cdn.test/x.png#y"), "cdn.test/x.png");
  assert.equal(imageKey("khong-phai-url"), "");
  assert.ok(matchesDomain("https://www.supersports.com.vn/p/1", "supersport"));
  assert.ok(matchesDomain("https://shop.hang-a.test/x", "hang-a.test"));
  assert.ok(!matchesDomain("https://salomon.com/x", "on.com"), "on.com khong khop salomon.com");
});

test("Tang 1 — danh sach nguon doc tu nganh gia: chinh hang, dai ly, trang khac; tep hong thi bao", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nganh-gia-"));
  try {
    fs.mkdirSync(path.join(dir, "nganh-x"));
    fs.writeFileSync(path.join(dir, "nganh-x", "bo-luat.json"), "{}");
    fs.writeFileSync(path.join(dir, "nganh-x", "nguon-anh.json"), JSON.stringify({ chinhHang: { "hang a": ["hang-a.test"] }, daiLy: ["dai-ly.test"] }));
    const sources = new ImageSourceDirectory(dir);
    assert.equal(sources.baseTier("https://www.hang-a.test/sp/1"), "chinh");
    assert.equal(sources.baseTier("https://dai-ly.test/sp/1"), "daily");
    assert.equal(sources.baseTier("https://la.test/sp/1"), "khac");
    assert.equal(sources.baseTier(""), "khac");
    assert.ok(parseSourceLists({ daiLy: ["co dau cach"] }, "x").problems.length > 0);
    assert.equal(new ImageSourceDirectory(null).baseTier("https://hang-a.test/"), "khac", "khong co nganh: moi trang la trang khac");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Tang 2 — goi nganh giay chay that: trang chinh hang va dai ly da biet", () => {
  const sources = new ImageSourceDirectory(INDUSTRY_DIRECTORY);
  assert.equal(sources.baseTier("https://www.adidas.com.vn/en/japan-shoes/KJ6158.html"), "chinh");
  assert.equal(sources.baseTier("https://supersports.com.vn/products/ao-ba-lo-nu-adidas-stadium-kb4962-white"), "daily");
  assert.equal(sources.baseTier("https://artpuzzle.vn/products/mo-hinh"), "khac");
  // Bộ soi tầng 1–2: tệp ngành không mang con số / chính sách của một shop.
  const raw = JSON.parse(fs.readFileSync(path.join(INDUSTRY_DIRECTORY, "giay-chay", "nguon-anh.json"), "utf8")) as { moTa: string };
  assert.deepEqual(checkBlocksFree([{ id: "moTa", loiDan: raw.moTa }], "nguon-anh.json"), []);
  assert.deepEqual(parseSourceLists(raw, "nguon-anh.json").problems, []);
});

test("So bao sai: tam an moi shop, tran ngay, rut bao, y kien, bao lai sau khi tra", () => {
  const clock = new ManualClock(T0);
  const book = new ImageReportBook(null, () => clock.now());
  const first = book.report({ shop: "a", code: "x1", images: [img("cdn.test/1.jpg", { maCung: ["X2"] })], lyDo: "banner", ghiChu: "" }, 1);
  assert.equal(first[0]!.hieuLuc, "moi-shop");
  assert.equal(book.remainingToday("a", 1), 0);
  const second = book.report({ shop: "a", code: "x1", images: [img("cdn.test/2.jpg")], lyDo: "xau", ghiChu: "" }, 1);
  assert.equal(second[0]!.hieuLuc, "chi-shop", "qua tran ngay: chi an o shop bao");
  assert.throws(() => book.report({ shop: "a", code: "x1", images: [img("cdn.test/3.jpg")], lyDo: "khong-co", ghiChu: "" }, 1), /Lý do/);

  const feedB = book.feedFor("b");
  assert.deepEqual(feedB.map((f) => [f.key, f.trangThai, f.cuaShop]), [["cdn.test/1.jpg", "tam-an", false]], "shop khac chi thay ca co tac dung moi shop");
  assert.deepEqual(feedB[0]!.maCung, ["X1", "X2"]);
  assert.equal(book.feedFor("a").length, 2, "shop bao thay ca hai");

  assert.equal(book.object("a", first[0]!.id), false, "shop bao khong phan doi chinh minh");
  assert.equal(book.object("b", first[0]!.id), true);
  assert.equal(book.get(first[0]!.id)!.phanDoi.length, 1);

  // Báo lại đúng tấm của mình: không tính thêm lần.
  clock.advance(24 * 60 * 60 * 1000);
  book.report({ shop: "a", code: "x1", images: [img("cdn.test/1.jpg")], lyDo: "banner", ghiChu: "" }, 1);
  assert.equal(book.remainingToday("a", 1), 1, "bao trung khong dem");

  assert.equal(book.withdraw("a", ["cdn.test/2.jpg"]), 1);
  assert.equal(book.byKey("cdn.test/2.jpg")!.trangThai, "da-rut");
  assert.deepEqual(book.feedFor("a").find((f) => f.key === "cdn.test/2.jpg")?.trangThai, "tra-lai", "rut het nguoi bao thi anh ve lai");

  book.ack("b", { [first[0]!.id]: 3 });
  assert.deepEqual(book.get(first[0]!.id)!.apDung, { b: 3 });
  book.ack("b", { [first[0]!.id]: 0 });
  assert.deepEqual(book.get(first[0]!.id)!.apDung, {});

  const decided = book.decide(first[0]!.id, true, "toprun");
  assert.equal(decided.entry.trangThai, "da-tra");
  assert.throws(() => book.decide(first[0]!.id, false, "toprun"), /đã được xử lý/);
  assert.equal(book.feedFor("b")[0]!.trangThai, "tra-lai");
  const again = book.report({ shop: "c", code: "X2", images: [img("cdn.test/1.jpg")], lyDo: "sai-mau", ghiChu: "" }, 30);
  assert.equal(again[0]!.id, first[0]!.id, "chung mot ca theo tam anh");
  assert.equal(book.get(first[0]!.id)!.trangThai, "cho-duyet", "bao lai thi mo lai");
  assert.deepEqual(book.get(first[0]!.id)!.nguoiBao.map((r) => r.shop), ["c"]);

  clock.advance(31 * 24 * 60 * 60 * 1000);
  assert.equal(book.feedFor("a").some((f) => f.key === "cdn.test/2.jpg"), false, "ca tra lai qua 30 ngay roi khoi luong");
});

test("So bao sai: chan han, uy tin trang nguon theo hang, hang nhai chan trang", () => {
  const book = new ImageReportBook(null, () => T0);
  const wrong = (code: string, key: string, lyDo = "sai-mau", host = "dai-ly.test", hang = "Hang A") =>
    book.decide(book.report({ shop: "a", code, images: [img(key, { trang: `https://${host}/${code}`, host, hang })], lyDo, ghiChu: "" }, 30)[0]!.id, false, "toprun");
  const r1 = wrong("M1", "dai-ly.test/1.jpg");
  assert.equal(r1.entry.trangThai, "da-chan");
  assert.deepEqual(r1.source!.maSai, ["M1"]);
  assert.equal(book.feedFor("b")[0]!.trangThai, "chan");
  wrong("M1", "dai-ly.test/1b.jpg");
  assert.equal(book.effectiveTier("dai-ly.test", "hang a", "daily"), "daily", "cung ma chi tinh mot");
  wrong("M2", "dai-ly.test/2.jpg");
  wrong("M3", "dai-ly.test/3.jpg");
  assert.equal(book.effectiveTier("dai-ly.test", "Hang A", "daily"), "khac", "du ba ma: ha mot bac");
  assert.equal(book.effectiveTier("dai-ly.test", "hang b", "daily"), "daily", "theo tung hang");

  wrong("N1", "nhai.test/1.jpg", "nhai", "nhai.test", "Hang A");
  assert.equal(book.effectiveTier("nhai.test", "hang a", "daily"), "chan", "hang nhai mot lan: chan trang");

  // Thẩm định ảnh: chặn hẳn, trang bị chặn, ảnh mới từ trang của ca chưa trả.
  const v = (url: string, pageUrl: string, fresh: boolean, code = "M9", brand = "Hang A", tenant: string | null = null) => book.verdict({ code, brand, url, pageUrl, tenant, fresh });
  assert.equal(v("https://dai-ly.test/1.jpg?v=2", "", false), "bo");
  assert.equal(v("https://nhai.test/9.jpg", "https://nhai.test/p/9", false), "bo");
  assert.equal(v("https://nhai.test/9.jpg", "https://nhai.test/p/9", false, "M9", "Hang C"), "giu", "chan theo hang");
  const pending = book.report({ shop: "a", code: "P1", images: [img("trang-p.test/a.jpg", { trang: "https://trang-p.test/p1", host: "trang-p.test" })], lyDo: "banner", ghiChu: "" }, 30);
  assert.equal(v("https://trang-p.test/a.jpg", "https://trang-p.test/p1", false, "P1"), "an");
  assert.equal(v("https://trang-p.test/b.jpg", "https://trang-p.test/p1", false, "P1"), "giu", "anh khac cung trang da co thi giu");
  assert.equal(v("https://trang-p.test/c.jpg", "https://trang-p.test/p1?x=1", true, "P1"), "bo", "tim lai: bo qua trang vua bi bao");
  assert.equal(v("https://trang-p.test/c.jpg", "https://trang-p.test/p1", true, "P9"), "giu", "ma khac thi khong");
  book.decide(pending[0]!.id, true, "toprun");
  assert.equal(v("https://trang-p.test/a.jpg", "https://trang-p.test/p1", false, "P1"), "giu", "anh chuan: tra lai");
});

test("Thu vien: anh tam an khong chiem cho trong muoi anh; anh chan bi bo; anh moi tu trang bi bao bi bo", () => {
  const book = new ImageReportBook(null, () => T0);
  const library = new ProductLibrary(null, () => T0);
  library.setMediaGate((product, media, fresh) => book.verdict({ code: product.code, brand: product.brand, url: media.sourceUrl, pageUrl: media.source.url, tenant: null, fresh }));
  const media = (n: number, host = "nguon.test", page = "https://nguon.test/p") => ({ id: `m${n}`, role: "gallery", order: n, sourceUrl: `https://${host}/${n}.jpg`, assetUrl: `https://${host}/${n}.jpg`, source: { url: page, provider: "dealer" } });
  library.mergeWorkerResult({ code: "L1", brand: "Hang A", media: Array.from({ length: 10 }, (_, i) => media(i)) });
  const r = book.report({ shop: "a", code: "L1", images: [0, 1, 2].map((i) => img(`nguon.test/${i}.jpg`, { trang: "https://nguon.test/p", host: "nguon.test" })), lyDo: "sai-mau", ghiChu: "" }, 30);
  book.decide(r[2]!.id, false, "toprun");
  const merged = library.mergeWorkerResult({ code: "L1", media: [media(20, "moi.test", "https://moi.test/p"), media(21, "moi.test", "https://moi.test/p"), media(22, "nguon.test", "https://nguon.test/p")] });
  const urls = merged.media.map((m) => m.sourceUrl);
  assert.ok(!urls.includes("https://nguon.test/2.jpg"), "anh chan bi bo khoi thu vien");
  assert.ok(urls.includes("https://nguon.test/0.jpg") && urls.includes("https://nguon.test/1.jpg"), "anh tam an van giu de tra lai");
  assert.ok(urls.includes("https://moi.test/20.jpg") && urls.includes("https://moi.test/21.jpg"), "anh moi vao cho trong");
  assert.ok(!urls.includes("https://nguon.test/22.jpg"), "anh moi tu trang bi bao bi bo");
  assert.equal(merged.media.filter((m) => book.verdict({ code: "L1", brand: "Hang A", url: m.sourceUrl, pageUrl: m.source.url, tenant: null, fresh: false }) === "giu").length, 9);
});

test("Bao anh sai qua HTTP that: shop bao, shop khac khong nhan anh, toprun duyet, nguon tung anh, bang uy tin", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anh-bao-sai-"));
  const clock = new ManualClock(T0);
  const license = new LicenseService({ ledger: await LicenseLedger.open(), signingKey: generateSigningKey(), clock, xeonAddress: "https://xeon.test", sellableModules: ["hang-kho"], coreModules: ["hang-kho"] });
  const inbox: Record<string, string> = {};
  for (const shop of ["sadida", "toprun", "khac"]) {
    const issued = await license.issueKey({ shop, tenShop: shop, manh: ["hang-kho"], hetHan: "2027-01-01T00:00:00.000Z" });
    const reg = await license.registerLanding({ key: issued.key, diaChi: `https://${shop}.test` });
    if (!reg.ok) throw new Error("dang ky landing hong");
    inbox[shop] = reg.maNhanTin;
  }
  const library = new ProductLibrary(dir, () => clock.now());
  const reports = new ImageReportBook(dir, () => clock.now());
  library.setMediaGate((product, media, fresh) => reports.verdict({ code: product.code, brand: product.brand, url: media.sourceUrl, pageUrl: media.source.url, tenant: null, fresh }));
  const banner = "https://cdn.shop-cdn.test/files/khung-km.png?v=1";
  const page = "https://supersports.com.vn/products/kb4962";
  library.mergeWorkerResult({ code: "KB4962", brand: "adidas", media: [
    { id: "a", role: "primary", order: 0, sourceUrl: banner, assetUrl: banner, source: { url: page, provider: "dealer" } },
    { id: "b", role: "gallery", order: 1, sourceUrl: "https://supersports.com.vn/cdn/KB4962-2.jpg", assetUrl: "https://supersports.com.vn/cdn/KB4962-2.jpg", source: { url: page, provider: "dealer" } }
  ] });
  library.mergeWorkerResult({ code: "KB4961", brand: "adidas", media: [{ id: "c", role: "primary", order: 0, sourceUrl: banner.replace("v=1", "v=2"), assetUrl: banner, source: { url: "https://supersports.com.vn/products/kb4961", provider: "dealer" } }] });
  let changes = 0;
  const server = createXeonServer({ controllers: [new ProductLibraryController({ library, license, logger: new MemoryLogger(), reports, sources: new ImageSourceDirectory(INDUSTRY_DIRECTORY), reviewers: ["toprun"], dailyReportLimit: 30, onReportsChanged: () => { changes += 1; } })] });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (p: string, token: string, body: unknown) => new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request(`${origin}${p}`, { method: "POST", agent: false, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }, (res) => {
      let raw = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: raw.startsWith("{") ? JSON.parse(raw) as Record<string, unknown> : {} }));
    });
    req.on("error", reject); req.end(JSON.stringify(body));
  });
  const mediaOf = async (shop: string, code: string) => ((await post("/thu-vien-san-pham/tra-nhieu", inbox[shop]!, { ma: [code] })).json["ketQua"] as { product: { media: { assetUrl: string }[] } }[])[0]!.product.media.map((m) => m.assetUrl);
  try {
    const nguon = await post("/thu-vien-san-pham/nguon-anh/cua-ma", inbox.toprun!, { ds: [{ ma: "KB4962", anh: [banner, "https://toprun.test/api/hang-kho/anh/tu-tai.jpg"] }] });
    const row = (nguon.json["ds"] as { anh: { bac: string; host: string; trangThai: string }[] }[])[0]!;
    assert.deepEqual(row.anh.map((a) => [a.bac, a.host, a.trangThai]), [["daily", "supersports.com.vn", ""], ["", "", ""]], "anh shop tu tai khong co trong thu vien");

    const bao = await post("/thu-vien-san-pham/bao-sai", inbox.toprun!, { ma: "KB4962", anh: [banner], lyDo: "banner", ghiChu: "khung khuyen mai" });
    const ca = (bao.json["baoCao"] as { id: string; hieuLuc: string }[])[0]!;
    assert.equal(ca.hieuLuc, "moi-shop");
    assert.equal(bao.json["conLaiHomNay"], 29);
    assert.equal(changes, 1, "go cua landing");
    assert.equal((await post("/thu-vien-san-pham/bao-sai", "ma-bia", { ma: "KB4962", anh: [banner], lyDo: "banner" })).status, 401);

    assert.deepEqual(await mediaOf("khac", "KB4962"), ["https://supersports.com.vn/cdn/KB4962-2.jpg"], "shop khac khong nhan anh dang bi bao");
    assert.deepEqual(await mediaOf("khac", "KB4961"), [], "cung tam o ma khac cung an");
    const feed = await post("/thu-vien-san-pham/anh-bao-sai/trang-thai", inbox.khac!, { apDung: { [ca.id]: 2 } });
    const entry = (feed.json["ds"] as { id: string; trangThai: string; maCung: string[]; assets: string[]; cuaShop: boolean }[])[0]!;
    assert.deepEqual([entry.trangThai, entry.cuaShop], ["tam-an", false]);
    assert.deepEqual(entry.maCung.sort(), ["KB4961", "KB4962"]);
    assert.ok(entry.assets.includes(banner));

    assert.equal((await post("/thu-vien-san-pham/y-kien", inbox.sadida!, { id: ca.id })).json["daGhi"], true);
    assert.equal((await post("/thu-vien-san-pham/anh-bao-sai/danh-sach", inbox.sadida!, {})).json["duocDuyet"], false);
    assert.equal((await post("/thu-vien-san-pham/anh-bao-sai/quyet", inbox.sadida!, { id: ca.id, chuan: false })).status, 403);
    const ds = await post("/thu-vien-san-pham/anh-bao-sai/danh-sach", inbox.toprun!, {});
    const view = (ds.json["ds"] as Record<string, unknown>[])[0]!;
    assert.deepEqual([view["ma"], view["host"], view["bac"], view["soShopDangAn"], (view["phanDoi"] as unknown[]).length, (view["anhKhac"] as unknown[]).length], ["KB4962", "supersports.com.vn", "daily", 1, 1, 1]);

    const quyet = await post("/thu-vien-san-pham/anh-bao-sai/quyet", inbox.toprun!, { id: ca.id, chuan: false });
    assert.equal((quyet.json["ca"] as { trangThai: string }).trangThai, "da-chan");
    assert.equal(changes, 2);
    assert.deepEqual(await mediaOf("sadida", "KB4962"), ["https://supersports.com.vn/cdn/KB4962-2.jpg"]);
    const bang = await post("/thu-vien-san-pham/nguon-anh/danh-sach", inbox.toprun!, {});
    const ss = (bang.json["ds"] as { host: string; hang: string; maSai: number; bac: string }[]).find((r) => r.host === "supersports.com.vn" && r.hang === "adidas")!;
    assert.deepEqual([ss.maSai, ss.bac], [1, "daily"]);
    assert.ok(fs.existsSync(path.join(dir, "anh-bao-sai.json")), "so ghi ra dia");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
