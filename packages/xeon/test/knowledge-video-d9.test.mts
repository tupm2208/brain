/**
 * Đ9 — industry knowledge on Xeon (line DNA, sample profiles, research queue, reference classification)
 * and the Video Studio ticket + separate service. Models are scripts, the tool is a fake function:
 * no network, no key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  KnowledgeController, KnowledgeDesk, KnowledgePackRegistry, LicenseLedger, LicenseService, ManualClock, MemoryLogger, VideoController, VideoStudioService,
  distanceBand, generateSigningKey, signText, issueStudioTicket, isEasyJog, parsePaceMinutes, verifyStudioTicket, currentUsage,
  type TextModelPort, type TextOutcome, type TextRequest
} from "@sp/xeon";

const T0 = new Date("2026-09-17T08:00:00.000Z");
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

class ScriptModel implements TextModelPort {
  readonly asked: TextRequest[] = [];
  readonly agents: string[] = [];
  private readonly answer: (r: TextRequest) => string;
  private readonly on: boolean;
  constructor(answer: (r: TextRequest) => string, on = true) {
    this.answer = answer;
    this.on = on;
  }
  ready(): boolean { return this.on; }
  async complete(request: TextRequest): Promise<TextOutcome> {
    this.asked.push(request);
    this.agents.push(String(currentUsage()?.agent ?? ""));
    return { ok: true, text: this.answer(request), model: "script" };
  }
}

const RESEARCH = `TÓM TẮT
Boston 13 là giày tempo đa dụng, đế Lightstrike Pro cho cảm giác nảy và chắc chân, hợp bài tempo lẫn chạy dài cuối tuần.

THÔNG SỐ
Drop: 6mm
Loại Foam: Lightstrike Pro
Upper: Engineered Mesh
Outsole: Continental

CHẤM ĐIỂM
Độ êm: 8/10
Độ nảy 8.5/10
Độ ổn định: 7/10
Độ bền 9/10
Độ bám: 9/10

Pace 4:00 - 5:00 là vùng phát huy tốt nhất.

Ai nên mua
- Người chạy đã có nền tảng muốn tăng tốc độ bài tempo
- Người cần một đôi chạy dài cuối tuần nhưng vẫn nhanh

Ai không nên mua
- Người mới chạy lần đầu cần đôi thật êm và dễ dùng

FAQ
Boston 13 có chạy marathon được không?
Có nên lên size không?`;

async function build(model: TextModelPort = new ScriptModel(() => RESEARCH), industry = "giay-chay") {
  const clock = new ManualClock(T0);
  const license = new LicenseService({ ledger: await LicenseLedger.open(), signingKey: generateSigningKey(), clock, sellableModules: ["chatbot-cskh"], coreModules: ["hang-kho"] });
  const shopA = await license.issueKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2027-09-15T00:00:00.000Z", nganh: industry });
  const shopB = await license.issueKey({ shop: "nha-thuoc-an", tenShop: "Nhà thuốc An", hetHan: "2027-09-15T00:00:00.000Z", nganh: "nha-thuoc" });
  const a = await license.registerLanding({ key: shopA.key, diaChi: "https://shop.test" });
  const b = await license.registerLanding({ key: shopB.key, diaChi: "https://thuoc.test" });
  assert.ok(a.ok && b.ok);
  const logger = new MemoryLogger();
  const desk = new KnowledgeDesk({ dataDirectory: "", packs: new KnowledgePackRegistry(), model, clock });
  const knowledge = new KnowledgeController({ desk, license, logger });
  const video = (studioAddress: string) => new VideoController({ license, studioAddress, clock, logger });
  const drive = async (controller: { handle: KnowledgeController["handle"] }, path: string, body: unknown, token: string | null): Promise<{ status: number; body: Body }> => {
    let status = 0;
    let out: Body = {};
    const req = { headers: token === null ? {} : { authorization: `Bearer ${token}` } } as unknown as IncomingMessage;
    const res = { writeHead(code: number) { status = code; return this; }, end(t: string) { out = t ? JSON.parse(t) : {}; } } as unknown as ServerResponse;
    assert.equal(await controller.handle(req, res, { method: "POST", path, ip: "1.1.1.1", readJson: async () => body as Record<string, unknown> }), true);
    return { status, body: out };
  };
  return {
    clock, license, logger, video,
    callA: (path: string, body: unknown = {}) => drive(knowledge, path, body, a.ok ? a.maNhanTin : ""),
    callB: (path: string, body: unknown = {}) => drive(knowledge, path, body, b.ok ? b.maNhanTin : ""),
    callRaw: (path: string, body: unknown, token: string | null) => drive(knowledge, path, body, token),
    videoCall: (address: string, token: string | null = a.ok ? a.maNhanTin : "") => drive(video(address), "/video/ve", {}, token)
  };
}

test("line DNA: longest alias wins, size and money are never a distance, easy jog needs no pace", () => {
  const pack = new KnowledgePackRegistry().get("giay-chay");
  assert.ok(pack.lines.size() > 30, "the running pack carries Desk's line-dna.json");
  assert.equal(pack.lines.findByText("shop còn adios pro 4 size 42 không")?.id, "adizero-adios-pro");
  assert.equal(pack.lines.findByText("đôi adios 9 còn không")?.id, "adizero-adios");
  assert.equal(distanceBand("size 42 còn không"), null);
  assert.equal(distanceBand("ship 25k, cọc 500k"), null);
  assert.equal(distanceBand("tuần chạy 30km, mục tiêu HM"), "hm");
  assert.equal(parsePaceMinutes("pace tầm 6"), 6);
  assert.equal(parsePaceMinutes("chạy 6:30"), 6.5);
  assert.equal(isEasyJog("chạy nhẹ nhàng 5km buổi sáng"), true);
  assert.equal(isEasyJog("chạy 10km pace 5"), false);
  const inStock = ["Giày chạy adidas Adizero Adios Pro 4", "adidas Supernova Rise 2", "adidas Duramo SL"];
  const newbie = pack.lines.recommend({ distanceText: "5km", paceText: "pace 7", level: "new" }, inStock, 3);
  assert.ok(!newbie.picks.some((p) => ["short_race", "race_carbon", "super_trainer"].includes(p.purpose)), "a beginner is never offered race lines");
  assert.equal(pack.lines.recommend({}, inStock).picks.length, 0);
  assert.equal(new KnowledgePackRegistry().get("nha-thuoc").lines.size(), 0, "a pharmacy pack has no shoe lines");
});

test("sample profiles on Xeon: seeded per shop, save / merge / consolidate / delete, catalogue merge, publish = product lines + assignments", async () => {
  const { callA, callB, callRaw } = await build();
  const first = await callA("/kien-thuc/mau");
  assert.equal(first.status, 200);
  assert.equal(first.body.dem.tong, 8, "Desk's eight default profiles");
  assert.equal(first.body.goi.id, "giay-chay");
  assert.deepEqual(first.body.goi.promptChuyenNganh, ["running"]);
  assert.equal((await callB("/kien-thuc/mau")).body.dem.tong, 0, "another shop (another industry) has its own, empty store");
  assert.equal((await callRaw("/kien-thuc/mau", {}, "sai")).status, 401);
  assert.equal((await callRaw("/kien-thuc/mau", { tenant: "nha-thuoc-an" }, null)).status, 401);

  const doc = await callA("/kien-thuc/mau/doc", { id: "adidas-adizero-boston-12" });
  assert.equal(doc.body.mau.name, "Adidas Adizero Boston 12");
  assert.ok(Array.isArray(doc.body.mau.evaluationTables.classification), "the nine tables exist");
  assert.equal((await callA("/kien-thuc/mau/ghi", { mau: { id: "có dấu", name: "x" } })).status, 400);

  // Two copies of Boston 12 → consolidate keeps the richer one.
  await callA("/kien-thuc/mau/ghi", { mau: { id: "boston-12-copy", name: "Boston 12", brand: "adidas", keywords: ["Boston 12 copy"] } });
  const dup = await callA("/kien-thuc/mau");
  assert.equal(dup.body.dem.trung.duplicateProfiles, 1);
  const cons = await callA("/kien-thuc/mau/gop-trung");
  assert.equal(cons.body.daGop, 1);
  assert.deepEqual(cons.body.boMa, ["boston-12-copy"]);
  const kept = await callA("/kien-thuc/mau/doc", { id: "adidas-adizero-boston-12" });
  assert.ok(kept.body.mau.keywords.includes("Boston 12 copy"), "keywords of the merged copy survive");

  // Manual merge needs the kept profile among the chosen ones.
  assert.equal((await callA("/kien-thuc/mau/gop", { ids: ["nike-pegasus-41", "hoka-clifton-9"], giu: "asics-novablast-5" })).status, 400);
  const merged = await callA("/kien-thuc/mau/gop", { ids: ["nike-pegasus-41", "hoka-clifton-9"], giu: "nike-pegasus-41" });
  assert.equal(merged.body.daGop, 1);
  assert.equal((await callA("/kien-thuc/mau/xoa", { ids: ["nike-vaporfly-3"] })).body.daXoa, 1);

  // Catalogue → new profiles for lines that have none (versions kept, duplicates folded).
  const cat = await callA("/kien-thuc/mau/gop-kho", { sanPham: [
    { ma: "JP1", ten: "Giày chạy bộ adidas Adizero Boston 13 nam", hang: "adidas", nguon: "own" },
    { ma: "JP2", ten: "adidas Adizero Boston 13 (đen)", hang: "adidas", nguon: "campaign" },
    { ma: "ZX1", ten: "Asics Novablast 5", hang: "asics" }
  ] });
  assert.equal(cat.body.taoMoi, 1, "Boston 13 is new; Novablast 5 already has a profile");
  const list = await callA("/kien-thuc/mau", { q: "boston 13" });
  assert.equal(list.body.mau.length, 1);
  const b13 = list.body.mau[0];
  assert.equal(b13.completeness.status, "empty");

  // Research pasted by hand fills specs, scores, lists, FAQ.
  const parsed = await callA("/kien-thuc/mau/phan-tich", { id: b13.id, noiDung: RESEARCH });
  assert.equal(parsed.status, 200);
  assert.equal(parsed.body.mau.technicalSpecs.drop, "6mm");
  assert.equal(parsed.body.mau.scores.comfort, 8);
  assert.equal(parsed.body.mau.scores.bounce, 8.5);
  assert.ok(parsed.body.mau.bestFor.some((x: string) => /tempo/.test(x)));
  assert.equal(parsed.body.mau.reviewSummary.faq.length, 2);
  assert.ok(parsed.body.mau.technologies.includes("100% Lightstrike Pro full-length"));

  const pub = await callA("/kien-thuc/mau/xuat-ban", { sanPham: [{ ma: "JP1", ten: "adidas Adizero Boston 13" }, { ma: "Q9", ten: "Tất chạy bộ" }] });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.dong.length, pub.body.soMau);
  assert.deepEqual(pub.body.gan, [{ ma: "JP1", dong: b13.id }]);
  const line = pub.body.dong.find((l: Body) => l.id === b13.id);
  assert.equal(line.danhGia.thongSo.drop, "6mm");
  assert.equal((await callA("/kien-thuc/mau")).body.dem.daXuatBan, pub.body.soMau);

  // "Dùng làm mẫu cho cả dòng" from a product's web fields.
  const fromProduct = await callA("/kien-thuc/mau/tu-san-pham", { sanPham: { ma: "EVO1", tenDong: "Adizero EVO SL", hang: "adidas", tuKhoa: "EVO SL\nAdizero Evo", gioiThieu: "Giày tốc độ không plate", phuHop: "Tempo\nInterval" } });
  assert.equal(fromProduct.status, 200);
  assert.equal(fromProduct.body.dong.id, "adizero-evo-sl");
  assert.deepEqual(fromProduct.body.dong.phuHop, ["Tempo", "Interval"]);

  const reset = await callA("/kien-thuc/mau/mac-dinh");
  assert.equal(reset.body.soMau, 8);
});

test("research queue: jobs from the pack prompt, run on Xeon's model under the knowledge agent, results wait for review", async () => {
  const model = new ScriptModel(() => RESEARCH);
  const { callA } = await build(model);
  assert.equal((await callA("/kien-thuc/nghien-cuu/tao", { ids: [] })).status, 400);
  const made = await callA("/kien-thuc/nghien-cuu/tao", { ids: ["adidas-adizero-boston-12", "hoka-speedgoat-6"], prompt: "Nghiên cứu {{profileName}} của {{brand}}" });
  assert.equal(made.body.viec.length, 2);
  assert.equal(made.body.viec[0].template, "running", "running profiles use the expert prompt of the pack");
  assert.equal((await callA("/kien-thuc/nghien-cuu/tao", { ids: ["adidas-adizero-boston-12"] })).body.viec.length, 0, "no second pending job for the same profile");
  const run = await callA("/kien-thuc/nghien-cuu/chay", { toiDa: 5 });
  assert.equal(run.body.xong, 2);
  assert.equal(run.body.conCho, 0);
  assert.match(model.asked[0]!.user, /Adidas Adizero Boston 12/);
  assert.deepEqual([...new Set(model.agents)], ["knowledge_research"]);
  const overview = await callA("/kien-thuc/mau");
  assert.equal(overview.body.demNghienCuu.done, 2);
  const boston = overview.body.mau.find((m: Body) => m.id === "adidas-adizero-boston-12");
  assert.equal(boston.completeness.status, "pending_review", "research never publishes itself");
  await callA("/kien-thuc/mau/xuat-ban", { sanPham: [] });
  const after = await callA("/kien-thuc/mau/doc", { id: "adidas-adizero-boston-12" });
  assert.equal(after.body.mau.researchStatus, "approved", "pressing publish is the review");

  const off = await build(new ScriptModel(() => "", false));
  await off.callA("/kien-thuc/nghien-cuu/tao", { ids: ["hoka-clifton-9"] });
  const refused = await off.callA("/kien-thuc/nghien-cuu/chay", {});
  assert.equal(refused.status, 503);
});

test("line knowledge and reference classification go by the shop's licence industry", async () => {
  const { callA, callB } = await build();
  const rec = await callA("/kien-thuc/dong/goi-y", { nhuCau: { pace: "pace 5:30", cuLy: "10km" }, conHang: ["adidas Adizero Boston 13", "adidas Adizero Adios Pro 4", "Asics Novablast 5"], soDong: 3 });
  assert.equal(rec.status, 200);
  assert.equal(rec.body.paceBand, "p5_6");
  assert.equal(rec.body.distanceBand, "k10");
  assert.ok(rec.body.picks.length >= 1);
  const found = await callA("/kien-thuc/dong/tim", { chu: "adios pro 3", conHang: ["adidas Adizero Boston 13"] });
  assert.equal(found.body.dong.id, "adizero-adios-pro");
  assert.ok(found.body.tuongDuong.length >= 1);
  const cls = await callA("/kien-thuc/cham-dong", { sanPham: [{ ma: "A", ten: "Nike Pegasus 41" }, { ma: "B", ten: "Dép tổ ong" }] });
  assert.equal(cls.body.khop, 1);
  assert.equal(cls.body.sanPham[0].category, "daily_trainer");
  assert.equal(cls.body.theoNhom.daily_trainer, 1);
  assert.equal((await callB("/kien-thuc/dong/goi-y", { nhuCau: { cuLy: "10km" } })).status, 404, "a pharmacy has no line data");
  assert.equal((await callB("/kien-thuc/cham-dong", { sanPham: [{ ma: "A", ten: "Nike Pegasus 41" }] })).body.khop, 0);
  assert.deepEqual((await callB("/kien-thuc/goi")).body.fitFinder.customerInputs, []);
});

test("Video Studio: Xeon signs a five-minute ticket; the separate service trades it once for a session and forwards to the tool", async () => {
  const { videoCall, license, clock } = await build();
  assert.equal((await videoCall("")).status, 503, "no studio address = the door says so");
  assert.equal((await videoCall("https://video.test", "sai")).status, 401);
  const issued = await videoCall("https://video.test/");
  assert.equal(issued.status, 200);
  const url = new URL(issued.body.diaChi);
  assert.equal(url.origin + url.pathname, "https://video.test/video-studio/");
  const ticket = url.searchParams.get("ve")!;
  assert.match(ticket, /^VS1\./);
  const { keyId, khoaCongPem } = license.publicKey();
  const publicKeyForKeyId = (id: string) => (id === keyId ? khoaCongPem : null);
  const ok = verifyStudioTicket(ticket, { publicKeyForKeyId, now: clock.now() });
  assert.ok(ok.ok && ok.body.shop === "toprun");
  assert.equal(verifyStudioTicket(ticket, { publicKeyForKeyId, now: new Date(T0.getTime() + 6 * 60_000) }).ok, false, "expired after five minutes");
  assert.equal(verifyStudioTicket(ticket.slice(0, -3) + "abc", { publicKeyForKeyId, now: clock.now() }).ok, false, "tampered signature");
  const other = generateSigningKey();
  const forged = issueStudioTicket({ shop: "toprun", now: clock.now(), keyId, sign: (t) => ({ keyId, chuKy: signText(other.khoaRiengPem, t) }) });
  assert.equal(verifyStudioTicket(forged.ve, { publicKeyForKeyId, now: clock.now() }).ok, false, "signed with another key");

  const forwarded: { method: string; path: string; headers: Record<string, string> }[] = [];
  const service = new VideoStudioService({
    publicKeyForKeyId, clock, logger: new MemoryLogger(), upstream: "",
    forward: async (input) => { forwarded.push(input); return { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<h1>studio</h1>") }; }
  });
  const hit = async (path: string, cookie = "") => {
    let status = 0;
    let headers: Record<string, string> = {};
    let body = "";
    const req = { url: path, method: "GET", headers: cookie ? { cookie } : {} } as unknown as IncomingMessage;
    const res = { writeHead(code: number, h: Record<string, string> = {}) { status = code; headers = h; return this; }, end(b?: string | Buffer) { body = String(b ?? ""); } } as unknown as ServerResponse;
    await service.handle(req, res);
    return { status, headers, body };
  };
  assert.equal((await hit("/video-studio/")).status, 401, "no ticket, no session");
  const entered = await hit(`/video-studio/?ve=${encodeURIComponent(ticket)}`);
  assert.equal(entered.status, 302);
  const cookie = String(entered.headers["Set-Cookie"]).split(";")[0]!;
  assert.match(cookie, /^vs_phien=/);
  assert.equal((await hit(`/video-studio/?ve=${encodeURIComponent(ticket)}`)).status, 401, "one use");
  const page = await hit("/video-studio/api/state?x=1", cookie);
  assert.equal(page.status, 200);
  assert.equal(forwarded[0]!.path, "/api/state?x=1", "prefix stripped like Desk's proxy");
  assert.equal(forwarded[0]!.headers["x-omi-shop"], "toprun");
  assert.equal(forwarded[0]!.headers["cookie"], undefined, "the session cookie is not handed to the tool");
  assert.equal((await hit("/video-studio/", "vs_phien=toprun%7C9999999999999%7Csai")).status, 401, "a forged session is refused");

  const skeleton = new VideoStudioService({ publicKeyForKeyId, clock, logger: new MemoryLogger(), upstream: "" });
  const fresh = (await videoCall("https://video.test")).body.diaChi as string;
  let setCookie = "";
  await skeleton.handle({ url: new URL(fresh).pathname + new URL(fresh).search, method: "GET", headers: {} } as unknown as IncomingMessage,
    { writeHead(_c: number, h: Record<string, string> = {}) { setCookie = String(h["Set-Cookie"] ?? ""); return this; }, end() { /* redirect */ } } as unknown as ServerResponse);
  let skeletonBody = "";
  await skeleton.handle({ url: "/video-studio/", method: "GET", headers: { cookie: setCookie.split(";")[0] } } as unknown as IncomingMessage,
    { writeHead() { return this; }, end(b: string) { skeletonBody = b; } } as unknown as ServerResponse);
  assert.match(skeletonBody, /chưa cài trên Xeon/, "no tool configured: the skeleton page says so");
});
