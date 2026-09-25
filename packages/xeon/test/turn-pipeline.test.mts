/**
 * The TURN PIPELINE (25/09/2026): Sales Desk's order of answering, with Xeon's parts in each seat —
 * LLM#1 analysis → rule router → tier-2 agent → LLM#3 draft → rule engine — one road for the live
 * door and for the AI desk's draft / sandbox ("khong-gui": nothing sent, nothing remembered).
 *
 * Every model here is a script. The fake landing records every call so a test can say what was
 * sent, who was told, and what was written to memory.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import {
  AGENT_TOOLS, AiDeskService, BrainService, CatalogVerifier, ContextAnalyzer, DraftWriter, GatewayBreaker, ImageFetcher, LicenseLedger, LicenseService, MemoryDossierStore, MemoryLogger,
  ReplyDispatcher, SalesAgent, TurnPipeline, generateSigningKey,
  type ChatMessage, type ChatModelPort, type FetchLike, type ImageFetch
} from "@sp/xeon";
import { loadIntentRules } from "@sp/brain";
import { emptyShopProfile } from "@sp/contract";

const T0 = Date.parse("2026-09-25T09:00:00.000Z");
const clock = { now: () => new Date(T0) };
const noSleep = async (): Promise<void> => undefined;

const BOSTON = [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M", loai: "HANG SAN", cac_size: [{ size: "42", gia: 3290000 }], anh: "", link: "https://shop.vn/product/jp9252" }];

const ANALYSIS = JSON.stringify({
  intent: "ask_size", confidence: 0.9, entities: { productLine: "Adizero Boston", modelVersion: "13", size: "42" },
  needProfile: { buyerType: "perf", experience: "", insistOnProduct: false }, needBrief: { sport: "running" },
  focus: { product: "JP9252", products: ["JP9252"], changed: false, reason: "", roles: [] },
  contextSummary: "Khach hoi Boston 13 size 42", episodeSummary: "Khach dang xem Boston 13", customerGoal: "mua Boston 13 size 42",
  referencesPreviousMessage: false, missingInformation: [], lookupCommands: [{ command: "resolve_stock", args: { productCode: "JP9252", size: "42" } }], riskFlags: []
});
/** The same reading with another intent: what LLM#1 would say of a greeting. */
const analysisOf = (intent: string, over: Record<string, unknown> = {}): string => JSON.stringify({ ...JSON.parse(ANALYSIS) as Record<string, unknown>, intent, ...over });
const isAgentCall = (messages: ChatMessage[]): boolean => /CONG CU \(moi luot chi goi MOT cong cu/.test(messages[0]?.content ?? "");

/** A model that answers from a script, recording what it was shown. An Error entry = a transient gateway failure. */
function scriptedModel(answers: (string | Error)[], ready = true): ChatModelPort & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen,
    ready: () => ready,
    complete: async (messages) => {
      seen.push(messages.map((m) => ({ ...m })));
      const next = answers.shift();
      if (next === undefined || next instanceof Error) return { ok: false, viSao: next?.message ?? "het kich ban", transient: true };
      return { ok: true, text: next, model: "gia" };
    }
  };
}

interface Call { path: string; body: Record<string, unknown> | null }

function fakeLanding(thread: { chieu: string; boi: string; chu: string; soAnh: number; luc: string }[] = []) {
  const calls: Call[] = [];
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "storefront.link", "catalog.find", "shop.bankAccount", "conversation.recent"];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: thread } });
      if (tool === "catalog.find") return reply({ ok: true, data: { ketQua: BOSTON } });
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 5000 } });
      return reply({ ok: true, data: { items: [], rows: [], truncated: false, asOf: "" } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: null });
    if (u.pathname === "/api/hop-thu/gui") return reply({ ok: true });
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  return {
    fetch, calls,
    sent: () => calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => String(c.body!["chu"])),
    notices: () => calls.filter((c) => c.path === "/api/hop-thu/can-nguoi").map((c) => String(c.body!["lyDo"])),
    memoryWrites: () => calls.filter((c) => c.path.startsWith("/api/bo-nao/tri-nho/") && c.body !== null)
  };
}

/** A licensed brain whose three model seats (LLM#1, the agent, LLM#3) run on the given models. */
async function brainWith(landing: { fetch: FetchLike }, models: { analyzer?: ChatModelPort | null; agent?: ChatModelPort | null; writer?: ChatModelPort | null }, extra: Partial<ConstructorParameters<typeof BrainService>[0]> = {}) {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop.vn" });
  const logger = new MemoryLogger();
  const dossier = new MemoryDossierStore();
  const brain = new BrainService({
    license, fetch: landing.fetch, logger, clock, sleep: noSleep, dossier,
    agent: models.agent ? new SalesAgent({ model: models.agent, logger, clock, sleep: noSleep }) : undefined,
    analyzer: models.analyzer ? new ContextAnalyzer({ model: models.analyzer, logger }) : null,
    writer: models.writer ? new DraftWriter({ model: models.writer, logger }) : null,
    ...extra
  });
  return { brain, logger, dossier };
}

const AT = "2026-09-25T08:59:50.000Z";
const MESSAGE = { tenant: "toprun", kenh: "facebook", nguoi: "k1", chu: "boston 13 còn size 42 không", maHoiThoai: "facebook:k1" };
const THREAD = [{ chieu: "den", boi: "khach", chu: MESSAGE.chu, soAnh: 0, luc: AT }];

