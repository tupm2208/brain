/**
 * Lô ảnh (30/09/2026): mỗi lần một shop hỏi `tra-nhieu` là một lô; xong lô thì Xeon tự đẩy kết quả
 * về landing của shop MỘT LẦN (chia gói 5 mã vì trần 100 giây của Cloudflare). Sự cố gốc: shop
 * sadida rời màn OMI giữa lô 50 mã, Image Tool bóc xong mà ảnh không bao giờ về kho.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  BATCH_FILE, ImageBatchBook, ImageJobQueue, LicenseLedger, LicenseService, ManualClock, MemoryLogger, ProductLibrary,
  createXeonServer, generateSigningKey, verifyTicket, type FetchLike, type ImageJob
} from "@sp/xeon";
import { ProductLibraryController } from "../dist/http/product-library-controller.js";
import { ImageWorkerController } from "../dist/http/image-worker-controller.js";

const T0 = new Date("2026-09-30T16:00:00.000Z");
const MODULES = ["hang-kho", "don-khach", "gian-hang", "hop-thu"];
const CORE = ["hang-kho", "don-khach", "gian-hang"];

interface Push { origin: string; path: string; lo: string; ma: string[]; token: string }

async function setup({ dataDirectory = null as string | null } = {}) {
  const clock = new ManualClock(T0);
  const signingKey = generateSigningKey();
  const license = new LicenseService({ ledger: await LicenseLedger.open(), signingKey, clock, xeonAddress: "https://xeon.test", sellableModules: MODULES, coreModules: CORE });
  const shop = await license.issueKey({ shop: "sadida", tenShop: "Sadida", manh: ["hang-kho"], hetHan: "2027-01-01T00:00:00.000Z" });
  const reg = await license.registerLanding({ key: shop.key, diaChi: "https://sadida.test" });
  if (!reg.ok) throw new Error("landing registration failed");
  const pushes: Push[] = [];
  /** `hong`: gói nào chứa một trong các mã này thì landing trả 502 (vd ảnh treo, landing không gọi được Xeon). */
  const landing = { down: false, status: 200, hong: new Set<string>() };
  const fetch: FetchLike = async (url, init) => {
    if (landing.down) throw new Error("mat mang");
    const u = new URL(url); const body = JSON.parse(String(init.body)) as { lo: string; ma: string[] };
    pushes.push({ origin: u.origin, path: u.pathname, lo: body.lo, ma: body.ma, token: String(init.headers["Authorization"] ?? "").replace(/^Bearer /, "") });
    const status = body.ma.some((code) => landing.hong.has(code)) ? 502 : landing.status;
    return { ok: status < 300, status, json: async () => (status < 300 ? { ok: true, daBoSung: body.ma.length } : { ok: false, error: status === 404 ? "khong_thay" : "image_tool_khong_san_sang" }) };
  };
  const logger = new MemoryLogger();
  const queue = new ImageJobQueue(null, () => clock.now());
  const book = new ImageBatchBook({ queue, license, clock, logger, dataDirectory, fetch });
  return { clock, signingKey, license, queue, book, pushes, landing, logger, fetch, inbox: reg.maNhanTin };
}

/** Image Tool bóc xong một việc: nhận vé rồi nộp. */
const finish = (queue: ImageJobQueue, worker = "w1") => { const job = queue.claim(worker)!; queue.finish(job.id, worker); return job.code; };

