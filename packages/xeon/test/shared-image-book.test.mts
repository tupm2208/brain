/**
 * Ảnh shop chia sẻ (02/10/2026): shop tự chọn chia sẻ → máy chủ ảnh gỡ logo → người duyệt trong OMI
 * → shop KHÁC mới nhận, và chỉ khi máy tìm ảnh đã tìm mà không ra. Shop tắt chia sẻ thì rút hết.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { LicenseLedger, LicenseService, ManualClock, MemoryLogger, ProductLibrary, SharedImageBook, createXeonServer, generateSigningKey } from "@sp/xeon";
import { ProductLibraryController } from "../dist/http/product-library-controller.js";
import { ImageWorkerController } from "../dist/http/image-worker-controller.js";

const T0 = new Date("2026-10-02T03:00:00.000Z");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const report = (id: string, trangThai: string) => ({ id, trangThai, lyDo: "", lop: [], cach: [], vung: [], kiem: {} });

test("So anh chia se: trung thi khong them, lo theo tung shop, het han giu thi quay lai cho", () => {
  const clock = new ManualClock(T0);
  const book = new SharedImageBook(null, () => clock.now());
  assert.deepEqual(book.offer("a", [{ ma: "x1", url: "https://a.test/1.jpg", goc: "//cdn.sapo.test/1.jpg" }, { ma: "x1", url: "https://a.test/1b.jpg", goc: "https://cdn.sapo.test/1.jpg" }, { ma: "", url: "https://a.test/z.jpg" }], ["Shop A", "x"]), { added: 1, known: 1 });
  book.offer("b", [{ ma: "y1", url: "https://b.test/1.jpg" }], []);
  assert.equal(book.pendingLogoCount(), 2);

  const lo = book.claimBatch("w")!;
  assert.equal(lo.anh.length, 1, "mot lo chi mot shop");
  assert.deepEqual(lo.goiY, ["Shop A"], "goi y ngan qua thi bo");
  assert.equal(lo.anh[0]!.goc, "https://cdn.sapo.test/1.jpg");
  assert.throws(() => book.settle("w-khac", lo.id, report(lo.anh[0]!.id, "da-go"), "a.jpg"), /không còn thuộc/);

  clock.advance(31 * 60 * 1000);
  assert.equal(book.pendingLogoCount(), 2, "lo bo do het han thi quay lai cho");
  for (let i = 0; i < 3; i += 1) { book.claimBatch("w"); book.claimBatch("w"); clock.advance(31 * 60 * 1000); book.pendingLogoCount(); }
  assert.equal(book.list({ state: "khong-chia-duoc" }).total, 2, "hong 3 lan thi thoi");
});

test("So anh chia se: ket qua go logo, duyet, nhuong cho shop khac, rut", () => {
  const book = new SharedImageBook(null, () => T0);
  book.offer("a", [1, 2, 3].map((i) => ({ ma: "X1", url: `https://a.test/${i}.jpg` })), []);
  const lo = book.claimBatch("w")!;
  const [p1, p2, p3] = lo.anh.map((x) => x.id);
  assert.equal(book.settle("w", lo.id, report(p1!, "da-go"), "h1.jpg").state, "cho-duyet");
  assert.equal(book.settle("w", lo.id, report(p2!, "khong-go"), "").state, "khong-chia-duoc");
  assert.equal(book.settle("w", lo.id, report(p3!, "loi"), "").state, "cho-go-logo", "loi tai thi thu lai");
  assert.equal(book.decide([p1, p2], true, "toprun"), 1, "chi anh cho duyet moi doi");
  assert.equal(book.approvedFor("x1", "b").length, 1);
  assert.equal(book.approvedFor("X1", "a").length, 0, "shop gui da co ban goc");
  assert.equal(book.withdraw("a"), 3);
  assert.equal(book.approvedFor("X1", "b").length, 0, "rut thi shop khac thoi nhan");
  book.offer("a", [{ ma: "X1", url: "https://a.test/1.jpg" }], []);
  assert.equal(book.list({ state: "cho-go-logo" }).total, 1, "bat lai thi go lai tu dau");
});

test("Anh chia se qua HTTP that: shop gui, may chu anh go, toprun duyet, shop khac nhan khi may tim anh khong ra", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anh-chia-se-"));
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
  library.mergeWorkerResult({ code: "X1", media: [] });                       // máy tìm ảnh đã tìm, không ra
  const shared = new SharedImageBook(dir, () => clock.now());
  let knocks = 0;
  const logger = new MemoryLogger();
  const server = createXeonServer({
    controllers: [
      new ProductLibraryController({ library, license, logger, shared, reviewers: ["toprun"], onShared: () => { knocks += 1; } }),
      new ImageWorkerController({ queue: undefined as never, library, key: "ma-tho", shared })
    ]
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (method: string, p: string, token: string, body?: unknown) => new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request(`${origin}${p}`, { method, agent: false, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }, (res) => {
      let raw = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: raw.startsWith("{") ? JSON.parse(raw) as Record<string, unknown> : {} }));
    });
    req.on("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const post = (p: string, token: string, body: unknown) => call("POST", p, token, body);
  try {
    const gui = await post("/thu-vien-san-pham/chia-se-anh", inbox.sadida!, { anh: [{ ma: "X1", url: "https://sadida.test/a1.jpg", goc: "https://sapo.test/a1.jpg", nguon: "kho-goc" }, { ma: "X1", url: "https://sadida.test/a2.jpg" }], goiY: ["Sadida Sport"] });
    assert.deepEqual([gui.json["them"], knocks], [2, 1]);
    assert.equal((await post("/thu-vien-san-pham/chia-se-anh", "ma-bia", { anh: [] })).status, 401);

    const nhan = await post("/image-worker/logo-nhan", "ma-tho", { worker: "w-logo" });
    const lo = nhan.json["lo"] as { id: string; goiY: string[]; anh: { id: string }[] };
    assert.deepEqual(lo.goiY, ["Sadida Sport"]);
    const xong1 = await post("/image-worker/logo-xong", "ma-tho", { worker: "w-logo", lo: lo.id, ketQua: report(lo.anh[0]!.id, "da-go"), anhBase64: JPEG.toString("base64"), dinhDang: "jpg" });
    assert.equal(xong1.json["trangThai"], "cho-duyet");
    const xong2 = await post("/image-worker/logo-xong", "ma-tho", { worker: "w-logo", lo: lo.id, ketQua: { ...report(lo.anh[1]!.id, "khong-go"), lyDo: "logo cham vao san pham" } });
    assert.equal(xong2.json["trangThai"], "khong-chia-duoc");

    // Chưa duyệt: shop khác chưa nhận gì.
    const truoc = await post("/thu-vien-san-pham/tra-nhieu", inbox.khac!, { ma: ["X1"] });
    assert.equal(((truoc.json["ketQua"] as { product: { media: unknown[] } }[])[0]!.product.media).length, 0);

    const khongQuyen = await post("/thu-vien-san-pham/duyet-anh/danh-sach", inbox.sadida!, {});
    assert.equal(khongQuyen.json["duocDuyet"], false);
    assert.equal((await post("/thu-vien-san-pham/duyet-anh/quyet", inbox.sadida!, { ids: [lo.anh[0]!.id], duyet: true })).status, 403);

    const ds = await post("/thu-vien-san-pham/duyet-anh/danh-sach", inbox.toprun!, {});
    const cho = ds.json["anh"] as { id: string; anhGoc: string; anhChiaSe: string; logo: { trangThai: string } }[];
    assert.equal(cho.length, 1);
    assert.equal(cho[0]!.anhGoc, "https://sadida.test/a1.jpg");
    assert.match(cho[0]!.anhChiaSe, /\/thu-vien-san-pham\/asset\/[a-f0-9]{64}\.jpg$/);
    assert.equal((ds.json["dem"] as Record<string, number>)["khong-chia-duoc"], 1);
    assert.equal((await post("/thu-vien-san-pham/duyet-anh/quyet", inbox.toprun!, { ids: [cho[0]!.id], duyet: true })).json["daDoi"], 1);

    const sau = await post("/thu-vien-san-pham/tra-nhieu", inbox.khac!, { ma: ["X1"] });
    const media = (sau.json["ketQua"] as { product: { media: { assetUrl: string; role: string; source: { provider: string } }[] } }[])[0]!.product.media;
    assert.equal(media.length, 1);
    assert.equal(media[0]!.role, "primary");
    assert.equal(media[0]!.source.provider, "anh-shop-chia-se");
    const tai = await call("GET", new URL(media[0]!.assetUrl).pathname, "");
    assert.equal(tai.status, 200);
    const cuaMinh = await post("/thu-vien-san-pham/tra-nhieu", inbox.sadida!, { ma: ["X1"] });
    assert.equal(((cuaMinh.json["ketQua"] as { product: { media: unknown[] } }[])[0]!.product.media).length, 0, "shop gui khong nhan lai anh cua minh");

    assert.equal((await post("/thu-vien-san-pham/rut-chia-se", inbox.sadida!, {})).json["daRut"], 2);
    const rut = await post("/thu-vien-san-pham/tra-nhieu", inbox.khac!, { ma: ["X1"] });
    assert.equal(((rut.json["ketQua"] as { product: { media: unknown[] } }[])[0]!.product.media).length, 0);
    assert.ok(fs.existsSync(path.join(dir, "anh-chia-se.json")), "so ghi ra dia");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