test("(a) 'da chuyen 500k' → human_handoff with the NEUTRAL sentence, a notice to the shop, and the agent never runs", async () => {
  const said = "da chuyen 500k vao stk cua shop";
  const landing = fakeLanding([{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: AT }]);
  const analyzer = scriptedModel([ANALYSIS]);
  const agent = scriptedModel(["{\"reply\":\"khong duoc toi day\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer, agent, writer: agent });
  const result = await brain.handleInbound({ ...MESSAGE, chu: said });
  assert.deepEqual(result, { daTraLoi: false, viSao: "chuyen_nguoi_that", traLoi: "Dạ em đã nhận thông tin, em báo người phụ trách đối chiếu và báo lại bác ngay ạ." });
  assert.deepEqual(landing.sent(), ["Dạ em đã nhận thông tin, em báo người phụ trách đối chiếu và báo lại bác ngay ạ."]);
  assert.deepEqual(landing.notices(), ["payment_ack"]);
  assert.equal(agent.seen.length, 0, "no agent, no LLM#3");
  assert.equal(analyzer.seen.length, 1, "LLM#1 ran, as on every turn");
  // The dossier says why: version 2, the router's path and decision, the analysis that preceded it.
  const d = dossier.last()!;
  assert.equal(d.version, 2);
  assert.equal(d.duongDi, "kich-ban");
  assert.equal(d.router?.quyetDinh, "human_handoff");
  assert.equal(d.router?.lyDo, "payment_ack");
  assert.equal(d.router?.yDinh.intent, "payment_confirmation");
  assert.ok(d.router?.duongOng.includes("script_handoff"));
  assert.equal(d.phanTich?.intent, "ask_size", "LLM#1's reading is kept even when the router overrode it");
  assert.equal(d.agent, undefined);
});

test("(b) the first greeting is a SCRIPT: sent at once, no agent turn, LLM#3 untouched; the ledger still remembers the exchange", async () => {
  const landing = fakeLanding([{ chieu: "den", boi: "khach", chu: "chào shop", soAnh: 0, luc: AT }]);
  const agent = scriptedModel(["{\"reply\":\"khong duoc toi day\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([analysisOf("greeting")]), agent, writer: agent });
  const result = await brain.handleInbound({ ...MESSAGE, chu: "chào shop" });
  assert.deepEqual(result, { daTraLoi: true, hanhDong: "send", traLoi: "Dạ em nghe ạ, bác đang tìm mẫu nào để em hỗ trợ ạ?" });
  assert.deepEqual(landing.sent(), ["Dạ em nghe ạ, bác đang tìm mẫu nào để em hỗ trợ ạ?"]);
  assert.equal(agent.seen.length, 0);
  assert.equal(landing.notices().length, 0);
  assert.equal(dossier.last()!.duongDi, "kich-ban");
  assert.equal(dossier.last()!.router?.quyetDinh, "script_reply");
  const saved = landing.memoryWrites().at(-1)!.body as { trangThai: { ledger?: { aiSummaries: { text: string }[] }; turns: unknown[] } };
  assert.ok(saved.trangThai.ledger, "the ledger was written after the script went out");
  assert.equal(saved.trangThai.ledger!.aiSummaries[0]?.text, "Khach hoi Boston 13 size 42", "LLM#1's summary is in the ledger");
  assert.equal(saved.trangThai.turns.length, 2, "the customer's line and the bot's");
});

test("(c) agent_draft → the agent runs with LLM#1's reading in its notes, and the reply goes out", async () => {
  const landing = fakeLanding(THREAD);
  const analyzer = scriptedModel([ANALYSIS]);
  const agent = scriptedModel(["{\"tool\":\"tra_kho\",\"args\":{\"ten\":\"Boston 13\",\"size\":\"42\"}}", "{\"reply\":\"Dạ Boston 13 size 42 còn, giá 3.290.000đ ạ\"}"]);
  const writer = scriptedModel(["{\"reply\":\"khong toi day\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer, agent, writer });
  const result = await brain.handleInbound(MESSAGE);
  assert.deepEqual(result, { daTraLoi: true, hanhDong: "agent", traLoi: "Dạ Boston 13 size 42 còn, giá 3.290.000đ ạ" });
  assert.equal(writer.seen.length, 0, "the agent answered: LLM#3 stays idle");
  assert.ok(isAgentCall(agent.seen[0]!));
  const system = agent.seen[0]![0]!.content;
  assert.match(system, /PHAN TICH NGU CANH \(LLM#1\): y dinh ask_size \(0\.9\)/);
  assert.match(system, /Thuc the: \{"productLine":"Adizero Boston"/);
  assert.match(system, /Boi canh: Khach hoi Boston 13 size 42/);
  assert.match(system, /Nen tra cuu: resolve_stock/);
  assert.equal(dossier.last()!.router?.goiY, "", "a message that names the product gets no ask-back hint");
  const d = dossier.last()!;
  assert.equal(d.duongDi, "agent");
  assert.equal(d.router?.quyetDinh, "agent_draft");
  assert.equal(d.router?.lyDo, "ask_size_needs_catalog");
  assert.match(d.ghiChu ?? "", /PHAN TICH NGU CANH/);
  assert.equal(d.agent?.traLoi, "Dạ Boston 13 size 42 còn, giá 3.290.000đ ạ");
  // LLM#1's summaries reach the memory: the ledger's summary and the episode's.
  const saved = landing.memoryWrites().at(-1)!.body as { trangThai: { ledger: { aiSummaries: { text: string }[]; customerGoal: string }; episode: { summary: string; focus: { code: string } | null } } };
  assert.equal(saved.trangThai.ledger.customerGoal, "mua Boston 13 size 42");
  assert.equal(saved.trangThai.episode.summary, "Khach dang xem Boston 13");
  assert.equal(saved.trangThai.episode.focus?.code, "JP9252");
});

test("(d) the agent is broken → LLM#3 writes the reply from the facts, under the same review; a person is called only when it says so", async () => {
  const landing = fakeLanding(THREAD);
  const agent = scriptedModel([new Error("gateway 524"), new Error("gateway 524"), new Error("gateway 524"), new Error("gateway 524"), new Error("gateway 524")]);
  const writer = scriptedModel(["{\"reply\":\"Dạ Boston 13 size 42 để em kiểm tra tồn rồi báo bác ngay ạ\",\"needsHuman\":false,\"reason\":\"chua tra duoc ton\"}"]);
  const { brain, dossier, logger } = await brainWith(landing, { analyzer: scriptedModel([ANALYSIS]), agent, writer });
  const result = await brain.handleInbound(MESSAGE);
  assert.deepEqual(result, { daTraLoi: true, hanhDong: "agent", traLoi: "Dạ Boston 13 size 42 để em kiểm tra tồn rồi báo bác ngay ạ" });
  assert.deepEqual(landing.sent(), ["Dạ Boston 13 size 42 để em kiểm tra tồn rồi báo bác ngay ạ"]);
  assert.equal(landing.notices().length, 0, "LLM#3 did not ask for a person");
  assert.equal(writer.seen.length, 1);
  assert.match(writer.seen[0]![1]!.content, /VI DU CAU NGUOI TRUC THAT/, "the lean prompt");
  assert.match(writer.seen[0]![1]!.content, /"intent":"ask_size"/, "the router's intent is what LLM#3 writes for");
  assert.ok(logger.warnings.some((m) => /chay lai ca luot/.test(m)), "the agent's whole-turn retry still happens before LLM#3");
  const d = dossier.last()!;
  assert.equal(d.duongDi, "nhap");
  assert.ok(d.agent?.viSao, "the agent's failure is on record");
  assert.equal(d.nhap?.traLoi, "Dạ Boston 13 size 42 để em kiểm tra tồn rồi báo bác ngay ạ");
  assert.equal(d.mayLuat, undefined, "the engine never ran");

  // LLM#3 says a person is needed: the sentence still goes out AND the shop is told.
  const landing2 = fakeLanding(THREAD);
  const writer2 = scriptedModel(["{\"reply\":\"Dạ để em nhờ người phụ trách kiểm tra giúp bác ạ\",\"needsHuman\":true,\"reason\":\"khong ro ton\"}"]);
  const { brain: brain2 } = await brainWith(landing2, { analyzer: scriptedModel([ANALYSIS]), agent: scriptedModel([]), writer: writer2 });
  await brain2.handleInbound(MESSAGE);
  assert.deepEqual(landing2.sent(), ["Dạ để em nhờ người phụ trách kiểm tra giúp bác ạ"]);
  assert.match(landing2.notices()[0] ?? "", /soan nhap: khong ro ton/);

  // An invented price in the draft is blocked like the agent's: the engine takes the turn instead.
  const landing3 = fakeLanding(THREAD);
  const writer3 = scriptedModel(["{\"reply\":\"Dạ đôi này 2.500.000đ ạ\"}"]);
  const { brain: brain3, dossier: dossier3 } = await brainWith(landing3, { analyzer: scriptedModel([ANALYSIS]), agent: scriptedModel([]), writer: writer3 });
  await brain3.handleInbound(MESSAGE);
  assert.ok(!landing3.sent().some((s) => /2\.500\.000/.test(s)), "the invented price never reached the customer");
  assert.match(dossier3.last()!.nhap?.viSao ?? "", /chan: gia_khong_nguon/);
  assert.ok(dossier3.last()!.mayLuat !== undefined, "the engine took the turn");
});

test("(e) LLM#3 is broken (or off) → the rule engine answers, with the router's intent as its hint", async () => {
  // Off: no writer at all. The router said ask_size → the engine's hoi_ton_kho (routerIntents), which
  // finds Boston 13 in the catalog and asks the stock tool — no "Dạ em nghe bác ạ" greeting.
  const landing = fakeLanding(THREAD);
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([ANALYSIS]), agent: scriptedModel([]), writer: null });
  await brain.handleInbound(MESSAGE);
  const d = dossier.last()!;
  assert.equal(d.duongDi, "may-luat");
  assert.equal(d.mayLuat?.maYDinh, "hoi_ton_kho", "the router's ask_size became the engine's stock intent");
  assert.equal(d.nhap, undefined);
  assert.ok(landing.calls.some((c) => c.body?.["ten"] === "stock.lookup" || c.body?.["ten"] === "catalog.search"), "the engine looked the item up");

  // Broken: the writer's model fails → the same engine turn, the failure on record.
  const landing2 = fakeLanding(THREAD);
  const { brain: brain2, dossier: dossier2, logger } = await brainWith(landing2, { analyzer: scriptedModel([ANALYSIS]), agent: scriptedModel([]), writer: scriptedModel([new Error("gateway 524")]) });
  await brain2.handleInbound(MESSAGE);
  assert.equal(dossier2.last()!.duongDi, "may-luat");
  assert.match(dossier2.last()!.nhap?.viSao ?? "", /524/);
  assert.ok(logger.warnings.some((m) => /may luat tra loi/.test(m)));

  // Nothing understood by anyone: the engine has no intent for it → the customer hears the handoff sentence and the shop is told.
  const landing3 = fakeLanding([{ chieu: "den", boi: "khach", chu: "cho tôi đôi khác xem", soAnh: 0, luc: AT }]);
  const { brain: brain3 } = await brainWith(landing3, { analyzer: null, agent: scriptedModel([]), writer: scriptedModel([]) });
  const result = await brain3.handleInbound({ ...MESSAGE, chu: "cho tôi đôi khác xem" });
  assert.equal((result as { viSao?: string }).viSao, "chuyen_nguoi_that");
  assert.deepEqual(landing3.sent(), ["Dạ em nhờ nhân viên kiểm lại rồi trả lời bác ngay ạ."]);
  assert.equal(landing3.notices().length, 1);
});

test("(f) the AI desk's draft and sandbox take the SAME road in 'khong-gui' mode: nothing sent, nobody told, nothing remembered", async () => {
  const landing = fakeLanding(THREAD);
  const analyzer = scriptedModel([ANALYSIS, ANALYSIS, ANALYSIS]);
  const agent = scriptedModel(["{\"reply\":\"Dạ Boston 13 size 42 còn bác nhé\"}", "{\"reply\":\"Dạ bác chạy cự ly bao nhiêu ạ?\"}"]);
  const { brain, logger } = await brainWith(landing, { analyzer, agent, writer: agent });
  const desk = new AiDeskService({ brain, model: agent, clock, logger });

  const draft = await desk.draft({ tenant: "toprun", maHoiThoai: "facebook:k1", kenh: "facebook", cheDo: "suggest", nguon: "nguoi" });
  assert.equal(draft.ok && draft.traLoi, "Dạ Boston 13 size 42 còn bác nhé");
  assert.equal(draft.ok && draft.nguonTraLoi, "agent");
  assert.ok(draft.ok && draft.dauVet.some((s) => /Bộ định tuyến/.test(s.ten) && /agent_draft/.test(s.chiTiet)), "the router's decision is in the trace");
  assert.ok(draft.ok && draft.dauVet.some((s) => /LLM#1/.test(s.ten)), "and LLM#1's reading");
  assert.equal(draft.ok && draft.y, "ask_size");

  // A payment claim in a draft: the router's neutral sentence as the suggestion, a person flagged, still nothing sent.
  const pay = fakeLanding([{ chieu: "den", boi: "khach", chu: "da chuyen 500k vao stk cua shop", soAnh: 0, luc: AT }]);
  const { brain: payBrain } = await brainWith(pay, { analyzer: scriptedModel([ANALYSIS]), agent: scriptedModel([]), writer: null });
  const payDraft = await new AiDeskService({ brain: payBrain, model: agent, clock, logger }).draft({ tenant: "toprun", maHoiThoai: "facebook:k1", kenh: "facebook", cheDo: "auto", nguon: "nguoi" });
  assert.equal(payDraft.ok && payDraft.canNguoi, true);
  assert.equal(payDraft.ok && payDraft.hanhDong, "human_handoff");
  assert.match(payDraft.ok ? payDraft.traLoi : "", /em đã nhận thông tin/);
  assert.equal(pay.sent().length + pay.notices().length + pay.memoryWrites().length, 0);

  const sandbox = await desk.sandbox({ tenant: "toprun", lichSu: [{ ai: "khach", chu: "shop ơi" }, { ai: "shop", chu: "dạ em nghe" }], chu: "tìm giày chạy 42" });
  assert.equal(sandbox.ok && sandbox.traLoi, "Dạ bác chạy cự ly bao nhiêu ạ?");
  assert.match(agent.seen[1]![1]!.content, /KHACH: shop ơi[\s\S]*PAGE \(nguoi truc\): dạ em nghe[\s\S]*KHACH: tìm giày chạy 42/);
  assert.ok(!landing.calls.some((c) => c.body?.["ten"] === "conversation.recent" && String(c.body?.["input"] && (c.body["input"] as { conversationId: string }).conversationId).startsWith("demo:")), "the sandbox reads no real thread");

  assert.equal(landing.sent().length, 0, "nothing was sent");
  assert.equal(landing.notices().length, 0, "nobody was told");
  assert.equal(landing.memoryWrites().length, 0, "nothing was remembered");
});

test("the pipeline alone: a comment goes to the engine only; a human on duty silences everything; the agent needs its tools", async () => {
  const landing = fakeLanding(THREAD);
  const analyzer = scriptedModel([ANALYSIS]);
  const { brain } = await brainWith(landing, { analyzer, agent: scriptedModel(["{\"reply\":\"x\"}"]), writer: null });
  await brain.handleInbound({ ...MESSAGE, kenh: "facebook-binh-luan", maTin: "cmt_1" });
  assert.equal(analyzer.seen.length, 0, "a public comment is the engine's alone: no model reads it");
  const under = landing.calls.find((c) => c.path === "/api/hop-thu/gui");
  assert.equal(under?.body?.["traLoiTin"], "cmt_1", "answered under the comment");

  const busy = fakeLanding([...THREAD, { chieu: "di", boi: "Minh", chu: "dạ còn ạ", soAnh: 0, luc: "2026-09-25T08:59:55.000Z" }]);
  const quiet = scriptedModel([ANALYSIS]);
  const { brain: quietBrain } = await brainWith(busy, { analyzer: quiet, agent: scriptedModel([]), writer: null });
  assert.deepEqual(await quietBrain.handleInbound(MESSAGE), { daTraLoi: false, viSao: "nguoi_dang_truc" });
  assert.equal(quiet.seen.length, 0);

  assert.deepEqual(AGENT_TOOLS, ["catalog.find", "conversation.recent"]);
  assert.ok(typeof TurnPipeline === "function");
});

// ---- Desk steps 5–7 (25/09/2026): the landing is asked BEFORE any model writes ----------------

interface LandingOptions {
  thread?: { maTin?: string; chieu: string; boi: string; chu: string; soAnh: number; luc: string; anh?: string[] }[];
  /** Tools the landing opens beyond the basic set. */
  extraTools?: string[];
  /** What `catalog.find` / `catalog.resolveStock` return. */
  found?: unknown[];
  /** The memory the landing hands back on GET. */
  state?: unknown;
  orders?: unknown[];
  portrait?: unknown;
  /** The shop profile (opens `shop.profile`). */
  hoSo?: Record<string, unknown>;
  /** Codes whose card the landing says it sent within six hours. */
  theDaGui?: string[];
}

function landingWith(o: LandingOptions) {
  const calls: Call[] = [];
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "storefront.link", "catalog.find", "shop.bankAccount", "conversation.recent", ...(o.extraTools ?? []), ...(o.hoSo ? ["shop.profile"] : [])];
  const found = o.found ?? BOSTON;
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: o.thread ?? THREAD, hoiThoai: { daChaoAi: false, dienThoaiDaCho: (o.orders ?? []).length > 0, theDaGui: o.theDaGui ?? [] } } });
      if (tool === "order.formLink") { const items = (body!["input"] as { items: { ma: string; size: string }[] }).items; return reply({ ok: true, data: { url: `https://shop.vn/dat-hang?p=${items[0]!.ma}&size=${items[0]!.size}`, dienSan: "chat", loiMoi: "Bác điền giúp em thông tin nhận hàng nhé", the: { tieuDe: "Đặt đơn ngay", phuDe: "Boston 13", anh: "https://shop.vn/a.jpg" } } }); }
      if (tool === "catalog.find") return reply({ ok: true, data: { ketQua: found } });
      if (tool === "catalog.resolveStock") return reply({ ok: true, data: { resolvedLevel: "exact", anchor: { ma: "JP9252", ten: "ADIZERO BOSTON 13 M" }, exact: { hasRequestedSize: true, rows: found.map((it) => ({ ...(it as object), hasRequestedSize: true, doi: "13" })), otherKho: [] }, sameLineSameVersion: [], sameLineOtherVersion: [], equivalents: [], note: "" } });
      if (tool === "order.lookup") return reply({ ok: true, data: { orders: o.orders ?? [] } });
      if (tool === "customer.recognize") return reply({ ok: true, data: o.portrait ?? { isReturning: false, orderCount: 0 } });
      if (tool === "shop.profile") return reply({ ok: true, data: { hoSo: o.hoSo, chinhSach: { doiTra: "", ship: "", baoHanh: "" }, kho: [] } });
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 5000 } });
      return reply({ ok: true, data: { items: [], rows: [], truncated: false, asOf: "" } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: init.method === "GET" ? (o.state ?? null) : null });
    if (u.pathname === "/api/hop-thu/gui") {
      // The landing reports what really went with the text (Giai đoạn 7): here, exactly what was asked.
      const asked = body ?? {};
      const extras = asked["theSanPham"] !== undefined || asked["phieuDatHang"] !== undefined || asked["chaoAi"] !== undefined || asked["linkLoc"] !== undefined || asked["anhHuongDan"] !== undefined
        ? { daGui: { the: ((asked["theSanPham"] as { ma: string }[] | undefined) ?? []).map((c) => c.ma), boQua: [], linkLoc: asked["linkLoc"] !== undefined, phieuDatHang: asked["phieuDatHang"] !== undefined, anhHuongDan: asked["anhHuongDan"] !== undefined, chaoAi: asked["chaoAi"] === true } }
        : {};
      return reply({ ok: true, guiNgay: true, ...extras });
    }
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  return {
    fetch, calls,
    sent: () => calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => String(c.body!["chu"])),
    notices: () => calls.filter((c) => c.path === "/api/hop-thu/can-nguoi").map((c) => String(c.body!["lyDo"])),
    toolCalls: () => calls.filter((c) => c.path === "/api/bo-nao/cong-cu" && c.body !== null).map((c) => String(c.body!["ten"]))
  };
}

const STOCK_ANALYSIS = analysisOf("ask_size");

test("(1) 'còn adizero boston 13 size 42 không' → the finder is asked BEFORE the agent; the agent's notes carry HE THONG DA TIM THAY with code, size and price, and the stock truth", async () => {
  const thread = [{ chieu: "den", boi: "khach", chu: "còn adizero boston 13 size 42 không", soAnh: 0, luc: AT }];
  const boston = [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M", loai: "HANG SAN", cac_size: [{ size: "42", gia: 3290000, so_luong: 2, kho: "K1" }, { size: "43", gia: 3290000, so_luong: 1, kho: "K1" }], anh: "", link: "https://shop.vn/product/jp9252" }];
  for (const extraTools of [[], ["catalog.resolveStock"]]) {
    const landing = landingWith({ thread, found: boston, extraTools });
    const agent = scriptedModel(["{\"reply\":\"Dạ Boston 13 size 42 còn 2 đôi, giá 3.290.000đ ạ\"}"]);
    const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([STOCK_ANALYSIS]), agent, writer: null });
    const result = await brain.handleInbound({ ...MESSAGE, chu: "còn adizero boston 13 size 42 không" });
    assert.equal((result as { traLoi?: string }).traLoi, "Dạ Boston 13 size 42 còn 2 đôi, giá 3.290.000đ ạ", JSON.stringify(result));
    // The lookup came first: the finder call is on record before the agent's first model call.
    const calls = landing.toolCalls();
    const finder = extraTools.length > 0 ? "catalog.resolveStock" : "catalog.find";
    assert.ok(calls.includes(finder), `${finder} was asked (${calls.join(", ")})`);
    assert.equal(agent.seen.length, 1);
    const system = agent.seen[0]![0]!.content;
    assert.match(system, /HE THONG DA TIM THAY TRONG KHO/);
    assert.match(system, /JP9252/);
    assert.match(system, /3\.290\.000/);
    assert.match(system, /42 \(2\)/, "the size with its quantity");
    assert.match(system, /TON THUC TE cua ADIZERO BOSTON 13 M \(JP9252\) size 42/);
    assert.match(system, /"stock":\{"size":"42","qty":2/);
    assert.match(system, /MẪU ĐANG NÓI TỚI \(khớp catalog theo chữ khách gõ\): ADIZERO BOSTON 13 M \(JP9252\)/);
    const d = dossier.last()!;
    assert.ok((d.traCuu ?? []).some((c) => c.ten === finder), "the lookup is in the dossier");
    assert.equal(d.suThat?.khop?.trangThai, "single_match");
    assert.deepEqual(d.suThat?.khop?.ma, ["JP9252"]);
    assert.equal(d.suThat?.ton?.stock?.qty, 2);
    assert.equal(d.suThat?.mauChinh?.nguon, "catalog");
    if (extraTools.length > 0) assert.equal(d.suThat?.bacThang, "exact");
    // The memory learned the match: the ledger holds the product with its stock answer, the episode its focus.
    const saved = landing.calls.filter((c) => c.path.startsWith("/api/bo-nao/tri-nho/") && c.body !== null).at(-1)!.body as { trangThai: { ledger: { products: { code: string; stockAnswer?: string }[] }; episode: { focus: { code: string } | null } } };
    assert.equal(saved.trangThai.ledger.products[0]?.code, "JP9252");
    assert.equal(saved.trangThai.episode.focus?.code, "JP9252");
  }
});

test("(2) a brand the shop does not carry → the shop's own 'không có' sentence, no agent turn, nothing looked up in vain", async () => {
  const said = "đôi salomon speedcross này size 42 còn không shop";
  const hoSo = emptyShopProfile();
  hoSo.banHang.cauKhongCo = "bên em chưa kinh doanh hãng này";
  hoSo.xungHo.khach = "bác";
  hoSo.nguon = { "banHang.cauKhongCo": "shop", "xungHo.khach": "shop" };
  const landing = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: AT }], found: [], hoSo: hoSo as unknown as Record<string, unknown> });
  const agent = scriptedModel(["{\"reply\":\"khong toi day\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([analysisOf("ask_size").replace("\"entities\":{", "\"entities\":{\"brand\":\"salomon\",")]), agent, writer: agent });
  const result = await brain.handleInbound({ ...MESSAGE, chu: said });
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  assert.equal((result as { hanhDong?: string }).hanhDong, "ask_back");
  assert.match(landing.sent()[0] ?? "", /chưa kinh doanh hãng này/);
  assert.equal(agent.seen.length, 0, "no agent, no LLM#3");
  assert.equal(landing.notices().length, 0);
  const d = dossier.last()!;
  assert.equal(d.duongDi, "kich-ban");
  assert.equal(d.suThat?.chuaChac, "uncertain_product_ask_back:brand_not_carried");
  assert.ok(d.router?.duongOng.includes("uncertain_product_ask_back:brand_not_carried"));
});

