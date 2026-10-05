/**
 * 05/10/2026 — ba phiếu Desk nhóm "người trực / nhường bot":
 *   - "nhường khi người thật đang trực": bot im khi NGƯỜI vừa nhắn / đang gõ trong cửa sổ nhường (ô hồ sơ
 *     `chuyenNguoi.phutNhuong`, trống = 5 phút); tin bot, dòng hệ thống Meta, tin không rõ nguồn không tính;
 *     người ra tay trong lúc bot soạn thì landing bỏ câu bot (`nhuongNguoi`) và lượt kết thúc im.
 *   - "nhường xong phải tiếp quản": nhường có hạn — hết cửa sổ thì Xeon xin landing giao lại lượt; tin mới
 *     huỷ hẹn; kênh Zalo / tin quá cũ không hẹn; người bấm "bot trả lời tiếp" thì không nhường.
 *   - "chào AI khi khách chỉ khép chuyện": lượt đầu chỉ "ok" / "cảm ơn em" / "nhận được rồi" không chào.
 *
 * Tầng 1 thử bằng ngành NHÀ THUỐC (cơ chế không phụ thuộc giày); câu chào thử thêm với gói giày thật.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import {
  BrainService, LicenseLedger, LicenseService, MemoryLogger, SalesAgent, closingOnly, generateSigningKey, humanYield, yieldWindowMs,
  type ChatModelPort, type FetchLike
} from "@sp/xeon";
import { loadIntentRules } from "@sp/brain";
import { emptyShopProfile } from "@sp/contract";

const T0 = Date.parse("2026-10-05T09:00:00.000Z");
const clock = { now: () => new Date(T0) };
const ago = (minutes: number): string => new Date(T0 - minutes * 60_000).toISOString();
const noSleep = async (): Promise<void> => undefined;

interface Line { chieu: string; boi: string; chu: string; soAnh: number; luc: string; maTin?: string }
interface Call { path: string; body: Record<string, unknown> | null }

function fakeLanding(o: { thread: Line[]; hoiThoai?: Record<string, unknown>; hoSo?: Record<string, unknown>; sendAnswer?: Record<string, unknown> }) {
  const calls: Call[] = [];
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "storefront.link", "catalog.find", "conversation.recent", ...(o.hoSo ? ["shop.profile"] : [])];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: o.thread, hoiThoai: { daChaoAi: false, dienThoaiDaCho: false, theDaGui: [], ...(o.hoiThoai ?? {}) } } });
      if (tool === "shop.profile") return reply({ ok: true, data: { hoSo: o.hoSo, chinhSach: { doiTra: "", ship: "", baoHanh: "" }, kho: [] } });
      if (tool === "catalog.find") return reply({ ok: true, data: { ketQua: [] } });
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 50 } });
      return reply({ ok: true, data: { items: [], rows: [], truncated: false, asOf: "" } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: null });
    if (u.pathname === "/api/hop-thu/gui") return reply({ ok: true, ketQua: o.sendAnswer ?? { guiNgay: true, ...(body?.["chaoAi"] === true ? { chaoAi: true } : {}) } });
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    if (u.pathname === "/api/hop-thu/tiep-quan") return reply({ ok: true, tiepQuan: true, viSao: "" });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  return {
    fetch, calls,
    sends: () => calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => c.body!),
    acted: () => calls.some((c) => c.path === "/api/hop-thu/gui" || c.path === "/api/hop-thu/can-nguoi"),
    memoryWrites: () => calls.filter((c) => c.path.startsWith("/api/bo-nao/tri-nho/") && c.body !== null),
    takeovers: () => calls.filter((c) => c.path === "/api/hop-thu/tiep-quan").map((c) => String(c.body!["maHoiThoai"]))
  };
}

function manualTimer() {
  const jobs: { run: () => void; ms: number; cancelled: boolean }[] = [];
  return { jobs, timer: (run: () => void, ms: number) => { const job = { run, ms, cancelled: false }; jobs.push(job); return () => { job.cancelled = true; }; } };
}

function scriptedModel(answers: string[]): ChatModelPort {
  return { ready: () => true, complete: async () => { const next = answers.shift(); return next === undefined ? { ok: false, viSao: "het", transient: true } : { ok: true, text: next, model: "gia" }; } };
}

async function brainFor(landing: { fetch: FetchLike }, nganh: string, extra: Partial<ConstructorParameters<typeof BrainService>[0]> = {}) {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "shop-gia", tenShop: "Shop Giả", nganh, manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop-gia.vn" });
  const logger = new MemoryLogger();
  return new BrainService({ license, fetch: landing.fetch, logger, clock, sleep: noSleep, ...extra });
}

const QUESTION = "còn thuốc nhỏ mắt không ạ";
const MESSAGE = { tenant: "shop-gia", kenh: "facebook", nguoi: "k1", chu: QUESTION, maHoiThoai: "facebook:k1", luc: ago(0.5) };
const customer = (minutes: number, chu = QUESTION): Line => ({ chieu: "den", boi: "khach", chu, soAnh: 0, luc: ago(minutes) });
const page = (minutes: number, boi: string, chu = "Dạ để em kiểm tra ạ"): Line => ({ chieu: "di", boi, chu, soAnh: 0, luc: ago(minutes) });

// ---------------------------------------------------------------- phiếu 1: nhường khi người thật đang trực

test("tầng 1 (nhà thuốc): người gõ tay 2 phút trước → bot im, không gọi mô hình, nói rõ nhường tới lúc nào", async () => {
  const landing = fakeLanding({ thread: [customer(3), page(2, "page"), customer(0.5)] });
  const { jobs, timer } = manualTimer();
  const brain = await brainFor(landing, "nha-thuoc", { timer });
  const result = await brain.handleInbound(MESSAGE);
  assert.equal(result.daTraLoi, false);
  assert.equal((result as { viSao: string }).viSao, "nguoi_dang_truc");
  assert.equal((result as { nhuongDen?: string }).nhuongDen, new Date(T0 - 2 * 60_000 + 5 * 60_000).toISOString(), "ô trống → cửa sổ mặc định 5 phút kể từ tin tay");
  assert.equal(landing.acted(), false, "không gửi, không báo");
  assert.equal(jobs.length, 1, "hẹn giao lại lượt khi hết cửa sổ");
});

test("tầng 1: tin tay cách 6 phút → hết cửa sổ, bot trả lời", async () => {
  const landing = fakeLanding({ thread: [customer(8), page(6, "Lan"), customer(0.5)] });
  const brain = await brainFor(landing, "nha-thuoc");
  const result = await brain.handleInbound(MESSAGE);
  assert.notEqual((result as { viSao?: string }).viSao, "nguoi_dang_truc");
  assert.ok(landing.acted());
});

test("tầng 1: tin của chính bot, dòng hệ thống Meta, tin không rõ nguồn 1 phút trước → KHÔNG coi là người, bot trả lời", async () => {
  for (const boi of ["bo-nao", "meta", ""]) {
    const landing = fakeLanding({ thread: [customer(2), page(1, boi, boi === "meta" ? "Bạn đang phản hồi bình luận của một người dùng" : "Dạ còn ạ"), customer(0.5)] });
    const brain = await brainFor(landing, "nha-thuoc");
    const result = await brain.handleInbound(MESSAGE);
    assert.notEqual((result as { viSao?: string }).viSao, "nguoi_dang_truc", `boi="${boi}"`);
    assert.ok(landing.acted(), `boi="${boi}" vẫn trả lời`);
  }
});

test("tầng 1: người trực tự gõ 'em là trợ lý AI…' vẫn là NGƯỜI (không nhận bot bằng chữ ký câu)", async () => {
  const landing = fakeLanding({ thread: [customer(2), page(1, "omi", "Dạ em là trợ lý AI của shop ạ"), customer(0.5)] });
  const brain = await brainFor(landing, "nha-thuoc", { timer: manualTimer().timer });
  assert.equal((await brain.handleInbound(MESSAGE) as { viSao?: string }).viSao, "nguoi_dang_truc");
});

test("tầng 1: đang gõ ở ô soạn (phím cuối 2 phút trước) → bot im; gõ từ 6 phút trước / chỉ mở hội thoại → bot trả lời", async () => {
  const typing = fakeLanding({ thread: [customer(0.5)], hoiThoai: { nguoiGoLuc: ago(2) } });
  const b1 = await brainFor(typing, "nha-thuoc", { timer: manualTimer().timer });
  const r1 = await b1.handleInbound(MESSAGE) as { viSao?: string; nhuongDen?: string };
  assert.equal(r1.viSao, "nguoi_dang_truc");
  assert.equal(r1.nhuongDen, new Date(T0 + 3 * 60_000).toISOString());
  assert.equal(typing.acted(), false);

  const stale = fakeLanding({ thread: [customer(0.5)], hoiThoai: { nguoiGoLuc: ago(6) } });
  await (await brainFor(stale, "nha-thuoc")).handleInbound(MESSAGE);
  assert.ok(stale.acted());

  const opened = fakeLanding({ thread: [customer(0.5)] });
  await (await brainFor(opened, "nha-thuoc")).handleInbound(MESSAGE);
  assert.ok(opened.acted(), "mở hội thoại không phải gõ phím");
});

test("tầng 3: shop khai 10 phút → tin tay 6 phút trước vẫn nhường; ô trống → 5 phút (đã trả lời)", async () => {
  const hoSo = { ...emptyShopProfile(), chuyenNguoi: { ...emptyShopProfile().chuyenNguoi, phutNhuong: 10 } };
  const declared = fakeLanding({ thread: [customer(8), page(6, "Lan"), customer(0.5)], hoSo });
  const r = await (await brainFor(declared, "nha-thuoc", { timer: manualTimer().timer })).handleInbound(MESSAGE) as { viSao?: string; nhuongDen?: string };
  assert.equal(r.viSao, "nguoi_dang_truc");
  assert.equal(r.nhuongDen, new Date(T0 + 4 * 60_000).toISOString());
  const empty = fakeLanding({ thread: [customer(8), page(6, "Lan"), customer(0.5)], hoSo: emptyShopProfile() as unknown as Record<string, unknown> });
  await (await brainFor(empty, "nha-thuoc")).handleInbound(MESSAGE);
  assert.ok(empty.acted());
  // Ô sai kiểu / ngoài khoảng → mặc định, không bao giờ 0 phút hay vô hạn.
  assert.equal(yieldWindowMs(null), 5 * 60_000);
  assert.equal(yieldWindowMs({ chuyenNguoi: { ...emptyShopProfile().chuyenNguoi, phutNhuong: 999 } }), 5 * 60_000);
});

test("tầng 1: người trả lời TRONG LÚC bot soạn → landing bỏ câu bot (nhuongNguoi) → lượt im, không ghi nhớ, không báo", async () => {
  const landing = fakeLanding({ thread: [customer(0.5)], sendAnswer: { guiNgay: false, nhuongNguoi: true } });
  const brain = await brainFor(landing, "nha-thuoc");
  const result = await brain.handleInbound(MESSAGE);
  assert.deepEqual(result, { daTraLoi: false, viSao: "nguoi_dang_truc" });
  assert.equal(landing.calls.filter((c) => c.path === "/api/hop-thu/can-nguoi").length, 0);
  // Đường agent (ghi nhớ SAU khi gửi): câu không đi thì sổ hội thoại không ghi như đã nói. (Máy luật tự lưu
  // trạng thái của nó trước khi gửi — có từ trước, không đổi ở đây.)
  const agentLanding = fakeLanding({ thread: [customer(0.5, "shop ơi có Boston 13 không")], sendAnswer: { guiNgay: false, nhuongNguoi: true } });
  const withAgent = await brainFor(agentLanding, "giay-chay", { agent: new SalesAgent({ model: scriptedModel(["{\"reply\":\"Dạ bác hỏi mẫu nào ạ?\"}"]), logger: new MemoryLogger(), clock, sleep: noSleep }) });
  assert.deepEqual(await withAgent.handleInbound({ ...MESSAGE, chu: "shop ơi có Boston 13 không" }), { daTraLoi: false, viSao: "nguoi_dang_truc" });
  assert.equal(agentLanding.sends().length, 1, "đã xin gửi một lần, landing bỏ");
  assert.equal(agentLanding.memoryWrites().length, 0, "câu không đi thì không nhớ như đã nói");
});

test("humanYield (thuần): lấy mốc người hoạt động MUỘN NHẤT; 'nguoi-bam' không bao giờ nhường", () => {
  const recent = { tin: [page(4, "Lan"), customer(3), page(1, "Lan")], hoiThoai: { daChaoAi: false, dienThoaiDaCho: false, nguoiGoLuc: ago(2) } };
  const v = humanYield({ recent, profile: null, nowMs: T0 });
  assert.deepEqual(v, { yields: true, untilMs: T0 + 4 * 60_000, why: "nhan-tay" });
  assert.deepEqual(humanYield({ recent, profile: null, nowMs: T0, takeover: "nguoi-bam" }), { yields: false });
});

// ---------------------------------------------------------------- phiếu 2: nhường xong phải tiếp quản

test("tầng 1: hết cửa sổ → Xeon xin landing giao lại lượt (đúng hội thoại, sau hạn); tin mới tới trước hạn → huỷ hẹn cũ", async () => {
  const landing = fakeLanding({ thread: [customer(10), page(4, "Lan"), customer(0.5)] });
  const { jobs, timer } = manualTimer();
  const brain = await brainFor(landing, "nha-thuoc", { timer });
  await brain.handleInbound(MESSAGE);
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0]!.ms >= 60_000 && jobs[0]!.ms <= 60_000 + 5000, `hẹn sau ~1 phút (tin tay 4 phút trước, cửa sổ 5), được ${jobs[0]!.ms}`);
  assert.deepEqual(brain.pendingTakeovers(), ["shop-gia|facebook:k1"]);
  jobs[0]!.run();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(landing.takeovers(), ["facebook:k1"], "landing quyết có giao lại không (bot còn bật, khách còn chờ)");
  assert.deepEqual(brain.pendingTakeovers(), []);

  // Khách nhắn thêm trong cửa sổ: hẹn cũ huỷ, lượt mới tự hẹn lại.
  const again = fakeLanding({ thread: [customer(10), page(2, "Lan"), customer(1), customer(0.2, "alo shop")] });
  const t2 = manualTimer();
  const b2 = await brainFor(again, "nha-thuoc", { timer: t2.timer });
  await b2.handleInbound({ ...MESSAGE, luc: ago(1) });
  await b2.handleInbound({ ...MESSAGE, chu: "alo shop", luc: ago(0.2) });
  assert.equal(t2.jobs.length, 2);
  assert.equal(t2.jobs[0]!.cancelled, true, "hẹn của tin trước bị huỷ");
  assert.equal(t2.jobs[1]!.cancelled, false);
});

test("tầng 1: kênh Zalo / tin khách quá 6 giờ → không hẹn tiếp quản; 'bot trả lời tiếp' của người → trả lời ngay dù người vừa nhắn, câu gửi mang tiepQuan", async () => {
  const zalo = fakeLanding({ thread: [customer(3), page(2, "Lan"), customer(0.5)] });
  const tz = manualTimer();
  await (await brainFor(zalo, "nha-thuoc", { timer: tz.timer })).handleInbound({ ...MESSAGE, kenh: "zalo", maHoiThoai: "zalo:k1" });
  assert.equal(tz.jobs.length, 0, "nhóm Zalo / tài khoản cá nhân không bị bộ hẹn chạy luồng Fanpage");

  const old = fakeLanding({ thread: [customer(400), page(2, "Lan")] });
  const to = manualTimer();
  await (await brainFor(old, "nha-thuoc", { timer: to.timer })).handleInbound({ ...MESSAGE, luc: ago(400) });
  assert.equal(to.jobs.length, 0);

  const pressed = fakeLanding({ thread: [customer(3), page(1, "Lan"), customer(0.5)] });
  const result = await (await brainFor(pressed, "nha-thuoc")).handleInbound({ ...MESSAGE, tiepQuan: "nguoi-bam" });
  assert.notEqual((result as { viSao?: string }).viSao, "nguoi_dang_truc");
  const sent = pressed.sends();
  if (sent.length > 0) assert.equal(sent[0]!["tiepQuan"], true, "landing không bỏ câu này vì người vừa nhắn");
  assert.ok(pressed.acted());
});

// ---------------------------------------------------------------- phiếu 3: chào AI khi khách chỉ khép chuyện

test("closingOnly (thuần, từ vựng tầng 1 JSON): khép chuyện thì không chào; có câu hỏi thật thì chào", () => {
  for (const pack of ["giay-chay", "nha-thuoc"]) {
    const rc = loadIntentRules(pack).reconcile;
    for (const s of ["ok", "Oke shop", "cảm ơn em nhé", "nhận được rồi shop", "dạ vâng ạ", "👍", "thanks shop"]) assert.equal(closingOnly(s, rc), true, `${pack}: "${s}"`);
    for (const s of ["ok còn size 42 không em", "shop ơi có Boston 13 không", "cảm ơn, còn hàng không", "còn thuốc nhỏ mắt không ạ", ""]) assert.equal(closingOnly(s, rc), false, `${pack}: "${s}"`);
  }
});

test("gói giày thật, lượt đầu: 'ok' / 'cảm ơn em nhé' / 'nhận được rồi shop' → câu gửi KHÔNG xin chào; 'ok còn size 42 không em' → có chào", async () => {
  const say = async (chu: string, models: { agent?: ChatModelPort } = {}) => {
    const landing = fakeLanding({ thread: [customer(0.5, chu)] });
    const brain = await brainFor(landing, "giay-chay", models.agent ? { agent: new SalesAgent({ model: models.agent, logger: new MemoryLogger(), clock, sleep: noSleep }) } : {});
    await brain.handleInbound({ ...MESSAGE, chu });
    return landing.sends();
  };
  for (const chu of ["ok", "cảm ơn em nhé", "nhận được rồi shop"]) {
    const runs = [await say(chu), await say(chu, { agent: scriptedModel(["{\"reply\":\"Dạ vâng ạ\"}"]) })];
    assert.ok(runs.some((sent) => sent.length > 0), `"${chu}": bot vẫn đáp lễ (có câu gửi để soát)`);
    for (const sent of runs) for (const body of sent) assert.notEqual(body["chaoAi"], true, `"${chu}" không được chào`);
  }
  const asked = await say("ok còn size 42 không em", { agent: scriptedModel(["{\"reply\":\"Dạ bác đang hỏi mẫu nào ạ?\"}"]) });
  assert.equal(asked[0]?.["chaoAi"], true, "lượt đầu có câu hỏi thật thì chào");
});

test("chào: bot từng đáp lễ (không chào) rồi khách hỏi thật → chào lần đầu; người trực từng nhắn / đã chào → không chào", async () => {
  const run = async (thread: Line[], hoiThoai: Record<string, unknown> = {}) => {
    const landing = fakeLanding({ thread, hoiThoai });
    const brain = await brainFor(landing, "giay-chay", { agent: new SalesAgent({ model: scriptedModel(["{\"reply\":\"Dạ bác hỏi mẫu nào ạ?\"}"]), logger: new MemoryLogger(), clock, sleep: noSleep }), timer: manualTimer().timer });
    await brain.handleInbound({ ...MESSAGE, chu: "shop ơi có Boston 13 không" });
    return landing.sends()[0] ?? {};
  };
  assert.equal((await run([customer(60, "ok"), page(59, "bo-nao", "Dạ vâng ạ"), customer(0.5, "shop ơi có Boston 13 không")]))["chaoAi"], true);
  assert.equal((await run([customer(60, "hi"), page(59, "Lan", "Dạ chào bác"), customer(0.5, "shop ơi có Boston 13 không")]))["chaoAi"], undefined);
  assert.equal((await run([customer(0.5, "shop ơi có Boston 13 không")], { daChaoAi: true }))["chaoAi"], undefined);
});
