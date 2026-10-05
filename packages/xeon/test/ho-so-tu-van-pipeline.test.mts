/**
 * 05/10/2026 — phiếu Desk nhóm NHU CẦU / TƯ VẤN qua cả đường đi một lượt (gói `giay-chay` thật, landing giả):
 *   - 06/09 hỏi ĐÍCH DANH mẫu + size → ghi chú "KHACH HOI DICH DANH MAU" cho agent và LLM#3 (thẻ `dich_danh`),
 *     agent lỡ hỏi cự ly / pace thì cổng cắt mệnh đề đó; tin tiếp nối "size 42" vẫn là đích danh;
 *   - 03/09 nhu cầu PHỔ THÔNG → khối PHO_THONG (tra kho theo mục đích, size, giới tính), không khung nhiều dòng;
 *   - 03/09 + 06/09 hồ sơ chạy bộ đọc từ CẢ PHIÊN (tin ngắn "Chạy 5 km thôi" vẫn đủ hồ sơ, chạy nhẹ = dải chậm →
 *     Supernova trước, không dòng đua), thiếu pace thì hỏi và chưa chào dòng, page đã hỏi pace một lần thì không hỏi lại.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import { BrainService, LicenseLedger, LicenseService, MemoryDossierStore, MemoryLogger, generateSigningKey, type ChatMessage, type ChatModelPort, type FetchLike } from "@sp/xeon";

const T0 = Date.parse("2026-10-05T09:00:00.000Z");
const clock = { now: () => new Date(T0) };
const ago = (minutes: number): string => new Date(T0 - minutes * 60_000).toISOString();
const noSleep = async (): Promise<void> => undefined;

interface Line { chieu: "den" | "di"; boi: string; chu: string; soAnh: number; luc: string; maTin?: string }
interface Call { path: string; body: Record<string, unknown> | null }

function scriptedModel(answers: string[]): ChatModelPort & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen, ready: () => true,
    complete: async (messages) => { seen.push(messages.map((m) => ({ ...m }))); const next = answers.shift(); return next === undefined ? { ok: false, viSao: "het", transient: false } : { ok: true, text: next, model: "gia" }; }
  };
}

function fakeLanding(o: { thread: Line[]; found: unknown[] }) {
  const calls: Call[] = [];
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "catalog.find", "conversation.recent"];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: o.thread, hoiThoai: { daChaoAi: true, dienThoaiDaCho: false, theDaGui: [] } } });
      if (tool === "catalog.find") return reply({ ok: true, data: { ketQua: o.found } });
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 500 } });
      return reply({ ok: true, data: { items: [], rows: [], truncated: false, asOf: "" } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: null });
    if (u.pathname === "/api/hop-thu/gui") return reply({ ok: true, guiNgay: true });
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  return {
    fetch,
    sent: () => calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => String(c.body!["chu"])),
    finds: () => calls.filter((c) => c.path === "/api/bo-nao/cong-cu" && c.body !== null && c.body["ten"] === "catalog.find").map((c) => c.body!["input"] as Record<string, unknown>)
  };
}

async function brainFor(landing: { fetch: FetchLike }, models: { analyzer: ChatModelPort; agent?: ChatModelPort; writer?: ChatModelPort }) {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "shopgiay", tenShop: "Shop Giay", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop.vn" });
  const logger = new MemoryLogger();
  const dossier = new MemoryDossierStore();
  const { ContextAnalyzer, SalesAgent, DraftWriter } = await import("@sp/xeon");
  const brain = new BrainService({
    license, fetch: landing.fetch, logger, clock, sleep: noSleep, dossier,
    analyzer: new ContextAnalyzer({ model: models.analyzer, logger }),
    agent: models.agent ? new SalesAgent({ model: models.agent, logger, clock, sleep: noSleep }) : undefined,
    writer: models.writer ? new DraftWriter({ model: models.writer, logger }) : null
  });
  return { brain, dossier };
}

const analysis = (over: Record<string, unknown>): string => JSON.stringify({
  intent: "product_advice", confidence: 0.9, entities: {}, needProfile: { buyerType: "", experience: "", insistOnProduct: false }, needBrief: {},
  focus: { product: "", products: [], changed: false, reason: "", roles: [] }, contextSummary: "", episodeSummary: "", customerGoal: "",
  referencesPreviousMessage: false, missingInformation: [], lookupCommands: [], riskFlags: [], ...over
});

const item = (ma: string, ten: string, gia: number, sizes: string[]) => ({ ma, ten, hang: "adidas", loai: "HANG SAN", cac_size: sizes.map((size) => ({ size, gia, so_luong: 1 })), anh: "", link: `https://shop.vn/product/${ma.toLowerCase()}` });
const ADIZERO = [item("JH1111", "ADIZERO SL 2 M", 2490000, ["42", "42 2/3"])];
const RUNNING = [item("SN1001", "SUPERNOVA RISE M", 2900000, ["42"]), item("DR2002", "DURAMO SL M", 1500000, ["42"]), item("AP3003", "ADIZERO ADIOS PRO 4 M", 5900000, ["42"])];
const msg = (chu: string) => ({ tenant: "shopgiay", kenh: "facebook", nguoi: "k1", chu, maHoiThoai: "facebook:k1", maTin: "m_now", luc: ago(0.2) });
const now = (chu: string): Line => ({ maTin: "m_now", chieu: "den", boi: "khach", chu, soAnh: 0, luc: ago(0.2) });
const systemOf = (agent: { seen: ChatMessage[][] }): string => agent.seen[0]![0]!.content;

test("phiếu 06/09 qua đường đi: hỏi đích danh mẫu + size → ghi chú ĐÍCH DANH; agent lỡ hỏi cự ly / pace thì cổng cắt, câu tồn ở lại", async () => {
  const said = "Adizero SL2 size 42,5";
  const site = fakeLanding({ thread: [now(said)], found: ADIZERO });
  const analyzer = scriptedModel([analysis({ intent: "ask_size", entities: { productName: "adizero sl2", size: "42.5" } })]);
  const agent = scriptedModel(["{\"reply\":\"Dạ mẫu Adizero SL 2 bên em còn size 42 và 42 2/3 ạ, anh thường chạy cự ly bao nhiêu và pace tầm bao nhiêu ạ?\"}"]);
  const { brain, dossier } = await brainFor(site, { analyzer, agent });
  const result = await brain.handleInbound(msg(said));
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  const system = systemOf(agent);
  assert.match(system, /KHACH HOI DICH DANH MAU/);
  assert.doesNotMatch(system, /HO SO TU VAN \(giày/, "no profile block for a named item");
  const text = site.sent()[0]!;
  assert.match(text, /còn size 42 và 42 2\/3/, text);
  assert.doesNotMatch(text, /pace|cự ly/i, text);
  assert.ok(dossier.last()!.cong!.dauVet.some((t) => t.startsWith("consult_no_ask")), dossier.last()!.cong!.dauVet.join(","));
});

test("phiếu 06/09: tin tiếp nối \"size 42\" (tên mẫu ở lượt trước, cùng phiên) vẫn là đích danh", async () => {
  const thread: Line[] = [
    { chieu: "den", boi: "khach", chu: "Adizero SL2 size 42,5", soAnh: 0, luc: ago(4) },
    { chieu: "di", boi: "bo-nao", chu: "Dạ mẫu Adizero SL 2 bên em còn size 42 và 42 2/3 ạ.", soAnh: 0, luc: ago(3.5) },
    now("size 42")
  ];
  const site = fakeLanding({ thread, found: ADIZERO });
  const analyzer = scriptedModel([analysis({ intent: "ask_size", entities: { size: "42" }, focus: { product: "Adizero SL 2", products: [], changed: false, reason: "", roles: [] } })]);
  const agent = scriptedModel(["{\"reply\":\"Dạ size 42 mẫu Adizero SL 2 bên em còn ạ.\"}"]);
  const { brain } = await brainFor(site, { analyzer, agent });
  await brain.handleInbound(msg("size 42"));
  assert.match(systemOf(agent), /KHACH HOI DICH DANH MAU/);
});

test("phiếu 06/09, lưới LLM#3 (agent tắt): thẻ dich_danh nạp luật 38b, không còn luật hỏi \"chạy bộ hay đi chơi\"", async () => {
  const said = "Adizero SL2 size 42,5";
  const site = fakeLanding({ thread: [now(said)], found: ADIZERO });
  const analyzer = scriptedModel([analysis({ intent: "product_advice", entities: { productName: "adizero sl2", size: "42.5" } })]);
  const writer = scriptedModel(["{\"reply\":\"Dạ mẫu Adizero SL 2 bên em còn size 42 và 42 2/3 ạ.\",\"needsHuman\":false}"]);
  const { brain } = await brainFor(site, { analyzer, writer });
  await brain.handleInbound(msg(said));
  const prompt = writer.seen[0]!.map((m) => m.content).join("\n");
  assert.match(prompt, /KHACH HOI DICH DANH MAU\/DONG/, "rule 38b is loaded");
  assert.doesNotMatch(prompt, /lay chay bo hay di choi cho dep/, "no rule asks the named-item customer what it is for");
  assert.doesNotMatch(site.sent()[0]!, /pace|cự ly|tốc độ/i);
});

test("phiếu 03/09 phổ thông qua đường đi: đi học / thể dục / đa năng → PHO_THONG (mục đích, size, giới tính); không khung nhiều dòng", async () => {
  const said = "Tìm giày nữ size 39 cho cháu đi học, thể dục, đa năng một tý có mẫu nào hợp lý gửi em xin ít mẫu có sẵn kèm giá nhé";
  const site = fakeLanding({ thread: [now(said)], found: RUNNING });
  const analyzer = scriptedModel([analysis({ entities: { size: "39" } })]);
  const agent = scriptedModel(["{\"reply\":\"Dạ em gửi vài mẫu hợp đi học, đa năng ạ.\"}"]);
  const { brain } = await brainFor(site, { analyzer, agent });
  await brain.handleInbound(msg(said));
  const system = systemOf(agent);
  assert.match(system, /NHU CAU PHO THONG.*muc_dich="di_hoc_di_choi_da_nang", size="39", gioi_tinh="nu"/);
  assert.doesNotMatch(system, /KHUNG TU VAN NHIEU DONG/);
  assert.doesNotMatch(system, /HO SO TU VAN \(giày/);
  assert.ok(!site.finds().some((f) => f["phan_khuc"] !== undefined), "no line scoring for an everyday need");
});

test("phiếu 03/09 + 06/09: tin ngắn \"Chạy 5 km thôi\" — hồ sơ đọc cả phiên: đủ (chạy nhẹ), khung nhiều dòng Supernova trước, không dòng đua", async () => {
  const thread: Line[] = [
    { chieu: "den", boi: "khach", chu: "tư vấn giày chạy bộ nam size 42", soAnh: 0, luc: ago(4) },
    { chieu: "di", boi: "bo-nao", chu: "Dạ anh thường chạy cự ly bao nhiêu, pace tầm bao nhiêu ạ?", soAnh: 0, luc: ago(3.5) },
    now("Chạy 5 km thôi")
  ];
  const site = fakeLanding({ thread, found: RUNNING });
  // LLM#1 read nothing of the profile and listed the size as missing: neither blocks the lines (size is for closing).
  const analyzer = scriptedModel([analysis({ intent: "unknown", missingInformation: ["size"], needBrief: { missingCritical: ["size"] } })]);
  const agent = scriptedModel(["{\"reply\":\"Dạ chạy nhẹ 5km thì anh tham khảo Supernova ạ.\"}"]);
  const { brain } = await brainFor(site, { analyzer, agent });
  await brain.handleInbound(msg("Chạy 5 km thôi"));
  const system = systemOf(agent);
  assert.match(system, /HO SO TU VAN \(giày chạy bộ\) DA DU/);
  const block = /KHUNG TU VAN NHIEU DONG[^\n]*\n((?:• [^\n]*\n?)+)/.exec(system);
  assert.ok(block !== null, system.slice(0, 3000));
  assert.match(block![1]!.split("\n")[0]!, /Supernova/i);
  assert.doesNotMatch(block![1]!, /Adios/i);
  assert.ok(site.finds().some((f) => f["phan_khuc"] === "daily"));
});

test("phiếu 03/09: \"a chạy 5km\" — thiếu tốc độ → hỏi, CHƯA chào dòng (không chấm dòng)", async () => {
  const site = fakeLanding({ thread: [now("a chạy 5km, tư vấn giúp giày chạy bộ")], found: RUNNING });
  const analyzer = scriptedModel([analysis({})]);
  const agent = scriptedModel(["{\"reply\":\"Dạ anh chạy pace tầm bao nhiêu ạ?\"}"]);
  const { brain } = await brainFor(site, { analyzer, agent });
  await brain.handleInbound(msg("a chạy 5km, tư vấn giúp giày chạy bộ"));
  const system = systemOf(agent);
  assert.match(system, /con thieu: tốc độ/);
  assert.doesNotMatch(system, /KHUNG TU VAN NHIEU DONG/);
  assert.match(site.sent()[0]!, /pace/, "asking the missing piece the first time is right");
});

test("phiếu 06/09: page đã hỏi pace một lần, khách chưa trả lời rõ → không hỏi lại; gợi ý theo điều đã biết", async () => {
  const thread: Line[] = [
    { chieu: "den", boi: "khach", chu: "tư vấn giày chạy bộ, mình chạy 5km", soAnh: 0, luc: ago(5) },
    { chieu: "di", boi: "bo-nao", chu: "Dạ anh chạy pace tầm bao nhiêu ạ?", soAnh: 0, luc: ago(4) },
    now("cũng bình thường thôi")
  ];
  const site = fakeLanding({ thread, found: RUNNING });
  const analyzer = scriptedModel([analysis({ intent: "unknown" })]);
  const agent = scriptedModel(["{\"reply\":\"Dạ em gợi ý anh mẫu Supernova Rise ạ. Anh chạy pace tầm bao nhiêu ạ?\"}"]);
  const { brain } = await brainFor(site, { analyzer, agent });
  await brain.handleInbound(msg("cũng bình thường thôi"));
  assert.match(systemOf(agent), /DA HOI tốc độ/);
  const text = site.sent()[0]!;
  assert.match(text, /Supernova Rise/);
  assert.doesNotMatch(text, /pace/i, text);
});