test("(3) nothing identifies the item and the bot already asked back once → a person, not a second question", async () => {
  const said = "đôi này size 42 còn không";
  const state = { tenant: "toprun", conversationId: "facebook:k1", turns: [], askBackCount: 1, lastAskBackAt: "2026-09-25T08:50:00.000Z" };
  const landing = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: AT }], found: [], state });
  const agent = scriptedModel(["{\"reply\":\"khong toi day\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([STOCK_ANALYSIS]), agent, writer: agent });
  const result = await brain.handleInbound({ ...MESSAGE, chu: said });
  assert.equal((result as { viSao?: string }).viSao, "chuyen_nguoi_that");
  assert.match(landing.sent()[0] ?? "", /nhờ người phụ trách/);
  assert.deepEqual(landing.notices(), ["uncertain_product_twice:no_product"]);
  assert.equal(agent.seen.length, 0);
  assert.equal(dossier.last()!.suThat?.chuaChac, "uncertain_product_twice:no_product");
  // The first time, the same message is asked back (the generic sentence), and the ask-back is counted.
  const first = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: AT }], found: [] });
  const { brain: brain1 } = await brainWith(first, { analyzer: scriptedModel([STOCK_ANALYSIS]), agent: scriptedModel([]), writer: null });
  const asked = await brain1.handleInbound({ ...MESSAGE, chu: said });
  assert.equal((asked as { hanhDong?: string }).hanhDong, "ask_back");
  assert.match(first.sent()[0] ?? "", /ảnh hoặc tên mẫu/);
  const saved = first.calls.filter((c) => c.path.startsWith("/api/bo-nao/tri-nho/") && c.body !== null).at(-1)!.body as { trangThai: { askBackCount: number } };
  assert.equal(saved.trangThai.askBackCount, 1);
});

