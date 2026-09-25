import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ManualClock, ProductLibrary, cleanLibraryProduct } from "@sp/xeon";
import { recentlyScraped } from "../dist/http/product-library-controller.js";

test("Product Library: de xuat khong ghi de ban da duyet va tra duoc bang ma thay the", () => {
  const library = new ProductLibrary(null, () => new Date("2026-09-17T10:00:00.000Z"));
  const verified = library.approve({ code: "HQ2053", aliases: ["HQ-2053"], name: "Adizero Boston 12", brand: "adidas", category: "shoe" }, "admin");
  assert.equal(verified.status, "verified");
  assert.equal(library.lookup("hq-2053").product?.code, "HQ2053");
  assert.deepEqual(library.lookupMany(["HQ2053", "hq-2053", "khong-co"]).map((x) => [x.code, x.product?.code ?? null]), [["HQ2053", "HQ2053"], ["HQ-2053", "HQ2053"], ["KHONG-CO", null]]);
  assert.throws(() => library.propose({ code: "HQ2053", name: "ten rac" }), /đã duyệt/);
});

test("Product Library: mau uu tien dong, roi hang, roi nhom", () => {
  const library = new ProductLibrary(null);
  library.saveTemplate({ id: "shoe", category: "shoe", defaults: { gender: "unisex" } });
  library.saveTemplate({ id: "adidas", brand: "adidas", category: "shoe", defaults: { description: "Hang adidas" } });
  library.saveTemplate({ id: "boston", brand: "adidas", line: "Boston", category: "shoe", defaults: { description: "Dong Boston" } });
  library.approve({ code: "A1", brand: "adidas", line: "Boston", category: "shoe" }, "admin");
  assert.equal(library.lookup("A1").template?.id, "boston");
});

test("Product Library: chan PII va chi nhan media HTTPS co nguon", () => {
  assert.throws(() => cleanLibraryProduct({ code: "A1", description: "Gọi 0912345678" }), /not clean|không/i);
  const p = cleanLibraryProduct({ code: "A1", media: [{ sourceUrl: "http://x/a.jpg", storageUrl: "https://cdn/a.jpg" }] });
  assert.equal(p.media.length, 0);
});

test("Product Library: worker chi dien o trong va thay dung asset hong", () => {
  const library = new ProductLibrary(null, () => new Date("2026-09-20T10:00:00.000Z"));
  const source = { url: "https://brand.example/product", provider: "brand", observedAt: "2026-09-20T00:00:00Z" };
  library.approve({ code: "BAG1", name: "Ten shop giu", media: [{ id: "old", role: "primary", sourceUrl: "https://brand.example/old.jpg", assetUrl: "https://cdn/old.jpg", source }] }, "admin");
  const merged = library.mergeWorkerResult({ code: "BAG1", name: "Ten worker", sport: "running", material: "nylon", physicalDimensions: { length: "30", unit: "cm" }, media: [{ id: "new", role: "primary", sourceUrl: "https://brand.example/new.jpg", assetUrl: "https://cdn/new.jpg", source }] }, ["https://cdn/old.jpg"]);
  assert.equal(merged.name, "Ten shop giu");
  assert.equal(merged.sport, "running");
  assert.equal(merged.material, "nylon");
  assert.equal(merged.physicalDimensions.length, "30");
  assert.deepEqual(merged.media.map((m) => m.assetUrl), ["https://cdn/new.jpg"]);
});

test("Product Library: phuc hoi asset tu ban local bang noi dung bam", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xeon-assets-"));
  try {
    const library = new ProductLibrary(directory);
    const bytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const recovered = library.recoverAsset("A1", "https://cdn/dead.png", bytes, "https://xeon.example");
    assert.match(recovered.assetId, /^ast_[a-f0-9]{64}$/);
    assert.deepEqual(library.readAsset(path.basename(recovered.path))?.data, bytes);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});