test("Lo anh: con viec dang chay thi chua gui; xong ca lo thi gui mot lan, chia goi 5 ma", async () => {
  const x = await setup();
  const codes = Array.from({ length: 12 }, (_, i) => `A${i + 1}`);
  const [batch] = x.book.open("sadida", codes.map((code) => x.queue.enqueue(code)));
  assert.equal(batch?.viec.length, 12);
  for (let i = 0; i < 11; i += 1) finish(x.queue);
  assert.equal(await x.book.deliverReady(), 0, "con 1 viec cho thi chua gui gi");
  assert.equal(x.pushes.length, 0);
  finish(x.queue);
  assert.equal(await x.book.deliverReady(), 12);
  assert.deepEqual(x.pushes.map((p) => p.ma.length), [5, 5, 2]);
  assert.deepEqual(x.pushes.flatMap((p) => p.ma).sort(), [...codes].sort());
  assert.ok(x.pushes.every((p) => p.origin === "https://sadida.test" && p.path === "/api/hang-kho/thu-vien/ket-qua-tu-xeon" && p.lo === batch!.id));
  // Vé dịch vụ do Xeon ký, đúng shop — landing tin vé này như tin các cửa hop-thu.
  const ve = verifyTicket(x.pushes[0]!.token, { publicKeyForKeyId: () => x.signingKey.khoaCongPem, now: T0 });
  assert.ok(ve.hopLe);
  assert.equal(ve.than.shop, "sadida");
  assert.equal(ve.than.vai, "dich-vu");
  assert.equal(x.book.list().length, 0, "lo da gui het thi dong");
  assert.equal(await x.book.deliverReady(), 0, "khong gui lai lan hai");
  assert.equal(x.pushes.length, 3);
});

test("Lo anh: viec chet khong gui; viec loi dang hen lai khong giu ca lo, xong thi gui bu", async () => {
  const x = await setup();
  // Hàng đợi giả: sổ lô chỉ hỏi `get(id)`, nên đặt thẳng trạng thái từng việc cho rõ từng ca.
  const at = T0.toISOString();
  const jobs = new Map<string, ImageJob>([
    ["j1", { id: "j1", code: "B1", status: "done", attempts: 1, createdAt: at, updatedAt: at }],
    ["j2", { id: "j2", code: "B2", status: "waiting", attempts: 1, error: "ScrapeLooksBroken: bi chan", createdAt: at, updatedAt: at }],
    ["j3", { id: "j3", code: "B3", status: "failed", attempts: 5, error: "chet", createdAt: at, updatedAt: at }],
    ["j4", { id: "j4", code: "B4", status: "waiting", attempts: 5, createdAt: at, updatedAt: at }]
  ]);
  const fake = { getMany: () => new Map(jobs), control: () => ({ paused: false }) } as unknown as ImageJobQueue;
  const live = new ImageBatchBook({ queue: fake, license: x.license, clock: x.clock, logger: x.logger, dataDirectory: null, fetch: x.fetch });
  assert.equal(live.open("sadida", [...jobs.values()])[0]?.viec.length, 4);
  // B2 đang hẹn lại: vẫn gửi B1 ngay, không bắt B1 chờ. B3 chết, B4 kẹt ở lần 5: không có gì để gửi.
  await live.deliverReady();
  assert.deepEqual(x.pushes.flatMap((p) => p.ma), ["B1"]);
  assert.equal(live.list().length, 1, "lo con mo cho B2");
  jobs.set("j2", { ...jobs.get("j2")!, status: "done" });
  await live.deliverReady();
  assert.deepEqual(x.pushes.flatMap((p) => p.ma), ["B1", "B2"]);
  assert.equal(live.list().length, 0);
});

test("Lo anh: landing khong nhan thi hen lai, khong goi don dap; lan sau gui phan con lai", async () => {
  const x = await setup();
  x.book.open("sadida", ["C1", "C2", "C3", "C4", "C5", "C6", "C7"].map((code) => x.queue.enqueue(code)));
  for (let i = 0; i < 7; i += 1) finish(x.queue);
  x.landing.down = true;
  assert.equal(await x.book.deliverReady(), 0);
  assert.equal(x.book.list()[0]?.lanGui, 1);
  x.landing.down = false;
  x.clock.advance(30_000);
  await x.book.deliverReady();
  assert.equal(x.pushes.length, 0, "chua toi hen thi khong goi");
  x.clock.advance(31_000);
  assert.equal(await x.book.deliverReady(), 7);
  assert.equal(x.book.list().length, 0);
  // Landing cũ chưa có cửa này (404): hỏng HẲN — bỏ lô, không gọi lại suốt ba ngày.
  x.book.open("sadida", [x.queue.enqueue("D1")]); finish(x.queue);
  x.landing.status = 404;
  const before = x.pushes.length;
  assert.equal(await x.book.deliverReady(), 0);
  assert.equal(x.book.list().length, 0);
  x.clock.advance(2 * 60 * 60 * 1000);
  await x.book.deliverReady();
  assert.equal(x.pushes.length, before + 1, "chi goi mot lan");
  assert.ok(x.logger.warnings.some((w) => w.includes("khong nhan lo")));
});