test("(4) 'đơn của tôi đi tới đâu rồi' with the phone the customer typed → order.lookup, and VAN_DON is the FIRST block of the note", async () => {
  const thread = [
    { chieu: "den", boi: "khach", chu: "sđt em 0912 345 678 ạ", soAnh: 0, luc: "2026-09-25T08:50:00.000Z" },
    { chieu: "di", boi: "Minh", chu: "dạ em lên đơn rồi ạ", soAnh: 0, luc: "2026-09-25T08:51:00.000Z" },
    { chieu: "den", boi: "khach", chu: "đơn của tôi đi tới đâu rồi", soAnh: 0, luc: AT }
  ];
  const orders = [{
    orderId: "DH1001", status: "shipping", statusLabel: "Đang giao", createdAt: "2026-09-24T10:00:00.000Z",
    money: { total: 3290000, paid: 3290000, due: 0 }, lines: [{ name: "ADIZERO BOSTON 13 M", variantLabel: "size 42", qty: 1, code: "JP9252" }],
    tracking: { carrier: "SPX", code: "SPX123", url: "https://spx.vn/track/SPX123", active: true },
    exchange: { allowed: false, reason: "da_gui_hang", note: "Hàng đã gửi, đổi size sau khi nhận" }
  }];
  const portrait = { isReturning: true, orderCount: 3, usualSizes: ["42"], lastOrder: { status: "shipping", statusLabel: "Đang giao", productName: "ADIZERO BOSTON 13 M", size: "42", createdAt: "2026-09-24T10:00:00.000Z" }, hasSavedAddress: true };
  const landing = landingWith({ thread, extraTools: ["order.lookup", "customer.recognize"], orders, portrait, found: [] });
  const agent = scriptedModel(["{\"reply\":\"Dạ đơn DH1001 đang giao, bác theo dõi tại https://spx.vn/track/SPX123 ạ\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([analysisOf("unknown")]), agent, writer: null });
  const result = await brain.handleInbound({ ...MESSAGE, chu: "đơn của tôi đi tới đâu rồi" });
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  const lookup = landing.calls.find((c) => c.body?.["ten"] === "order.lookup");
  assert.ok(lookup, "order.lookup was asked");
  assert.equal((lookup!.body!["input"] as { phoneGivenInConversation: string }).phoneGivenInConversation, "0912345678", "the number the customer typed, spaces removed");
  const notes = dossier.last()!.ghiChu ?? "";
  assert.match(notes, /^VAN DON CUA KHACH — don DH1001 \(Đang giao\), ma van don SPX123\. LINK TRA CUU DUNG[^\n]*https:\/\/spx\.vn\/track\/SPX123/, "VAN_DON opens the note");
  assert.match(notes, /DON GAN NHAT CUA KHACH .*DH1001 — Đang giao — ADIZERO BOSTON 13 M size 42/);
  assert.match(notes, /CHAN DUNG KHACH .*da mua 3 don, size hay mua 42.*da co dia chi luu/);
  assert.doesNotMatch(notes, /0912345678/, "the phone number never reaches the model's notes");
  assert.match(agent.seen[0]![0]!.content, /he thong DA tra don theo SDT/, "the capability line says orders were looked up");
  assert.doesNotMatch(agent.seen[0]![0]!.content, /KHONG tra duoc don hang/);
  assert.equal(dossier.last()!.suThat?.donHang?.maDon, "DH1001");
  assert.equal(dossier.last()!.suThat?.donHang?.vanDon, true);
  assert.equal(dossier.last()!.suThat?.khach?.daMua, 3);
  // The exchange block only when the customer asks about exchanging.
  const swap = landingWith({ thread: [...thread.slice(0, 2), { chieu: "den", boi: "khach", chu: "đơn của tôi đổi size 43 được không", soAnh: 0, luc: AT }], extraTools: ["order.lookup"], orders, found: [] });
  const { brain: brain2, dossier: dossier2 } = await brainWith(swap, { analyzer: scriptedModel([analysisOf("ask_size")]), agent: scriptedModel(["{\"reply\":\"Dạ hàng đã gửi, nhận xong đổi size giúp bác ạ\"}"]), writer: null });
  await brain2.handleInbound({ ...MESSAGE, chu: "đơn của tôi đổi size 43 được không" });
  assert.match(dossier2.last()!.ghiChu ?? "", /DON CUA KHACH \(DH1001\) — DOI (BIEN THE|SIZE): KHONG DOI DUOC\. Hàng đã gửi/);
  assert.equal(dossier2.last()!.suThat?.donHang?.doiSize, false);
});

test("(5) a photo nobody recognised, with a focus inherited from a previous session → the focus is dropped: no MẪU ĐANG NÓI TỚI, no stale lookup", async () => {
  const twoDaysAgo = "2026-09-23T09:00:00.000Z";
  const state = {
    tenant: "toprun", conversationId: "facebook:k1", turns: [],
    focusItemCode: "JP9252",
    episode: { id: "ep_old", startedAt: twoDaysAgo, lastAt: twoDaysAgo, openedBy: "first", turns: 2, focus: { code: "JP9252", name: "ADIZERO BOSTON 13 M", brand: "adidas", since: twoDaysAgo, by: "khach_nhac" }, others: [], summary: "", stage: "tu_van", outcome: "", staleGap: "" },
    ledger: { products: [{ code: "JP9252", name: "ADIZERO BOSTON 13 M", brand: "adidas", source: "chu_khach", firstAt: twoDaysAgo, lastAt: twoDaysAgo, askedSizes: ["42"], status: "hoi_size" }], orders: [], aiSummaries: [], openThread: "", customerGoal: "", updatedAt: twoDaysAgo }
  };
  const thread = [
    { chieu: "den", boi: "khach", chu: "boston 13 còn 42 không", soAnh: 0, luc: twoDaysAgo },
    { chieu: "di", boi: "bo-nao", chu: "Dạ còn ạ", soAnh: 0, luc: "2026-09-23T09:01:00.000Z" },
    { chieu: "den", boi: "khach", chu: "còn size 40 không", soAnh: 1, luc: AT, anh: ["https://scontent.test/khac.jpg"] }
  ];
  const landing = landingWith({ thread, state, found: BOSTON });
  const agent = scriptedModel(["{\"reply\":\"Dạ bác cho em xin tên mẫu trong ảnh ạ\"}"]);
  // No vision model: the photo is not read, so nothing recognised it.
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([analysisOf("send_image", { entities: {}, focus: { product: "", products: [], changed: false, reason: "", roles: [] }, lookupCommands: [] })]), agent, writer: null });
  await brain.handleInbound({ ...MESSAGE, chu: "còn size 40 không", soAnh: 1, anh: ["https://scontent.test/khac.jpg"] });
  const d = dossier.last()!;
  assert.doesNotMatch(d.ghiChu ?? "", /MẪU ĐANG NÓI TỚI/, "the two-day-old focus is not 'đôi này'");
  assert.match(d.suThat?.mauChinh?.boDi ?? "", /stale_focus_image_turn|episode_before_session/);
  assert.equal(d.suThat?.mauChinh?.ma ?? "", "");
  assert.ok(!landing.toolCalls().includes("catalog.find") && !landing.toolCalls().includes("catalog.resolveStock"), "no lookup on the stale focus");
  assert.equal(agent.seen.length, 1, "the agent still answers — and is told to ask for the name");
  // The same photo in the SAME session (the focus was named an hour ago): the focus stays.
  const sameSession = landingWith({ thread: [{ ...thread[0]!, luc: "2026-09-25T08:00:00.000Z" }, { ...thread[1]!, luc: "2026-09-25T08:01:00.000Z" }, thread[2]!], state: { ...state, episode: { ...state.episode, lastAt: "2026-09-25T08:01:00.000Z" } }, found: BOSTON });
  const { brain: brain2, dossier: dossier2 } = await brainWith(sameSession, { analyzer: scriptedModel([analysisOf("send_image", { entities: {}, focus: { product: "", products: [], changed: false, reason: "", roles: [] }, lookupCommands: [] })]), agent: scriptedModel(["{\"reply\":\"Dạ Boston 13 size 40 em kiểm ạ\"}"]), writer: null });
  await brain2.handleInbound({ ...MESSAGE, chu: "còn size 40 không", soAnh: 1, anh: ["https://scontent.test/khac.jpg"] });
  assert.equal(dossier2.last()!.suThat?.mauChinh?.ma, "JP9252");
  assert.match(dossier2.last()!.ghiChu ?? "", /MẪU ĐANG NÓI TỚI/);
});

