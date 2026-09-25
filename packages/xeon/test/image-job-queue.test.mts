import test from "node:test";
import assert from "node:assert/strict";
import { ImageJobQueue, ManualClock } from "@sp/xeon";

test("Image Worker queue: chong trung, lease va worker ownership", () => {
  const clock = new ManualClock(new Date("2026-09-17T00:00:00Z")); const queue = new ImageJobQueue(null, () => clock.now());
  assert.equal(queue.enqueue(" hq2053 ").id, queue.enqueue("HQ2053").id);
  const job = queue.claim("w1"); assert.equal(job?.code, "HQ2053"); assert.equal(queue.claim("w2"), null);
  assert.throws(() => queue.finish(job!.id, "w2"), /không còn thuộc/);
  queue.finish(job!.id, "w1"); assert.equal(queue.list()[0]?.status, "done");
});

test("Image Worker queue: job het lease duoc nhan lai", () => {
  const clock = new ManualClock(new Date("2026-09-17T00:00:00Z")); const queue = new ImageJobQueue(null, () => clock.now()); queue.enqueue("A1"); const first = queue.claim("w1", 30_000); clock.advance(31_000); const second = queue.claim("w2"); assert.equal(second?.id, first?.id); assert.equal(second?.attempts, 2);
});

test("Image Worker queue: cung worker tiep tuc job ma khong tang attempt", () => {
  const clock = new ManualClock(new Date("2026-09-17T00:00:00Z")); const queue = new ImageJobQueue(null, () => clock.now()); queue.enqueue("A1"); const first = queue.claim("w1", 30_000); clock.advance(10_000); const resumed = queue.claim("w1", 30_000); assert.equal(resumed?.id, first?.id); assert.equal(resumed?.attempts, 1); assert.equal(resumed?.leaseUntil, "2026-09-17T00:00:40.000Z");
});

test("Image Worker queue: heartbeat gia han job dai", () => {
  const clock = new ManualClock(new Date("2026-09-17T00:00:00Z")); const queue = new ImageJobQueue(null, () => clock.now()); const job = queue.enqueue("A1"); queue.claim("w1", 30_000); clock.advance(20_000); const renewed = queue.renew(job.id, "w1", 30_000); assert.equal(renewed.leaseUntil, "2026-09-17T00:00:50.000Z"); clock.advance(20_000); assert.equal(queue.claim("w2", 30_000), null);
});

test("Image Worker queue: gop truong thieu va asset hong vao mot job", () => {
  const queue = new ImageJobQueue(null);
  const first = queue.enqueue("A1", { requestedFields: ["material", "gallery"], brokenAssetUrls: ["https://cdn/old.jpg"] });
  const merged = queue.enqueue("a1", { requestedFields: ["gallery", "sport"], brokenAssetUrls: ["https://cdn/old.jpg", "https://cdn/other.jpg"] });
  assert.equal(merged.id, first.id);
  assert.deepEqual(merged.requestedFields, ["material", "gallery", "sport"]);
  assert.deepEqual(merged.brokenAssetUrls, ["https://cdn/old.jpg", "https://cdn/other.jpg"]);
});

test("Image Worker queue: 'chay lai viec loi' mo lai MOI viec chet, khong chi loi 409", () => {
  // 23/09/2026: ba ma chet vi may thieu thu vien `lxml`. Sua xong roi ma khong cua nao mo lai duoc,
  // vi cho nay truoc day chi mo lai viec chet vi HTTP 409. Ham nay chi chay khi NGUOI bam nut, nen
  // y cua ho la chay lai TAT CA.
  const clock = new ManualClock(new Date("2026-09-23T00:00:00Z"));
  const queue = new ImageJobQueue(null, () => clock.now());
  const chet = (ma: string, loi: string) => {
    queue.enqueue(ma);
    for (let lan = 0; lan < 5; lan += 1) {
      const job = queue.claim("w1", 1_000);
      if (!job) throw new Error(`khong nhan duoc viec ${ma}`);
      queue.fail(job.id, "w1", loi);
    }
  };
  chet("IY7228", "FeatureNotFound: Couldn't find a tree builder with the features you requested: lxml");
  chet("KG0001", "RuntimeError: HTTP 409 /image-worker/gia-han");
  assert.equal(queue.list().filter((j) => j.status === "failed").length, 2);

  assert.deepEqual(queue.retryFailed(), { retried: 2 });
  const sau = queue.list();
  assert.equal(sau.filter((j) => j.status === "waiting").length, 2, "ca hai phai ve hang cho");
  assert.equal(sau.every((j) => j.attempts === 0 && j.error === undefined), true, "xoa lan thu va loi cu");
});