test("Thu vien: worker cao xong thi dong dau scrapedAt — ca khi khong tim ra tam anh nao", () => {
  const clock = new ManualClock(new Date("2026-09-24T02:00:00.000Z"));
  const library = new ProductLibrary(null, () => clock.now());

  // 508 ma sang 24/09/2026 la nhu the nay: cao xong, khong ra anh nao. Khong nho lai thi lan bam
  // sau chung lai thanh viec moi tinh, mo Chrome, di tam IP, de roi lai khong thay gi.
  const trot = library.mergeWorkerResult({ code: "HZ6890", media: [] });
  assert.equal(trot.media.length, 0);
  assert.equal(trot.scrapedAt, "2026-09-24T02:00:00.000Z", "khong tim thay cung phai nho la DA tim");

  clock.advance(60_000);
  const source = { url: "https://shop.example/hz6890", provider: "dealer", observedAt: "2026-09-24T02:01:00.000Z" };
  const lanHai = library.mergeWorkerResult({ code: "HZ6890", media: [{ id: "m1", role: "primary", sourceUrl: "https://shop.example/a.jpg", assetUrl: "https://cdn.example/a.jpg", source }] });
  assert.equal(lanHai.media.length, 1);
  assert.equal(lanHai.scrapedAt, "2026-09-24T02:01:00.000Z", "moi lan cao xong deu doi dau");

  // Dau phai song qua moi lan lam sach ban ghi, neu khong thi tri nho mat ngay luc ghi xuong dia.
  assert.equal(cleanLibraryProduct(lanHai, lanHai.updatedAt).scrapedAt, "2026-09-24T02:01:00.000Z");
});

test("Thu vien: ma vua cao trong vong bay ngay thi khong xep hang lai", () => {
  const vuaCao = { scrapedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() };
  const cao10NgayTruoc = { scrapedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() };

  assert.equal(recentlyScraped(vuaCao), true, "hai ngay truoc: de nguon hang kip co them anh da");
  assert.equal(recentlyScraped(cao10NgayTruoc), false, "qua han thi hoi lai mot lan nua");
  assert.equal(recentlyScraped(null), false, "chua he cao thi phai cao");
  assert.equal(recentlyScraped({}), false, "ban ghi cu chua co dau thi cu cao nhu truoc");
  assert.equal(recentlyScraped({ scrapedAt: "khong phai ngay" }), false, "dau hong thi coi nhu chua cao");
});


test("Thu vien: dia chi anh thieu moi ten giao thuc (`//host/...`) duoc doc la https, khong bi vut", () => {
  const trang = "//adidas-phoenix.com.vn/products/giay-thoi-trang-samba-og-adidas-nam-b75807";
  const anh = "//product.hstatic.net/200000477321/product/samba_og_shoes_black_b75807.jpg";
  const source = { url: trang, provider: "dealer", observedAt: "2026-09-24T06:00:00.000Z" };

  // 24/09/2026: 62 ma mat sach anh o day. Worker tai duoc tep ve `worker-results/` — B75807 co hai
  // tep .jpg tu 23/09 — con thu vien ghi 0 anh, vi dealer viet moi the anh theo kieu protocol-relative.
  const p = cleanLibraryProduct({
    code: "B75807", sources: [source],
    media: [{ id: "m1", role: "primary", sourceUrl: anh, assetUrl: anh, source }]
  }, "2026-09-24T06:00:00.000Z");

  assert.equal(p.media.length, 1, "anh tim duoc that thi khong duoc vut");
  assert.equal(p.media[0]?.assetUrl, `https:${anh}`);
  assert.equal(p.sources[0]?.url, `https:${trang}`);

  // Ca B75807 that su chet vi `http://`, khong phai `//`: engine lay dung the meta `http://` duy
  // nhat cua trang. Anh thi nang len https — tai qua https ra du 15.760 byte.
  const anhHttp = cleanLibraryProduct({
    code: "B75807", sources: [source],
    media: [{ id: "m1", role: "primary", sourceUrl: "http://product.hstatic.net/200000477321/product/samba.jpg", assetUrl: "http://product.hstatic.net/200000477321/product/samba.jpg", source }]
  }, "2026-09-24T06:00:00.000Z");
  assert.equal(anhHttp.media.length, 1, "anh http:// duoc nang len https, khong bi vut");
  assert.equal(anhHttp.media[0]?.assetUrl, "https://product.hstatic.net/200000477321/product/samba.jpg");

  // Trang nguon thi KHONG nang: no la dau vet de nguoi doi chieu, ghi mot dia chi khong ton tai
  // con te hon la khong ghi.
  const trangHttp = cleanLibraryProduct({
    code: "X1", sources: [{ url: "http://dealer.example/x1", provider: "dealer", observedAt: "" }]
  }, "2026-09-24T06:00:00.000Z");
  assert.equal(trangHttp.sources.length, 0, "trang nguon http:// van bi tu choi");
});