// ---- Stage 6 / GĐ5 / GĐ7 / the breaker / LLM#2 (25/09/2026) ------------------------------------

const HOSO_PHIEU = (khiChot: "phieu" | "goi-nguoi"): Record<string, unknown> => {
  const hoSo = emptyShopProfile();
  hoSo.xungHo.khach = "bác";
  hoSo.banHang.khiChot = khiChot;
  hoSo.nguon = { "xungHo.khach": "shop", "banHang.khiChot": "shop" };
  return hoSo as unknown as Record<string, unknown>;
};
const BOSTON_STOCK = [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M", loai: "HANG SAN", cac_size: [{ size: "42", gia: 3290000, so_luong: 2, kho: "K1" }, { size: "43", gia: 3290000, so_luong: 1, kho: "K1" }], anh: "https://shop.vn/a.jpg", link: "https://shop.vn/product/jp9252" }];
const sentBody = (landing: { calls: Call[] }): Record<string, unknown> => landing.calls.find((c) => c.path === "/api/hop-thu/gui")?.body ?? {};

test("GĐ6 reply gate: an exchange promise no policy backs is cut before it goes out, a person is told, the trace is in the dossier", async () => {
  const said = "còn boston size 42 không";
  const landing = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: AT }], found: [] });
  // The agent's own review lets this through (no invented price, no banned phrase); the gate knows the shop declared no exchange policy.
  const agent = scriptedModel(["{\"reply\":\"Dạ để em kiểm tra tồn rồi báo bác ngay ạ. Bên em có hỗ trợ đổi size nếu không vừa ạ.\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([STOCK_ANALYSIS]), agent, writer: null });
  const result = await brain.handleInbound({ ...MESSAGE, chu: said });
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  const sent = landing.sent()[0] ?? "";
  assert.doesNotMatch(sent, /hỗ trợ đổi size/, "the unsourced promise is cut");
  assert.match(sent, /kiểm tra tồn rồi báo bác/, "the harmless sentence stays");
  assert.match(sent, /đổi size để em kiểm tra chính sách/, "the note the data prescribes takes its place");
  const cong = dossier.last()!.cong!;
  assert.ok(cong.dauVet.some((t) => /exchange_promise_no_policy/.test(t)), cong.dauVet.join(","));
  assert.match(cong.goc, /hỗ trợ đổi size/);
  assert.equal(cong.sua, sent);
  assert.equal(cong.canNguoi, true);
  assert.ok(landing.notices().some((n) => /cong soat/.test(n)), "Desk handoffAfterSend: the reply goes, then the shop is told");
});

test("GĐ7 dispatcher (pure): two cards at most, a code sent within 6h skipped, three in stock → the filter link, the form only when the shop closes by form", () => {
  const d = new ReplyDispatcher();
  const item = (ma: string, stock = 2) => ({ ma, ten: `MẪU ${ma}`, cac_size: [{ size: "42", gia: 1000000, so_luong: stock }], anh: "", link: `https://shop.vn/product/${ma.toLowerCase()}` });
  const base = { stock: null, theDaGui: [], daChaoAi: true, firstReply: false, intent: "ask_size", closingSignals: [], readyToBuy: false, focusCode: "", requestedSize: "42", hoSo: null, asksFootMeasure: "", site: "https://shop.vn" };
  const two = d.plan({ ...base, reply: "Dạ bác xem JP9252 và IG8054 ạ", found: [item("JP9252"), item("IG8054"), item("XX0001")] });
  assert.deepEqual(two.theSanPham, [{ ma: "JP9252", size: "42" }, { ma: "IG8054", size: "42" }]);
  assert.equal(two.linkLoc, undefined);
  const dup = d.plan({ ...base, reply: "Dạ bác xem JP9252 và IG8054 ạ", found: [item("JP9252"), item("IG8054")], theDaGui: ["JP9252"] });
  assert.deepEqual(dup.theSanPham.map((c) => c.ma), ["IG8054"], "a card sent within six hours is not asked for again");
  // Five codes of different lines have NO shared filter: gluing them into ?q= is not one (hồ sơ that-18) → the first two cards.
  const many = d.plan({ ...base, reply: "Dạ có JP9252, IG8054, XX0001, YY0002 và ZZ0003 ạ", found: [item("JP9252"), item("IG8054"), item("XX0001"), item("YY0002"), item("ZZ0003")] });
  assert.equal(many.linkLoc, undefined);
  assert.deepEqual(many.theSanPham.map((c) => c.ma), ["JP9252", "IG8054"]);
  assert.ok(many.lyDo.some((l) => /khong co bo loc chung/.test(l)));
  // Three codes that DO share a filter (same line): the link, on the site the filter names.
  const shared = d.plan({ ...base, reply: "Dạ có JP9252, IG8054 và XX0001 ạ", found: [item("JP9252"), item("IG8054"), item("XX0001")], sharedFilter: () => "https://kho-ngoai.vn/?q=boston%2013&size=42#products" });
  assert.equal(shared.theSanPham.length, 0);
  assert.equal(shared.linkLoc, "https://kho-ngoai.vn/?q=boston%2013&size=42#products");
  const stock = { productCode: "JP9252", productName: "ADIZERO BOSTON 13 M", requestedSize: "42", stock: { size: "42", qty: 2, approximate: false }, price: 3290000, otherKho: [], variantsAvailable: [] };
  const hoSo = emptyShopProfile(); hoSo.banHang.khiChot = "phieu";
  const form = d.plan({ ...base, reply: "Dạ em gửi phiếu ạ", found: [item("JP9252")], stock, intent: "place_order", focusCode: "JP9252", hoSo });
  assert.deepEqual(form.phieu, { items: [{ ma: "JP9252", size: "42" }] });
  const person = d.plan({ ...base, reply: "Dạ", found: [], stock, intent: "place_order", focusCode: "JP9252", hoSo: { ...hoSo, banHang: { ...hoSo.banHang, khiChot: "goi-nguoi" } } });
  assert.equal(person.goiNguoi, true);
  assert.equal(person.phieu, undefined);
  const noStock = d.plan({ ...base, reply: "Dạ", found: [], stock: { ...stock, stock: null }, intent: "place_order", focusCode: "JP9252", hoSo });
  assert.equal(noStock.phieu, undefined, "no form for a size that is out");
  const measure = d.plan({ ...base, reply: "Dạ bác đo giúp em chiều dài bàn chân (cm) nhé", found: [], asksFootMeasure: loadIntentRules("giay-chay").reconcile.asksFootMeasure });
  assert.equal(measure.anhHuongDan, "do-chan");
  const greet = d.plan({ ...base, reply: "Dạ", found: [], daChaoAi: false, firstReply: true });
  assert.equal(greet.chaoAi, true);
  assert.equal(d.plan({ ...base, reply: "Dạ", found: [], daChaoAi: false, firstReply: true, intent: "complaint_or_human" }).chaoAi, false, "no greeting in front of a complaint");
});

