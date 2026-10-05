/**
 * 05/10/2026 — ba phiếu Desk nhóm "lượt đồng thời / gửi trùng / nhớ đã gửi gì", phần BỘ NÃO:
 *   - mỗi câu gửi nói rõ nó trả lời tin khách MỚI NHẤT nào lượt này đã thấy (`theoTin`) và dựa trên bằng chứng
 *     gì (`bangChung`: yếu/chắc, số ảnh đọc được, có sự thật sản phẩm) — cửa gửi landing phán theo đó;
 *   - landing bỏ câu vì khách đã nhắn thêm (`tinMoi`) → lượt kết thúc như bị gộp vào tin sau, không nhớ, không báo;
 *     landing bỏ vì tin đã được trả lời (`daTraLoi`) → im, không nhớ;
 *   - người bấm "bot trả lời tiếp" ghi mốc `botTiepLuc`: hoạt động của người TRƯỚC mốc không còn giữ bot im
 *     (tin khách tới giữa lượt bấm không rơi lại vào nhường);
 *   - "đã hỏi lại" chỉ tính trong cửa sổ hỏi lại của ngành (30 phút), và quên đếm sau khi đã gọi người.
 * Tầng 1 thử bằng ngành NHÀ THUỐC; cửa sổ hỏi lại thử thêm với gói giày thật (tầng 2).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import {
  BrainService, ContextAnalyzer, LicenseLedger, LicenseService, MemoryLogger, SalesAgent, askBackWindowMinutes, generateSigningKey, humanYield, newestCustomerMessage,
  type ChatModelPort, type FetchLike
} from "@sp/xeon";
import { loadPack } from "@sp/brain";

const T0 = Date.parse("2026-10-05T09:00:00.000Z");
const clock = { now: () => new Date(T0) };
const ago = (minutes: number): string => new Date(T0 - minutes * 60_000).toISOString();
const noSleep = async (): Promise<void> => undefined;

interface Line { chieu: string; boi: string; chu: string; soAnh: number; luc: string; maTin?: string }
interface Call { path: string; body: Record<string, unknown> | null }

function fakeLanding(o: { thread: Line[]; hoiThoai?: Record<string, unknown>; sendAnswer?: Record<string, unknown>; state?: Record<string, unknown> | null; found?: unknown[] }) {
  const calls: Call[] = [];
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "storefront.link", "catalog.find", "conversation.recent"];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: o.thread, hoiThoai: { daChaoAi: true, dienThoaiDaCho: false, theDaGui: [], ...(o.hoiThoai ?? {}) } } });
      if (tool === "catalog.find") return reply({ ok: true, data: { ketQua: o.found ?? [] } });
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 50 } });
      return reply({ ok: true, data: { items: [], rows: [], truncated: false, asOf: "" } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: init.method === "GET" ? (o.state ?? null) : null });
    if (u.pathname === "/api/hop-thu/gui") return reply({ ok: true, ketQua: o.sendAnswer ?? { guiNgay: true } });
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  return {
    fetch, calls,
    sends: () => calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => c.body!),
    notices: () => calls.filter((c) => c.path === "/api/hop-thu/can-nguoi").map((c) => String(c.body!["lyDo"])),
    memoryWrites: () => calls.filter((c) => c.path.startsWith("/api/bo-nao/tri-nho/") && c.body !== null)
  };
}

async function brainFor(landing: { fetch: FetchLike }, nganh: string, extra: Partial<ConstructorParameters<typeof BrainService>[0]> = {}) {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "shop-gia", tenShop: "Shop Giả", nganh, manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop-gia.vn" });
  return new BrainService({ license, fetch: landing.fetch, logger: new MemoryLogger(), clock, sleep: noSleep, ...extra });
}

function scriptedModel(answers: string[]): ChatModelPort {
  return { ready: () => true, complete: async () => { const next = answers.shift(); return next === undefined ? { ok: false, viSao: "het", transient: true } : { ok: true, text: next, model: "gia" }; } };
}

const QUESTION = "còn thuốc nhỏ mắt không ạ";
const MESSAGE = { tenant: "shop-gia", kenh: "facebook", nguoi: "k1", chu: QUESTION, maHoiThoai: "facebook:k1", maTin: "m.1", luc: ago(0.5) };
const customer = (minutes: number, maTin: string, chu = QUESTION): Line => ({ chieu: "den", boi: "khach", chu, soAnh: 0, luc: ago(minutes), maTin });
const page = (minutes: number, boi: string, chu = "Dạ để em kiểm tra ạ"): Line => ({ chieu: "di", boi, chu, soAnh: 0, luc: ago(minutes), maTin: `p.${minutes}` });

// ---------------------------------------------------------------- câu gửi mang theoTin + bằng chứng

test("tầng 1 (nhà thuốc): câu gửi nói nó trả lời tin khách MỚI NHẤT lượt này đã thấy, kèm bằng chứng", async () => {
  // Lượt được đẩy cho m.1 nhưng hội thoại đã có m.2 (khách nhắn tiếp, chưa tới lượt riêng): lượt này THẤY m.2.
  const landing = fakeLanding({ thread: [customer(1, "m.1"), customer(0.3, "m.2", "loại cho trẻ em ấy")] });
  await (await brainFor(landing, "nha-thuoc")).handleInbound(MESSAGE);
  const sent = landing.sends();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!["theoTin"], "m.2");
  const evidence = sent[0]!["bangChung"] as { yeu: boolean; soAnh: number; suThat: boolean };
  assert.equal(typeof evidence.yeu, "boolean");
  assert.equal(evidence.soAnh, 0);
  assert.equal(evidence.suThat, false);
});

test("newestCustomerMessage: tin mới nhất của khách trong luồng; tin được đẩy mà luồng chưa có thì lấy tin đó", () => {
  const lines = [{ chieu: "den", maTin: "a" }, { chieu: "di", maTin: "b" }, { chieu: "den", maTin: "c" }, { chieu: "di", maTin: "d" }];
  assert.equal(newestCustomerMessage(lines, "a"), "c");
  assert.equal(newestCustomerMessage(lines, "x"), "x");
  assert.equal(newestCustomerMessage([], ""), "");
});

// ---------------------------------------------------------------- landing bỏ câu

test("tầng 1: landing bỏ câu vì khách nhắn thêm (tinMoi) → lượt như bị gộp vào tin sau: không nhớ, không báo người", async () => {
  const landing = fakeLanding({ thread: [customer(0.5, "m.1")], sendAnswer: { guiNgay: false, tinMoi: true } });
  const result = await (await brainFor(landing, "nha-thuoc")).handleInbound(MESSAGE);
  assert.deepEqual(result, { daTraLoi: false, viSao: "gop_vao_tin_sau" });
  assert.equal(landing.sends().length, 1, "đã xin gửi một lần, landing bỏ");
  assert.deepEqual(landing.notices(), []);
  // Đường agent (ghi nhớ SAU khi gửi): câu không đi thì sổ hội thoại không ghi như đã nói.
  const viaAgent = fakeLanding({ thread: [customer(0.5, "m.1", "shop ơi có giày chạy không")], sendAnswer: { guiNgay: false, tinMoi: true } });
  const withAgent = await brainFor(viaAgent, "giay-chay", { agent: new SalesAgent({ model: scriptedModel(["{\"reply\":\"Dạ bác tìm mẫu nào ạ?\"}"]), logger: new MemoryLogger(), clock, sleep: noSleep }) });
  assert.deepEqual(await withAgent.handleInbound({ ...MESSAGE, chu: "shop ơi có giày chạy không" }), { daTraLoi: false, viSao: "gop_vao_tin_sau" });
  assert.equal(viaAgent.memoryWrites().length, 0, "câu không đi thì không nhớ như đã nói");
});

test("tầng 1: landing bỏ câu vì tin đã được trả lời (daTraLoi) → im, không nhớ, không báo", async () => {
  const landing = fakeLanding({ thread: [customer(0.5, "m.1")], sendAnswer: { guiNgay: false, daTraLoi: true } });
  const result = await (await brainFor(landing, "nha-thuoc")).handleInbound(MESSAGE);
  assert.deepEqual(result, { daTraLoi: false, viSao: "da_tra_loi_tin_nay" });
  assert.deepEqual(landing.notices(), []);
});

test("bình luận công khai không mang theoTin (trả lời DƯỚI từng bình luận, không phán trùng)", async () => {
  const landing = fakeLanding({ thread: [customer(0.5, "bl.1")] });
  await (await brainFor(landing, "nha-thuoc")).handleInbound({ ...MESSAGE, kenh: "facebook-binh-luan", maHoiThoai: "facebook-binh-luan:k1", maTin: "bl.1" });
  for (const body of landing.sends()) assert.equal(body["theoTin"], undefined);
});

// ---------------------------------------------------------------- cờ "bot trả lời tiếp" không mất khi có tin mới

test("tầng 1: người bấm 'bot trả lời tiếp' rồi khách nhắn thêm giữa lượt → lượt mới (không cờ) KHÔNG rơi lại vào nhường", async () => {
  // Người nhắn tay 2 phút trước, bấm "bot trả lời tiếp" 1 phút trước, khách nhắn m.2 → lượt m.2 không mang tiepQuan.
  const handedBack = fakeLanding({ thread: [customer(3, "m.1"), page(2, "Lan"), customer(0.3, "m.2", "loại cho trẻ em ấy")], hoiThoai: { botTiepLuc: ago(1) } });
  const r = await (await brainFor(handedBack, "nha-thuoc")).handleInbound({ ...MESSAGE, maTin: "m.2", chu: "loại cho trẻ em ấy", luc: ago(0.3) });
  assert.notEqual((r as { viSao?: string }).viSao, "nguoi_dang_truc");
  assert.equal(handedBack.sends().length, 1);
  // Người nhắn lại SAU khi bấm → lại nhường như thường.
  const after = humanYield({ recent: { tin: [customer(3, "m.1"), page(0.5, "Lan")], hoiThoai: { daChaoAi: false, dienThoaiDaCho: false, botTiepLuc: ago(1) } }, profile: null, nowMs: T0 });
  assert.equal(after.yields, true);
  const typedAfter = humanYield({ recent: { tin: [customer(3, "m.1")], hoiThoai: { daChaoAi: false, dienThoaiDaCho: false, botTiepLuc: ago(1), nguoiGoLuc: ago(0.5) } }, profile: null, nowMs: T0 });
  assert.equal(typedAfter.yields, true);
});

// ---------------------------------------------------------------- cửa sổ hỏi lại

test("askBackWindowMinutes: cửa sổ của ngành (ask_back_once), thiếu thì 30 phút", () => {
  assert.equal(askBackWindowMinutes(loadPack("nha-thuoc")), 30);
  assert.equal(askBackWindowMinutes({ gates: [{ kind: "ask_back_once", windowMinutes: 12 }] }), 12);
  assert.equal(askBackWindowMinutes({ gates: [] }), 30);
  assert.equal(askBackWindowMinutes({}), 30);
});

const STOCK_ANALYSIS = JSON.stringify({
  intent: "ask_size", confidence: 0.9, entities: { productLine: "Adizero Boston", modelVersion: "13", size: "42" },
  needProfile: { buyerType: "perf", experience: "", insistOnProduct: false }, needBrief: { sport: "running" },
  focus: { product: "JP9252", products: ["JP9252"], changed: false, reason: "", roles: [] },
  contextSummary: "", episodeSummary: "", customerGoal: "", referencesPreviousMessage: false, missingInformation: [],
  lookupCommands: [{ command: "resolve_stock", args: { productCode: "JP9252", size: "42" } }], riskFlags: []
});

async function unclearTurn(lastAskBackMinutesAgo: number | null) {
  const said = "đôi này size 42 còn không";
  const state = lastAskBackMinutesAgo === null ? null : { tenant: "shop-gia", conversationId: "facebook:k1", turns: [], askBackCount: 1, lastAskBackAt: ago(lastAskBackMinutesAgo) };
  const landing = fakeLanding({ thread: [customer(0.2, "m.9", said)], state, found: [] });
  const brain = await brainFor(landing, "giay-chay", { analyzer: new ContextAnalyzer({ model: scriptedModel([STOCK_ANALYSIS]), logger: new MemoryLogger() }) });
  const result = await brain.handleInbound({ ...MESSAGE, chu: said, maTin: "m.9", luc: ago(0.2) });
  return { landing, result };
}

test("tầng 2 (giày): đã hỏi lại 10 phút trước mà vẫn chưa rõ mẫu → gọi người (không hỏi lần hai), rồi QUÊN đếm hỏi lại", async () => {
  const { landing, result } = await unclearTurn(10);
  assert.equal((result as { viSao?: string }).viSao, "chuyen_nguoi_that");
  assert.deepEqual(landing.notices(), ["uncertain_product_twice:no_product"]);
  const saved = landing.memoryWrites().at(-1)!.body as { trangThai: { askBackCount?: number; lastAskBackAt?: string } };
  assert.equal(saved.trangThai.askBackCount, undefined, "đã gọi người: đếm lại từ đầu, tin mơ hồ sau không thành gọi người liên tục");
  assert.equal(saved.trangThai.lastAskBackAt, undefined);
});

test("tầng 2 (giày): lần hỏi lại trước cách 40 phút (ngoài cửa sổ) → được hỏi lại, không gọi người", async () => {
  const { landing, result } = await unclearTurn(40);
  assert.equal((result as { hanhDong?: string }).hanhDong, "ask_back", JSON.stringify(result));
  assert.deepEqual(landing.notices(), []);
  const sent = landing.sends()[0]!;
  assert.equal((sent["bangChung"] as { yeu: boolean }).yeu, true, "câu hỏi lại là câu YẾU — được đính chính một lần nếu lượt sau rõ hơn");
});