test("Lo anh: mot goi hong khong chan ca lo; ma hay hong gui sau cung, hong 5 lan thi bo rieng ma do", async () => {
  const x = await setup();
  const codes = Array.from({ length: 15 }, (_, i) => `H${i + 1}`);
  x.book.open("sadida", codes.map((code) => x.queue.enqueue(code)));
  for (let i = 0; i < 15; i += 1) finish(x.queue);
  x.landing.hong.add("H1");                                   // gói đầu (H1-H5) hỏng vì H1
  assert.equal(await x.book.deliverReady(), 14, "tach goi hong ra tung ma: chi H1 o lai");
  assert.deepEqual(x.pushes.map((p) => p.ma.join(",")), ["H1,H2,H3,H4,H5", "H1", "H2", "H3", "H4", "H5", "H6,H7,H8,H9,H10", "H11,H12,H13,H14,H15"]);
  assert.deepEqual(x.book.list()[0]?.loiTheoMa, { H1: 1 }, "chi ma thuc su hong bi dem loi");
  for (let i = 0; i < 10; i += 1) { x.clock.advance(2 * 60 * 60 * 1000); await x.book.deliverReady(); }
  assert.equal(x.book.list().length, 0, "H1 hong 5 lan thi bo, lo dong");
  assert.equal(x.pushes.filter((p) => p.ma.includes("H1")).length, 6, "goi dau + 5 lan rieng H1");
  assert.ok(x.logger.warnings.some((w) => w.includes("bo ma H1")));
});

test("Lo anh: landing im han (mat mang) thi thoi goi shop do trong luot nay, khong dot thoi gian tung lo", async () => {
  const x = await setup();
  for (const code of ["K1", "K2", "K3"]) { x.book.open("sadida", [x.queue.enqueue(code)]); finish(x.queue); }
  x.landing.down = true;
  await x.book.deliverReady();
  assert.equal(x.book.list().filter((b) => b.lanGui === 1).length, 1, "chi lo dau bi goi; hai lo sau bo qua trong luot");
});

test("Lo anh: hang doi dang DUNG thi viec cho khong giu lo — ma da xong van ve kho", async () => {
  const x = await setup();
  x.book.open("sadida", ["P1", "P2"].map((code) => { x.clock.advance(1); return x.queue.enqueue(code); }));
  finish(x.queue);
  x.queue.setPaused(true);
  await x.book.deliverReady();
  assert.deepEqual(x.pushes.flatMap((p) => p.ma), ["P1"]);
  assert.equal(x.book.list().length, 1, "P2 van cho, lo chua dong");
});

test("Lo anh: lo nhap file 120 ma tach thanh lo 50, lo nao xong truoc gui truoc", async () => {
  const x = await setup();
  // Đồng hồ nhích 1 ms mỗi mã: hàng đợi nhận việc theo `createdAt`, cùng giờ thì thứ tự là ngẫu nhiên.
  const opened = x.book.open("sadida", Array.from({ length: 120 }, (_, i) => { x.clock.advance(1); return x.queue.enqueue(`N${i + 1}`); }));
  assert.deepEqual(opened.map((b) => b.viec.length), [50, 50, 20]);
  for (let i = 0; i < 50; i += 1) finish(x.queue);
  assert.equal(await x.book.deliverReady(), 50);
});

test("Lo anh: ghi so loi (EPERM) chi la canh bao, khong nem ra ngoai", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lo-anh-hong-"));
  try {
    const x = await setup();
    fs.mkdirSync(path.join(dir, BATCH_FILE));                    // một THƯ MỤC chiếm tên tệp: rename nào cũng hỏng
    const book = new ImageBatchBook({ queue: x.queue, license: x.license, clock: x.clock, logger: x.logger, dataDirectory: dir, fetch: x.fetch });
    assert.equal(book.open("sadida", [x.queue.enqueue("Q1")]).length, 1);
    finish(x.queue);
    assert.equal(await book.deliverReady(), 1);
    assert.ok(x.logger.warnings.some((w) => w.includes("khong ghi duoc")));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Lo anh: khong co shop (ma dung chung kieu cu) thi khong mo lo; lo qua 3 ngay thi bo", async () => {
  const x = await setup();
  assert.deepEqual(x.book.open(null, [x.queue.enqueue("E1")]), []);
  assert.deepEqual(x.book.open("sadida", []), []);
  x.book.open("sadida", [x.queue.enqueue("E2")]);
  x.clock.advance(3 * 24 * 60 * 60 * 1000 + 1);
  await x.book.deliverReady();
  assert.equal(x.book.list().length, 0);
  assert.equal(x.pushes.length, 0);
});