test("GĐ7 in the pipeline: a closing on a code + size in stock → order.formLink is asked and the form rides with the reply (khiChot=phieu); a person is called instead (goi-nguoi)", async () => {
  const said = "chốt adizero boston 13 size 42 nhé";
  const thread = [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: AT }];
  const landing = landingWith({ thread, found: BOSTON_STOCK, extraTools: ["order.formLink"], hoSo: HOSO_PHIEU("phieu") });
  const agent = scriptedModel(["{\"reply\":\"Dạ Boston 13 size 42 còn ạ, em gửi phiếu đặt hàng bác điền giúp em nhé.\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([analysisOf("place_order")]), agent, writer: null });
  const result = await brain.handleInbound({ ...MESSAGE, chu: said });
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  const form = landing.calls.find((c) => c.body?.["ten"] === "order.formLink");
  assert.ok(form, "order.formLink was asked");
  assert.deepEqual((form!.body!["input"] as { items: unknown }).items, [{ ma: "JP9252", size: "42" }]);
  const body = sentBody(landing);
  assert.equal((body["phieuDatHang"] as { url: string }).url, "https://shop.vn/dat-hang?p=JP9252&size=42");
  assert.equal(body["chaoAi"], true, "the opening reply carries the landing's greeting");
  assert.deepEqual(body["theSanPham"], undefined, "the form replaces the card of the code being ordered");
  const kem = dossier.last()!.guiKem!;
  assert.equal(kem.phieu?.url, "https://shop.vn/dat-hang?p=JP9252&size=42");
  assert.deepEqual(kem.daGui?.the, [], "what the landing said it sent is on record");
  assert.equal(kem.daGui?.phieuDatHang, true);
  assert.match(agent.seen[0]![0]!.content, /PHIEU DAT HANG do HE THONG tu gui kem/);
  assert.match(agent.seen[0]![0]!.content, /HE THONG TU CHEN CAU CHAO/, "the agent is told not to greet");

  const byPerson = landingWith({ thread, found: BOSTON_STOCK, extraTools: ["order.formLink"], hoSo: HOSO_PHIEU("goi-nguoi") });
  const { brain: brain2 } = await brainWith(byPerson, { analyzer: scriptedModel([analysisOf("place_order")]), agent: scriptedModel(["{\"reply\":\"Dạ Boston 13 size 42 còn ạ, bác chờ em một lát nhé.\"}"]), writer: null });
  await brain2.handleInbound({ ...MESSAGE, chu: said });
  assert.ok(!byPerson.calls.some((c) => c.body?.["ten"] === "order.formLink"), "no form when the shop closes through a person");
  assert.ok(byPerson.notices().some((n) => /khach chot don/.test(n)), byPerson.notices().join(" | "));
});

test("GĐ7: a reply naming two found codes goes out with two cards; the same codes sent within 6h are not asked again", async () => {
  const found = [...BOSTON_STOCK, { ma: "IG8054", ten: "ADIZERO ADIOS PRO 4 M", loai: "HANG SAN", cac_size: [{ size: "42", gia: 5990000, so_luong: 1 }], anh: "", link: "https://shop.vn/product/ig8054" }];
  const lookup = "{\"tool\":\"tra_kho\",\"args\":{\"muc_dich\":\"chay_bo\",\"size\":\"42\"}}";
  const reply = "{\"reply\":\"Dạ bác xem Boston 13 (JP9252) hoặc Adios Pro 4 (IG8054) ạ\"}";
  const landing = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: "tư vấn giày chạy size 42", soAnh: 0, luc: AT }], found });
  const { brain } = await brainWith(landing, { analyzer: scriptedModel([analysisOf("product_advice")]), agent: scriptedModel([lookup, reply]), writer: null });
  await brain.handleInbound({ ...MESSAGE, chu: "tư vấn giày chạy size 42" });
  assert.deepEqual(sentBody(landing)["theSanPham"], [{ ma: "JP9252", size: "42" }, { ma: "IG8054", size: "42" }]);
  const again = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: "tư vấn giày chạy size 42", soAnh: 0, luc: AT }], found, theDaGui: ["JP9252", "IG8054"] });
  const { brain: brain2 } = await brainWith(again, { analyzer: scriptedModel([analysisOf("product_advice")]), agent: scriptedModel([lookup, reply]), writer: null });
  await brain2.handleInbound({ ...MESSAGE, chu: "tư vấn giày chạy size 42" });
  assert.equal(sentBody(again)["theSanPham"], undefined, "both cards went within six hours: none asked again");
});

test("GĐ5: a transfer receipt (by the model's kind, or by the bank words in its text) → the neutral sentence and a person, before any model writes; a shoe photo goes on to the agent", async () => {
  const photo = "https://scontent.test/bienlai.jpg";
  const thread = [{ maTin: "m_bl", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: AT, anh: [photo] }];
  for (const answer of [
    "{\"loai\":\"bien_lai\",\"amount\":1890000,\"text\":\"Vietcombank - 1.890.000 VND - Giao dịch thành công\"}",
    "{\"loai\":\"khac\",\"amount\":0,\"text\":\"Vietcombank chuyển khoản thành công 1.890.000\"}"
  ]) {
    const landing = landingWith({ thread, found: [] });
    const vision = scriptedModel([answer]);
    const agent = scriptedModel(["{\"reply\":\"khong toi day\"}"]);
    const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([analysisOf("send_image")]), agent, writer: null }, { vision });
    const result = await brain.handleInbound({ ...MESSAGE, chu: "", soAnh: 1, anh: [photo] });
    assert.equal((result as { viSao?: string }).viSao, "chuyen_nguoi_that", JSON.stringify(result));
    assert.match(landing.sent()[0] ?? "", /em đã nhận thông tin, em báo người phụ trách đối chiếu/);
    assert.doesNotMatch(landing.sent()[0] ?? "", /đã nhận (được )?tiền/);
    assert.ok(landing.notices().some((n) => /bien lai/.test(n)));
    assert.equal(agent.seen.length, 0, "no agent, no LLM#1");
    const d = dossier.last()!;
    assert.equal(d.anh?.loai, "bien_lai");
    assert.equal(d.router, undefined, "the router never ran");
    const saved = landing.calls.filter((c) => c.path.startsWith("/api/bo-nao/tri-nho/") && c.body !== null).at(-1)!.body as { trangThai: { imageLabels: Record<string, string> } };
    assert.match(Object.values(saved.trangThai.imageLabels)[0] ?? "", /biên lai/i, "the photo is labelled a receipt in memory");
  }
  // A shoe photo with no words: a product, the agent answers — never a receipt because the page once mentioned a bank.
  const shoe = landingWith({ thread: [{ chieu: "di", boi: "Minh", chu: "Bác chuyển vào STK 19036789012 giúp em nhé", soAnh: 0, luc: "2026-09-25T08:30:00.000Z" }, ...thread], found: BOSTON_STOCK });
  const vision2 = scriptedModel(["{\"loai\":\"san_pham\",\"brand\":\"adidas\",\"model\":\"Boston 12\",\"color\":\"đen\",\"code\":\"\",\"confidence\":0.7}"]);
  const agent2 = scriptedModel(["{\"reply\":\"Dạ bác cho em xin tên mẫu / mã trên tem để em tra đúng ạ\"}"]);
  const { brain: brain2, dossier: dossier2 } = await brainWith(shoe, { analyzer: scriptedModel([analysisOf("send_image")]), agent: agent2, writer: null }, { vision: vision2 });
  const r2 = await brain2.handleInbound({ ...MESSAGE, chu: "", soAnh: 1, anh: [photo] });
  assert.equal(r2.daTraLoi, true, JSON.stringify(r2));
  assert.equal(dossier2.last()!.router?.quyetDinh, "agent_draft");
  assert.notEqual(dossier2.last()!.router?.lyDo, "payment_receipt_image");
  assert.equal(agent2.seen.length, 1);
});

test("GĐ5: the page asked for the shoe the customer wears → the photo is a REFERENCE: noted as such, never the focus, never looked up", async () => {
  const photo = "https://scontent.test/doidangdi.jpg";
  const thread = [
    { chieu: "den", boi: "khach", chu: "tư vấn em đôi chạy 10k", soAnh: 0, luc: "2026-09-25T08:58:00.000Z" },
    { chieu: "di", boi: "Minh", chu: "Bác đang đi size bao nhiêu ạ?", soAnh: 0, luc: "2026-09-25T08:50:00.000Z" },
    { chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: AT, anh: [photo] }
  ];
  const landing = landingWith({ thread, found: BOSTON_STOCK });
  const vision = scriptedModel(["{\"loai\":\"san_pham\",\"brand\":\"nike\",\"model\":\"Pegasus 40\",\"color\":\"đen\",\"code\":\"\",\"confidence\":0.8}"]);
  const agent = scriptedModel(["{\"reply\":\"Dạ bác đang đi Pegasus 40 size nào ạ?\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([analysisOf("send_image", { entities: {}, focus: { product: "", products: [], changed: false, reason: "", roles: [] }, lookupCommands: [] })]), agent, writer: null }, { vision });
  await brain.handleInbound({ ...MESSAGE, chu: "", soAnh: 1, anh: [photo] });
  const d = dossier.last()!;
  assert.equal(d.anh?.thamChieu, true);
  assert.match(d.ghiChu ?? "", /ĐÔI KHÁCH ĐANG ĐI .*THAM CHIẾU/);
  assert.ok(!landing.toolCalls().includes("catalog.find"), "the reference shoe is not looked up as the item to sell");
});

test("the breaker: three transient failures in five minutes open it → no model runs, scripts / lookups / engine answer, the shop is told once", async () => {
  const logger = new MemoryLogger();
  const breaker = new GatewayBreaker({ clock, logger });
  for (let i = 0; i < 3; i += 1) breaker.record({ ok: false, viSao: "gateway HTTP 524", transient: true });
  assert.equal(breaker.isOpen(), true);
  const landing = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: "còn adizero boston 13 size 42 không", soAnh: 0, luc: AT }], found: BOSTON_STOCK });
  const analyzer = scriptedModel([STOCK_ANALYSIS]);
  const agent = scriptedModel(["{\"reply\":\"khong toi day\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer, agent, writer: agent }, { breaker });
  const result = await brain.handleInbound({ ...MESSAGE, chu: "còn adizero boston 13 size 42 không" });
  assert.equal(analyzer.seen.length, 0, "LLM#1 never called");
  assert.equal(agent.seen.length, 0, "the agent and LLM#3 never called");
  assert.equal(dossier.last()!.cauDaoMo, true);
  assert.ok(landing.toolCalls().includes("catalog.find"), "the lookups still run");
  assert.equal(dossier.last()!.duongDi, "may-luat", "the engine answered");
  assert.ok(result.daTraLoi || (result as { viSao?: string }).viSao === "chuyen_nguoi_that");
  assert.equal(landing.notices().filter((n) => /cau dao/.test(n)).length, 1, "the shop is told once");
  await brain.handleInbound({ ...MESSAGE, chu: "còn adizero boston 13 size 42 không", nguoi: "k9", maHoiThoai: "facebook:k9" });
  assert.equal(landing.notices().filter((n) => /cau dao/.test(n)).length, 1, "…not on every turn");
  // A wrapped model refuses at once while open; a success closes the breaker.
  const wrapped = breaker.wrap(scriptedModel(["ok"]));
  const refused = await wrapped.complete([{ role: "user", content: "x" }]);
  assert.equal(refused.ok, false);
  breaker.record({ ok: true, text: "ok", model: "gia" });
  assert.equal(breaker.isOpen(), false);
});