test("Image Worker queue: list() loc theo ma TRUOC khi cat 1000 — ma cu khong bi khuat", () => {
  const clock = new ManualClock(new Date("2026-09-19T00:00:00Z"));
  const queue = new ImageJobQueue(null, () => clock.now());
  queue.enqueue("CU0001");
  for (let i = 0; i < 1200; i += 1) { clock.advance(1_000); queue.enqueue(`MOI${i}`); }

  // Hang doi that sang 24/09/2026 co 2.389 viec. Cat 1.000 viec moi nhat thi 971 trong 1.767 ma
  // roi ra ngoai: man hinh hoi "ma cua toi xong chua?", nhan ve rong — khong thay `done`, cung
  // khong thay `failed` — nen giu ma trong danh sach cho va hoi lai sau 5 giay, vinh vien.
  assert.equal(queue.list().length, 1000, "khong hoi dich danh thi van cat 1.000");
  assert.equal(queue.list().some((j) => j.code === "CU0001"), false, "ma cu that su nam ngoai top-1000");

  const rieng = queue.list(["cu0001"]);
  assert.equal(rieng.length, 1, "hoi dich danh thi phai thay, du viec co cu den dau");
  assert.equal(rieng[0]?.code, "CU0001");
});

test("Image Worker queue: control() dem viec chet cua CA hang doi", () => {
  const clock = new ManualClock(new Date("2026-09-19T00:00:00Z"));
  const queue = new ImageJobQueue(null, () => clock.now());
  queue.enqueue("IY7228");
  for (let lan = 0; lan < 5; lan += 1) {
    const job = queue.claim("w1"); assert.ok(job);
    queue.fail(job.id, "w1", "FeatureNotFound: lxml");
  }
  queue.enqueue("CON-SONG");

  // Man hinh tung dem `failed` trong danh sach da bi cat, nen ba viec chet hom 19/09 khong ai thay
  // va nut "Chay lai viec loi" tu an: sua xong cai gay loi roi ma khong cua nao mo lai duoc.
  const control = queue.control();
  assert.equal(control.failed, 1, "control phai noi that co bao nhieu viec chet");
  assert.equal(control.waiting, 1);
});


test("Image Worker queue: viec mang theo HANG xuong tan bo cao", () => {
  const clock = new ManualClock(new Date("2026-09-24T00:00:00Z"));
  const queue = new ImageJobQueue(null, () => clock.now());

  // Khong co hang thi `fast_backend` bo qua ca nhanh adidas.com.vn. FX3624: khong khai -> 0 anh;
  // khai "Adidas" -> 9 anh chinh hang. Ca 476 ma con thieu cua shop deu la Adidas.
  const job = queue.enqueue("FX3624", { requestedFields: ["gallery"], brand: "  Adidas  " });
  assert.equal(job.brand, "Adidas", "cat khoang trang, giu nguyen chu");

  const nhan = queue.claim("w1");
  assert.equal(nhan?.brand, "Adidas", "worker phai nhan duoc hang cung voi ma");

  // Lan dau khong biet hang, lan sau biet: viec dang song phai duoc bo sung, khong tao viec thu hai.
  const chuaBiet = queue.enqueue("KD8461");
  assert.equal(chuaBiet.brand, undefined);
  const bietSau = queue.enqueue("KD8461", { brand: "Adidas" });
  assert.equal(bietSau.id, chuaBiet.id, "van la mot viec");
  assert.equal(bietSau.brand, "Adidas", "biet muon con hon khong bao gio biet");
});