test("Lo anh: so lo ben qua khoi dong lai Xeon", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lo-anh-"));
  try {
    const x = await setup({ dataDirectory: dir });
    x.book.open("sadida", [x.queue.enqueue("F1")]);
    assert.ok(fs.existsSync(path.join(dir, BATCH_FILE)));
    const again = new ImageBatchBook({ queue: x.queue, license: x.license, clock: x.clock, logger: x.logger, dataDirectory: dir });
    assert.equal(again.list()[0]?.viec[0]?.code, "F1");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Lo anh qua HTTP that: tra-nhieu cua shop mo lo; Image Tool nop ket qua thi Xeon tu day ve landing", async () => {
  const x = await setup();
  const library = new ProductLibrary(null, () => x.clock.now());
  const server = createXeonServer({
    controllers: [
      new ProductLibraryController({ library, queue: x.queue, batches: x.book, license: x.license, logger: x.logger }),
      new ImageWorkerController({ queue: x.queue, library, key: "ma-tho", onSettled: () => void x.book.deliverReady() })
    ]
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (p: string, token: string, body: unknown) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = http.request(`${origin}${p}`, { method: "POST", agent: false, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }, (res) => {
      let raw = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { raw += chunk; }); res.on("end", () => resolve(JSON.parse(raw) as Record<string, unknown>));
    });
    req.on("error", reject); req.end(JSON.stringify(body));
  });
  try {
    const hoi = await post("/thu-vien-san-pham/tra-nhieu", x.inbox, { ma: ["G1", "G2"], truongThieu: { G1: ["gallery"], G2: ["gallery"] } });
    assert.deepEqual(hoi["dangCho"], ["G1", "G2"]);
    assert.equal(x.book.list().length, 1);
    assert.equal(x.book.list()[0]?.shop, "sadida", "shop lay tu ma cua landing, khong tu than thu");
    for (const worker of ["w1", "w2"]) {
      const nhan = await post("/image-worker/nhan", "ma-tho", { worker }); const job = nhan["job"] as { id: string; code: string };
      const xong = await post("/image-worker/hoan-tat", "ma-tho", { worker, id: job.id, sanPham: { code: job.code, media: [] } });
      assert.equal(xong["ok"], true);
    }
    await x.book.deliverReady();
    assert.deepEqual(x.pushes.flatMap((p) => p.ma).sort(), ["G1", "G2"]);
    assert.equal(x.pushes.length, 1, "hai ma mot goi, mot lan");
    // Landing hỏi lại ngay sau khi lưu (không cờ ép): mã vừa bóc nằm trong trí nhớ 7 ngày, không mở lô mới.
    const hoiLai = await post("/thu-vien-san-pham/tra-nhieu", x.inbox, { ma: ["G1", "G2"], truongThieu: { G1: ["gallery"], G2: ["gallery"] } });
    assert.deepEqual(hoiLai["dangCho"], []);
    assert.equal(x.book.list().length, 0);
    // Lượt đẩy tải ảnh hỏng thì landing báo `bao-asset-loi`: Xeon xếp việc bóc lại nhưng KHÔNG mở lô,
    // kẻo đẩy → hỏng ảnh → bóc lại → đẩy mãi không dừng.
    const baoLoi = await post("/thu-vien-san-pham/bao-asset-loi", x.inbox, { ma: "G1", assetUrl: ["https://cdn.test/g1.jpg"] });
    assert.equal(baoLoi["ok"], true);
    assert.equal(x.book.list().length, 0, "bao-asset-loi khong mo lo");
  } finally {
    // Kết nối keep-alive của fetch còn treo thì `--test-force-exit` làm libuv sập lúc thoát trên Windows.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