test("LLM#2: one weak candidate → the model confirms it (proven) or says none (the uncertain gate decides)", async () => {
  const said = "còn boston size 42 không";
  const thread = [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: AT }];
  const logger = new MemoryLogger();
  const confirm = scriptedModel(["{\"ma\":\"JP9252\",\"lyDo\":\"khach noi boston, ung vien la Boston 13\"}"]);
  const landing = landingWith({ thread, found: BOSTON_STOCK });
  const agent = scriptedModel(["{\"reply\":\"Dạ Boston 13 size 42 còn 2 đôi ạ\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([analysisOf("ask_size", { entities: { size: "42" } })]), agent, writer: null }, { verifier: new CatalogVerifier({ model: confirm, logger }) });
  await brain.handleInbound({ ...MESSAGE, chu: said });
  assert.equal(confirm.seen.length, 1, "LLM#2 ran once");
  assert.match(confirm.seen[0]![1]!.content, /JP9252 — ADIZERO BOSTON 13 M/);
  const d = dossier.last()!;
  assert.equal(d.suThat?.khop?.lyDo, "llm2_confirmed");
  assert.equal(d.suThat?.khop?.canXacNhan, false);
  assert.equal(d.suThat?.mauChinh?.ma, "JP9252");
  assert.doesNotMatch(d.ghiChu ?? "", /CHUA CHAC MAU/);

  const deny = scriptedModel(["{\"ma\":\"\",\"lyDo\":\"khach khong noi dong nao ro\"}"]);
  const landing2 = landingWith({ thread, found: BOSTON_STOCK });
  const { brain: brain2, dossier: dossier2 } = await brainWith(landing2, { analyzer: scriptedModel([analysisOf("ask_size", { entities: { size: "42" } })]), agent: scriptedModel(["{\"reply\":\"x\"}"]), writer: null }, { verifier: new CatalogVerifier({ model: deny, logger }) });
  await brain2.handleInbound({ ...MESSAGE, chu: said });
  assert.equal(dossier2.last()!.suThat?.khop?.lyDo, "llm2_none");
  assert.notEqual(dossier2.last()!.suThat?.mauChinh?.nguon, "catalog");
});

test("ImageFetcher: the CDN refuses once, the second try succeeds → a data URL with the right mime; two failures → the address is used", async () => {
  let calls = 0;
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const fetch: ImageFetch = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 403, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
  };
  const waits: number[] = [];
  const fetcher = new ImageFetcher({ fetch, sleep: async (ms) => { waits.push(ms); } });
  const got = await fetcher.toDataUrl("https://scontent.test/a.png");
  assert.ok("dataUrl" in got && got.dataUrl.startsWith("data:image/png;base64,"));
  assert.deepEqual(waits, [1500]);
  const dead = new ImageFetcher({ fetch: async () => { throw new Error("ECONNRESET"); }, sleep: async () => undefined });
  const failed = await dead.toDataUrl("https://scontent.test/b.jpg");
  assert.ok("error" in failed && /ECONNRESET/.test(failed.error));
});

// ---- the scenario measurements of 25/09/2026 (kb2-19, kb2-07, kb2-03) ------------------------------

const SUPERNOVA = [{ ma: "JH6178", ten: "ADIDAS SUPERNOVA RISE M", loai: "HANG SAN", cac_size: [{ size: "41 1/3", gia: 2790000, so_luong: 1 }, { size: "42", gia: 2790000, so_luong: 2 }], anh: "", link: "https://shop.vn/product/jh6178" }];

test("kb2-19: 'size 41 1/3 nhé' after asking about Supernova Rise → the finder is asked for the focus LLM#1 named, not for '1/3'; no ask-back", async () => {
  const thread = [
    { chieu: "den", boi: "khach", chu: "supernova rise còn size 42 không shop", soAnh: 0, luc: "2026-09-25T08:50:00.000Z" },
    { chieu: "di", boi: "bo-nao", chu: "Dạ Supernova Rise còn ạ, bác đi size bao nhiêu ạ?", soAnh: 0, luc: "2026-09-25T08:50:30.000Z" },
    { chieu: "den", boi: "khach", chu: "size 41 1/3 nhé", soAnh: 0, luc: AT }
  ];
  const landing = landingWith({ thread, found: SUPERNOVA });
  const analysis = analysisOf("ask_size", { entities: { size: "41 1/3" }, focus: { product: "Supernova Rise", products: ["Supernova Rise"], changed: false, reason: "", roles: [] }, lookupCommands: [] });
  const agent = scriptedModel(["{\"reply\":\"Dạ Supernova Rise size 41 1/3 còn 1 đôi ạ\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([analysis]), agent, writer: null });
  const result = await brain.handleInbound({ ...MESSAGE, chu: "size 41 1/3 nhé" });
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  assert.equal((result as { hanhDong?: string }).hanhDong, "agent", "the agent answered — no 'which product?' ask-back");
  const finds = landing.calls.filter((c) => c.body?.["ten"] === "catalog.find").map((c) => JSON.stringify(c.body!["input"]));
  assert.ok(finds.length > 0 && finds.every((f) => /supernova/i.test(f) && !/1\/3"/.test(f.replace(/"size":"41 1\/3"/, ""))), finds.join(" | "));
  const d = dossier.last()!;
  assert.equal(d.suThat?.chuaChac, undefined);
  assert.equal(d.suThat?.ton?.stock?.size, "41 1/3");
  assert.match(d.ghiChu ?? "", /MAU THEO NGU CANH \(LLM#1, phien nay con nhac\): Supernova Rise/);
});

test("kb2-07: changing the size of an order placed yesterday → the ORDER branch: ask for the phone (with the shop's rule), then look the order up — never the 'which product?' gate", async () => {
  const said = "cho mình đổi sang size 43 được không, mình đặt hôm qua";
  const hoSo = emptyShopProfile();
  hoSo.xungHo.khach = "bác";
  hoSo.banHang.doiSizeDonDaDat = "Đơn chưa gửi đi thì đổi size được ạ.";
  hoSo.nguon = { "xungHo.khach": "shop", "banHang.doiSizeDonDaDat": "shop" };
  const analysis = analysisOf("return_exchange", { entities: { size: "43" }, focus: { product: "JP9252", products: ["JP9252"], changed: false, reason: "", roles: [] }, lookupCommands: [{ command: "check_order", args: {} }] });
  const noPhone = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: AT }], found: BOSTON_STOCK, extraTools: ["order.lookup"], hoSo: hoSo as unknown as Record<string, unknown> });
  const agent = scriptedModel(["{\"reply\":\"khong toi day\"}"]);
  const { brain, dossier } = await brainWith(noPhone, { analyzer: scriptedModel([analysis]), agent, writer: null });
  const asked = await brain.handleInbound({ ...MESSAGE, chu: said });
  assert.equal((asked as { hanhDong?: string }).hanhDong, "ask_back", JSON.stringify(asked));
  assert.match(noPhone.sent()[0] ?? "", /số điện thoại đặt đơn/);
  assert.match(noPhone.sent()[0] ?? "", /Đơn chưa gửi đi thì đổi size được/);
  assert.equal(agent.seen.length, 0);
  assert.notEqual(dossier.last()!.suThat?.chuaChac ?? "", "uncertain_product_ask_back:no_product", "not the product gate");
  assert.ok(dossier.last()!.router?.duongOng.includes("exchange_needs_order_phone"));

  const orders = [{ orderId: "DH2001", status: "new", statusLabel: "Mới đặt", createdAt: "2026-09-24T18:00:00.000Z", money: { total: 3290000, paid: 0, due: 3290000 }, lines: [{ name: "ADIZERO BOSTON 13 M", variantLabel: "size 42", qty: 1, code: "JP9252" }], exchange: { allowed: true, reason: "chua_mua", openItems: ["ADIZERO BOSTON 13 M size 42"] } }];
  const withPhone = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: "sđt 0912345678", soAnh: 0, luc: "2026-09-25T08:50:00.000Z" }, { chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: AT }], found: BOSTON_STOCK, extraTools: ["order.lookup"], orders, hoSo: hoSo as unknown as Record<string, unknown> });
  const agent2 = scriptedModel(["{\"reply\":\"Dạ đơn DH2001 chưa gửi, em báo người phụ trách đổi sang size 43 giúp bác ạ\"}"]);
  const { brain: brain2, dossier: dossier2 } = await brainWith(withPhone, { analyzer: scriptedModel([analysis]), agent: agent2, writer: null });
  const answered = await brain2.handleInbound({ ...MESSAGE, chu: said });
  assert.equal((answered as { hanhDong?: string }).hanhDong, "agent", JSON.stringify(answered));
  assert.ok(withPhone.calls.some((c) => c.body?.["ten"] === "order.lookup"), "the order was looked up");
  assert.match(dossier2.last()!.ghiChu ?? "", /DON CUA KHACH \(DH2001\) — DOI (BIEN THE|SIZE): CON DOI DUOC/);
  assert.equal(dossier2.last()!.suThat?.chuaChac, undefined);
});

test("kb2-03: 'chạy HM pace 4:30, size 42, cần đôi đua' → the racing segment is asked of the finder and the lines that fit go to the agent as KHUNG TU VAN NHIEU DONG + LINK", async () => {
  const said = "chạy HM pace 4:30, size 42, cần đôi đua, 3-4 triệu";
  const racing = [
    { ma: "IG8054", ten: "ADIZERO ADIOS PRO 4 M", loai: "HANG SAN", cac_size: [{ size: "42", gia: 5990000, so_luong: 1 }], anh: "", link: "https://shop.vn/product/ig8054" },
    { ma: "JH1234", ten: "ADIZERO TAKUMI SEN 11 M", loai: "HANG SAN", cac_size: [{ size: "42", gia: 4290000, so_luong: 2 }], anh: "", link: "https://shop.vn/product/jh1234" },
    { ma: "JQ0764", ten: "ADIZERO ADIOS 9 M", loai: "HANG SAN", cac_size: [{ size: "42", gia: 3290000, so_luong: 2 }], anh: "", link: "https://shop.vn/product/jq0764" }
  ];
  const landing = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: AT }], found: racing });
  const analysis = analysisOf("product_advice", { entities: { size: "42" }, needBrief: { sport: "running", pace: "4:30", distance: "HM", readyToBuy: false }, focus: { product: "", products: [], changed: false, reason: "", roles: [] }, lookupCommands: [] });
  const agent = scriptedModel(["{\"reply\":\"Dạ với HM pace 4:30 bác xem Adios Pro 4 hoặc Takumi Sen 11 ạ\"}"]);
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([analysis]), agent, writer: null });
  const result = await brain.handleInbound({ ...MESSAGE, chu: said });
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  const segment = landing.calls.find((c) => c.body?.["ten"] === "catalog.find" && (c.body!["input"] as { phan_khuc?: string }).phan_khuc === "dua");
  assert.ok(segment, "the finder was asked for the racing segment");
  const notes = dossier.last()!.ghiChu ?? "";
  assert.match(notes, /KHUNG TU VAN NHIEU DONG \+ LINK/);
  assert.match(notes, /https:\/\/shop\.vn\/\?q=[^ ]*&size=42#products/);
  assert.match(notes, /Adios Pro|Takumi/);
  assert.match(notes, /pace p430_5, cu ly hm → phan khuc "dua"/);
  assert.match(agent.seen[0]![0]!.content, /KHUNG TU VAN NHIEU DONG/);
});

test("GĐ7 (hồ sơ that-18): five codes of different lines → two cards, no ?q= link; three colourways of one line → the line's filter on the items' own site; 'bấm link để xem ảnh' is cut when cards go", async () => {
  const mk = (ma: string, ten: string, host = "shop.vn") => ({ ma, ten, loai: "HANG SAN", cac_size: [{ size: "42", gia: 2990000, so_luong: 1 }], anh: "", link: `https://${host}/product/${ma.toLowerCase()}` });
  const five = [mk("JS4115", "ADIZERO EVO SL M"), mk("HP6994", "ADIZERO ADIOS 9 M"), mk("JP9198", "SUPERNOVA RISE M"), mk("HP3263", "ULTRABOOST 5 M"), mk("JH7105", "ADIZERO SL 2 M")];
  const said = "gửi cho anh 3-4 mẫu chạy bộ size 42, gửi ảnh nhé";
  const lookup = "{\"tool\":\"tra_kho\",\"args\":{\"muc_dich\":\"chay_bo\",\"size\":\"42\"}}";
  const reply = "{\"reply\":\"Dạ bác xem Evo SL (JS4115), Adios 9 (HP6994), Supernova Rise (JP9198), Ultraboost 5 (HP3263) và SL 2 (JH7105) ạ. Bác bấm vào link từng mẫu để xem ảnh chi tiết nhé.\"}";
  const landing = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: AT }], found: five, extraTools: ["order.formLink"] });
  const { brain, dossier } = await brainWith(landing, { analyzer: scriptedModel([analysisOf("product_advice", { entities: { size: "42" }, focus: { product: "", products: [], changed: false, reason: "", roles: [] }, lookupCommands: [] })]), agent: scriptedModel([lookup, reply]), writer: null });
  await brain.handleInbound({ ...MESSAGE, chu: said });
  const body = sentBody(landing);
  assert.equal(body["linkLoc"], undefined, "five different lines share no filter");
  assert.deepEqual(body["theSanPham"], [{ ma: "JS4115", size: "42" }, { ma: "HP6994", size: "42" }], "the first two codes of the sentence");
  assert.doesNotMatch(String(body["chu"]), /bấm vào link/, "the cards ARE the pictures");
  assert.ok(dossier.last()!.cong?.dauVet.includes("photo_link_claim_removed"), dossier.last()!.cong?.dauVet.join(","));
  assert.deepEqual(dossier.last()!.guiKem?.daGui?.the, ["JS4115", "HP6994"], "what the landing said it sent");

  const three = [mk("JS4955", "ADIZERO BOSTON 13 M", "kho-ngoai.vn"), mk("IF9414", "ADIZERO BOSTON 13 M den", "kho-ngoai.vn"), mk("IH5748", "ADIZERO BOSTON 13 W", "kho-ngoai.vn")];
  const reply3 = "{\"reply\":\"Dạ Boston 13 có JS4955, IF9414 và IH5748 ạ\"}";
  const landing3 = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: "boston 13 có màu nào size 42", soAnh: 0, luc: AT }], found: three, extraTools: ["order.formLink"] });
  const { brain: brain3 } = await brainWith(landing3, { analyzer: scriptedModel([STOCK_ANALYSIS]), agent: scriptedModel([lookup, reply3]), writer: null });
  await brain3.handleInbound({ ...MESSAGE, chu: "boston 13 có màu nào size 42" });
  const body3 = sentBody(landing3);
  assert.equal(body3["theSanPham"], undefined);
  assert.match(String(body3["linkLoc"]), /^https:\/\/kho-ngoai\.vn\/\?q=.*boston.*&size=42#products$/, "one line, one filter, on the site the items live on");
});

test("the AI greeting (Desk introAlreadySent): only on a thread the page never wrote in, never in front of a handoff; an old landing's top-level chaoAi is read too", async () => {
  const reply = "{\"reply\":\"Dạ Boston 13 size 42 còn ạ\"}";
  // A page line in the history (a person or the bot) → no greeting, whatever daChaoAi says.
  const spoken = landingWith({ thread: [
    { chieu: "den", boi: "khach", chu: "boston 13 còn không", soAnh: 0, luc: "2026-09-25T08:40:00.000Z" },
    { chieu: "di", boi: "bo-nao", chu: "Dạ còn ạ, bác đi size bao nhiêu?", soAnh: 0, luc: "2026-09-25T08:41:00.000Z" },
    { chieu: "den", boi: "khach", chu: "size 42", soAnh: 0, luc: AT }
  ], found: BOSTON_STOCK });
  const { brain } = await brainWith(spoken, { analyzer: scriptedModel([STOCK_ANALYSIS]), agent: scriptedModel([reply]), writer: null });
  await brain.handleInbound({ ...MESSAGE, chu: "size 42" });
  assert.equal(sentBody(spoken)["chaoAi"], undefined, "the page already spoke in this thread");
  // The very first reply of a thread → the greeting, and the landing's answer is on record.
  const fresh = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: "boston 13 còn size 42 không", soAnh: 0, luc: AT }], found: BOSTON_STOCK });
  const { brain: brain2, dossier: dossier2 } = await brainWith(fresh, { analyzer: scriptedModel([STOCK_ANALYSIS]), agent: scriptedModel([reply]), writer: null });
  await brain2.handleInbound({ ...MESSAGE, chu: "boston 13 còn size 42 không" });
  assert.equal(sentBody(fresh)["chaoAi"], true);
  assert.equal(dossier2.last()!.guiKem?.daGui?.chaoAi, true);
  // A first turn the router hands to a person (money already sent) → no greeting in front of the handoff sentence.
  const paid = landingWith({ thread: [{ chieu: "den", boi: "khach", chu: "da chuyen 500k vao stk cua shop", soAnh: 0, luc: AT }], found: [] });
  const { brain: brain3 } = await brainWith(paid, { analyzer: scriptedModel([analysisOf("payment_confirmation")]), agent: scriptedModel([]), writer: null });
  await brain3.handleInbound({ ...MESSAGE, chu: "da chuyen 500k vao stk cua shop" });
  assert.equal(sentBody(paid)["chaoAi"], undefined);
});
