/**
 * The sales agent (Sales Desk level 2, moved to Xeon 16/09/2026): the JSON tool loop, the reply
 * review (no invented price, no foreign link, no banned phrase), and its place in BrainService —
 * first in line, the rule engine behind it whenever it cannot or must not answer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BrainService, ContextAnalyzer, DraftWriter, LicenseLedger, LicenseService, MemoryLogger, SalesAgent, generateSigningKey, moneyAmounts, parseAgentJson, reviewReply,
  type ChatMessage, type ChatModelPort, type FetchLike, type HistoryLine
} from "@sp/xeon";
import { emptyShopProfile } from "@sp/contract";
import { runningShoesPack } from "./industries.mts";
import { loadCommonAgent } from "@sp/brain";

const T0 = Date.parse("2026-09-16T11:00:00.000Z");
const clock = { now: () => new Date(T0) };
const PACK = runningShoesPack;

/** A model that answers from a script, recording what it was shown. */
function scriptedModel(answers: (string | Error)[]): ChatModelPort & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen,
    ready: () => true,
    complete: async (messages) => {
      seen.push(messages.map((m) => ({ ...m })));
      const next = answers.shift();
      if (next === undefined || next instanceof Error) return { ok: false, viSao: next?.message ?? "het kich ban", transient: !/^401/.test(next?.message ?? "") };
      return { ok: true, text: next, model: "gia" };
    }
  };
}

/** Retry pauses must not really wait in tests. */
const noSleep = async (): Promise<void> => undefined;

const BOSTON = [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M", loai: "HANG SAN", cac_size: [{ size: "42", gia: 3290000 }], anh: "", link: "https://shop.vn/product/jp9252" }];

/**
 * What LLM#1 answers on every turn since 25/09/2026 (the pipeline analyses BEFORE routing, as Desk
 * did). Every BrainService script below starts with it; the agent's answers come after.
 */
const ANALYSIS = JSON.stringify({
  intent: "product_advice", confidence: 0.8, entities: {}, needProfile: { buyerType: "", experience: "", insistOnProduct: false },
  needBrief: {}, focus: { product: "", products: [], changed: false, reason: "", roles: [] },
  contextSummary: "Khach dang tim giay", episodeSummary: "", customerGoal: "", referencesPreviousMessage: false,
  missingInformation: [], lookupCommands: [], riskFlags: []
});
/** The system prompt of an AGENT call carries the tool protocol; LLM#1's and LLM#3's do not. */
const isAgentCall = (messages: ChatMessage[]): boolean => /CONG CU \(moi luot chi goi MOT cong cu/.test(messages[0]?.content ?? "");

test("parseAgentJson reads JSON wrapped in prose or fences, braces inside strings included; moneyAmounts reads the ways prices are written", () => {
  assert.deepEqual(parseAgentJson("Dạ đây: ```json\n{\"reply\":\"giá {đẹp}\"}\n```"), { reply: "giá {đẹp}" });
  assert.equal(parseAgentJson("không có json"), null);
  assert.deepEqual(moneyAmounts("giá 3.290.000đ, tầm 1tr2 hoặc 890k"), [3290000, 1200000, 890000]);
  assert.deepEqual(moneyAmounts("giá từ 1.350k đến 2.290k"), [1350000, 2290000], "1.350k is 1,350,000 — not 350k (24/09/2026)");
  assert.deepEqual(moneyAmounts("size 42 2/3, gọi 0968411655, mã JP9252, đơn TR12345"), [], "phones, codes and sizes are not prices");
});

test("reviewReply: a price seen in a tool blocks nothing; an invented price, a foreign link or a banned phrase blocks the reply", () => {
  const base = { knownAmounts: new Set([3290000]), allowedHosts: new Set(["shop.vn"]), neverSay: PACK.identity.neverSay };
  assert.equal(reviewReply({ ...base, reply: "Dạ Boston 13 size 42 còn, giá 3.290.000đ ạ. https://shop.vn/product/jp9252" }), null);
  assert.match(String(reviewReply({ ...base, reply: "Dạ giá 2.990.000đ ạ" })), /gia_khong_nguon/);
  assert.match(String(reviewReply({ ...base, reply: "Bác xem ở https://adidas.com.vn/boston" })), /link_la/);
  // A fit promised as certain is blocked; a hedged one passes (24/09/2026).
  assert.equal(reviewReply({ ...base, reply: "Dạ chân 25cm bác đi size 42 là vừa ạ" }), "khang_dinh_size");
  assert.equal(reviewReply({ ...base, reply: "Dạ với số đo này em nghĩ size 42 sẽ hợp hơn ạ" }), null);
  assert.match(String(reviewReply({ ...base, reply: "Dạ bên em bảo hành trọn đời ạ" })), /cau_cam/);
  // The customer's budget "1tr2": talking around it is fine, a far-off amount is not.
  assert.equal(reviewReply({ ...base, budgetAmounts: [1200000], reply: "Dạ tầm giá quanh 1tr-1tr2 thì có Galaxy 6 ạ" }), null);
  assert.match(String(reviewReply({ ...base, budgetAmounts: [1200000], reply: "Dạ đôi này 2.500.000đ ạ" })), /gia_khong_nguon/);
});

function toolBox(calls: string[]) {
  return {
    findStock: async (args: Record<string, unknown>) => { calls.push(`tra_kho:${JSON.stringify(args)}`); return BOSTON; },
    policy: async () => { calls.push("chinh_sach"); return "Hàng order cọc 20%."; },
    bankAccount: async () => ({ soTaiKhoan: "123" })
  };
}

const HISTORY: HistoryLine[] = [{ who: "khach", text: "shop còn Boston 13 size 42 không", images: 0 }];

test("SalesAgent: calls the tool, then answers with the price the tool gave; the prompt carries the pack rules and {site}", async () => {
  const model = scriptedModel([
    "{\"tool\":\"tra_kho\",\"args\":{\"ten\":\"Boston 13\",\"size\":\"42\"}}",
    "{\"reply\":\"Dạ Boston 13 size 42 bên em còn hàng sẵn, giá 3.290.000đ ạ.\"}"
  ]);
  const calls: string[] = [];
  const agent = new SalesAgent({ model, logger: new MemoryLogger(), clock, sleep: noSleep });
  const outcome = await agent.run({ agent: PACK.agent!, site: "https://shop.vn", history: HISTORY, tools: toolBox(calls), neverSay: PACK.identity.neverSay });
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.ok && outcome.reply, "Dạ Boston 13 size 42 bên em còn hàng sẵn, giá 3.290.000đ ạ.");
  assert.deepEqual(calls, ["tra_kho:{\"ten\":\"Boston 13\",\"size\":\"42\"}"]);
  const system = model.seen[0]![0]!.content;
  assert.match(system, /Hoi nhu cau truoc khi goi mau/, "the industry blocks are in the prompt");
  assert.match(system, /https:\/\/shop\.vn\/\?q=/, "{site} is filled in");
  assert.match(model.seen[1]!.at(-1)!.content, /KET QUA tra_kho/);
});

test("SalesAgent: an invented price is blocked; bad JSON gets one retry; a dead gateway fails instead of hanging", async () => {
  const stubborn = "{\"reply\":\"Dạ đôi này 2.500.000đ ạ\"}";
  const invented = new SalesAgent({ model: scriptedModel([stubborn, stubborn, stubborn]), logger: new MemoryLogger(), clock, sleep: noSleep });
  const blocked = await invented.run({ agent: PACK.agent!, site: "https://shop.vn", history: HISTORY, tools: toolBox([]) });
  assert.equal(blocked.ok, false, "still invented after two rewrites");
  assert.match(!blocked.ok ? blocked.viSao : "", /gia_khong_nguon/);

  const retry = new SalesAgent({ model: scriptedModel(["em nghĩ là...", "{\"reply\":\"Dạ bác chạy cự ly bao nhiêu ạ?\"}"]), logger: new MemoryLogger(), clock, sleep: noSleep });
  const ok = await retry.run({ agent: PACK.agent!, site: "https://shop.vn", history: HISTORY, tools: toolBox([]) });
  assert.equal(ok.ok && ok.reply, "Dạ bác chạy cự ly bao nhiêu ạ?");

  const dead = new SalesAgent({ model: scriptedModel([new Error("gateway 524"), new Error("gateway 524")]), logger: new MemoryLogger(), clock, sleep: noSleep });
  const failed = await dead.run({ agent: PACK.agent!, site: "https://shop.vn", history: HISTORY, tools: toolBox([]) });
  assert.equal(failed.ok, false);
  assert.equal(!failed.ok && failed.modelDown, true, "a dead gateway is reported as such, so the brain can run the turn again");
  assert.ok(failed.trace.some((t) => /524/.test(t.error ?? "")));
});

test("SalesAgent: a blocked reply is sent back with the reason; the model looks the price up and the rewrite goes out", async () => {
  const model = scriptedModel([
    "{\"reply\":\"Dạ em gợi ý đôi khác giá 1.300.000đ ạ\"}",
    "{\"tool\":\"tra_kho\",\"args\":{\"ten\":\"Boston 13\"}}",
    "{\"reply\":\"Dạ bác xem thêm Boston 13 giá 3.290.000đ ạ\"}"
  ]);
  const logger = new MemoryLogger();
  const agent = new SalesAgent({ model, logger, clock, sleep: noSleep });
  const outcome = await agent.run({ agent: PACK.agent!, site: "https://shop.vn", history: HISTORY, tools: toolBox([]) });
  assert.equal(outcome.ok && outcome.reply, "Dạ bác xem thêm Boston 13 giá 3.290.000đ ạ");
  assert.match(model.seen[1]!.at(-1)!.content, /BI CHAN.*gia_khong_nguon: 1300000/);
  assert.ok(logger.warnings.some((m) => /cau bi chan .*1\.300\.000/.test(m)), "the blocked sentence is logged, so the next diagnosis is one grep");
});

test("SalesAgent: one empty answer from the gateway is retried, and the customer still gets a reply", async () => {
  const model = scriptedModel([new Error("mô hình trả về rỗng"), "{\"reply\":\"Dạ size 35 nữ em tra ngay ạ\"}"]);
  const outcome = await new SalesAgent({ model, logger: new MemoryLogger(), clock, sleep: noSleep }).run({ agent: PACK.agent!, site: "https://shop.vn", history: HISTORY, tools: toolBox([]) });
  assert.equal(outcome.ok && outcome.reply, "Dạ size 35 nữ em tra ngay ạ");
});

test("SalesAgent: a transient gateway failure is called again ONCE after 1s (25/09/2026: the breaker handles an outage); a wrong key is not", async () => {
  const pauses: number[] = [];
  const sleep = async (ms: number) => { pauses.push(ms); };
  const flaky = scriptedModel([new Error("gateway HTTP 524"), "{\"reply\":\"Dạ em đây ạ\"}"]);
  const outcome = await new SalesAgent({ model: flaky, logger: new MemoryLogger(), clock, sleep }).run({ agent: PACK.agent!, site: "https://shop.vn", history: HISTORY, tools: toolBox([]) });
  assert.equal(outcome.ok && outcome.reply, "Dạ em đây ạ");
  assert.deepEqual(pauses, [1000]);
  const twice = scriptedModel([new Error("gateway HTTP 524"), new Error("gateway HTTP 524"), "{\"reply\":\"khong toi day\"}"]);
  const gaveUp = await new SalesAgent({ model: twice, logger: new MemoryLogger(), clock, sleep }).run({ agent: PACK.agent!, site: "https://shop.vn", history: HISTORY, tools: toolBox([]) });
  assert.equal(gaveUp.ok, false);
  assert.equal(!gaveUp.ok && gaveUp.modelDown, true);
  assert.equal(twice.seen.length, 2, "two attempts, not four");

  const wrongKey = scriptedModel([new Error("401 sai key"), "{\"reply\":\"khong duoc toi day\"}"]);
  const refused = await new SalesAgent({ model: wrongKey, logger: new MemoryLogger(), clock, sleep }).run({ agent: PACK.agent!, site: "https://shop.vn", history: HISTORY, tools: toolBox([]) });
  assert.equal(refused.ok, false);
  assert.equal(wrongKey.seen.length, 1, "a wrong key is not retried");
  assert.equal(!refused.ok && refused.modelDown, false);
});

test("mustHuman: complaints and money ALREADY SENT go to a person; a QUESTION about paying does not", () => {
  // Reserved for a person — the customer is reporting money that has left their account.
  for (const said of [
    "em đã chuyển khoản rồi nhé",
    "em vừa chuyển khoản 500k rồi nhé",
    "em đã cọc 300k vào stk của shop",
    "mình ck rồi shop check giúp",
    "đây là biên lai chuyển tiền của em",
    "hàng lỗi, em muốn khiếu nại",
    "cho em gặp người phụ trách"
  ]) assert.equal(SalesAgent.mustHuman(PACK, said, { chung: loadCommonAgent() }), true, said);

  // The bot's to answer. Every line here was blocked before 21/09/2026 by a bare `chuyen khoan`,
  // and the first one is the real message that made this visible — Desk reads it `deposit_instruction`.
  for (const asked of [
    "Có cách nào không chuyển khoản cọc vẫn mua được ko em",
    "chuyển khoản mấy % thì giữ đơn em",
    "cọc bao nhiêu thì shop lên đơn ạ",
    "em trả tiền khi nhận hàng được không ạ",
    "shop cho em xin stk với",
    "shop đã chuyển hàng chưa ạ",
    "tôi cần tìm 1 đôi tầm 1tr2 đi vừa chân cỡ 42"
  ]) assert.equal(SalesAgent.mustHuman(PACK, asked, { chung: loadCommonAgent() }), false, asked);
});

// ---- BrainService ------------------------------------------------------------------------------

interface Call { path: string; body: Record<string, unknown> | null }

function fakeLanding({ thread = [] as { chieu: string; boi: string; chu: string; soAnh: number; luc: string }[], khopAnh = null as unknown, chuDeNguoi = null as string[] | null } = {}) {
  const calls: Call[] = [];
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "storefront.link", "catalog.find", "shop.bankAccount", "conversation.recent",
    // A landing whose warehouse module is older does not open the photo tool at all.
    ...(khopAnh === null ? [] : ["catalog.matchImage"]),
    // A landing with the Chatbot tab filled in opens the shop profile (tier 3).
    ...(chuDeNguoi === null ? [] : ["shop.profile"])];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: thread } });
      if (tool === "catalog.matchImage") return reply({ ok: true, data: khopAnh });
      if (tool === "shop.profile") return reply({ ok: true, data: { hoSo: { ...emptyShopProfile(), chuyenNguoi: { chuDe: chuDeNguoi ?? [], mucChot: "", gioTruc: "" } }, chinhSach: { doiTra: "", ship: "", baoHanh: "" }, kho: [] } });
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
  return { fetch, calls };
}

async function licensedBrain(landing: ReturnType<typeof fakeLanding>, model: ChatModelPort, extra: Partial<ConstructorParameters<typeof BrainService>[0]> = {}) {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop.vn" });
  const logger = new MemoryLogger();
  const agent = new SalesAgent({ model, logger, clock, sleep: noSleep });
  // The three model seats of the pipeline on the SAME scripted model, in call order: LLM#1, the agent, LLM#3.
  const analyzer = new ContextAnalyzer({ model, logger });
  const writer = new DraftWriter({ model, logger });
  return { brain: new BrainService({ license, fetch: landing.fetch, logger, clock, agent, analyzer, writer, sleep: noSleep, ...extra }), logger };
}

const MESSAGE = { tenant: "toprun", kenh: "facebook", nguoi: "k1", chu: "tôi cần tìm 1 đôi tầm 1tr2 đi vừa chân cỡ 42", maHoiThoai: "facebook:k1" };

test("BrainService: the agent answers first — it reads the thread, and its reply is sent through the landing", async () => {
  const landing = fakeLanding({ thread: [{ chieu: "den", boi: "khach", chu: MESSAGE.chu, soAnh: 0, luc: "2026-09-16T10:59:50.000Z" }] });
  const model = scriptedModel([ANALYSIS, "{\"reply\":\"Dạ bác mua giày để chạy bộ hay đi học, đi chơi hằng ngày ạ?\"}"]);
  const { brain } = await licensedBrain(landing, model);
  const result = await brain.handleInbound(MESSAGE);
  assert.deepEqual(result, { daTraLoi: true, hanhDong: "agent", traLoi: "Dạ bác mua giày để chạy bộ hay đi học, đi chơi hằng ngày ạ?" });
  const sent = landing.calls.find((c) => c.path === "/api/hop-thu/gui")!;
  assert.equal(sent.body!["chu"], "Dạ bác mua giày để chạy bộ hay đi học, đi chơi hằng ngày ạ?");
  // Call order of the pipeline: LLM#1 read the conversation first, then the agent wrote.
  assert.equal(model.seen.length, 2);
  assert.ok(!isAgentCall(model.seen[0]!) && isAgentCall(model.seen[1]!), "analysis first, agent second");
  assert.match(model.seen[1]![1]!.content, /KHACH: tôi cần tìm 1 đôi tầm 1tr2/);
  assert.match(model.seen[1]![0]!.content, /PHAN TICH NGU CANH \(LLM#1\): y dinh product_advice/, "LLM#1's reading is in the agent's notes");
  // Tier 1 (24/09/2026): the agent path READS memory before the turn and WRITES the ledger after —
  // the rule engine did not run, but a memory call is no longer the sign of it. Its ledger is.
  const saved = landing.calls.filter((c) => c.path.startsWith("/api/bo-nao/tri-nho/") && c.body !== null).at(-1);
  assert.ok(saved, "the ledger was written after the reply");
  assert.ok(((saved!.body as Record<string, unknown>)["trangThai"] as { ledger?: unknown }).ledger !== undefined, "the state carries the ledger");
});

test("BrainService: a human answered 2 minutes ago -> the bot stays quiet; the agent failing -> the rule engine answers", async () => {
  const human = fakeLanding({ thread: [
    { chieu: "den", boi: "khach", chu: "alo", soAnh: 0, luc: "2026-09-16T10:57:00.000Z" },
    { chieu: "di", boi: "omi", chu: "chào bạn", soAnh: 0, luc: "2026-09-16T10:58:00.000Z" }
  ] });
  const quietModel = scriptedModel(["{\"reply\":\"x\"}"]);
  const quiet = await licensedBrain(human, quietModel);
  assert.deepEqual(await quiet.brain.handleInbound(MESSAGE), { daTraLoi: false, viSao: "nguoi_dang_truc" });
  assert.ok(!human.calls.some((c) => c.path === "/api/hop-thu/gui"));
  assert.equal(quietModel.seen.length, 0, "not even LLM#1 runs while a person is answering");

  // Every model seat is dead: LLM#1 → null, the agent → modelDown twice, LLM#3 → nothing. The engine is last.
  const broken = fakeLanding();
  const fallback = await licensedBrain(broken, scriptedModel([new Error("gateway 524")]));
  const result = await fallback.brain.handleInbound(MESSAGE);
  assert.notEqual((result as { hanhDong?: string }).hanhDong, "agent");
  assert.ok(broken.calls.some((c) => c.path.startsWith("/api/bo-nao/tri-nho/")), "the rule engine took the turn");
  assert.ok(fallback.logger.warnings.some((m) => /may luat tra loi/.test(m)));
  // The engine did not understand the sentence either: no bare greeting, a handoff sentence + notice.
  assert.equal((result as { viSao?: string }).viSao, "chuyen_nguoi_that");
  const sent = broken.calls.find((c) => c.path === "/api/hop-thu/gui")!;
  assert.equal(sent.body!["chu"], "Dạ em nhờ nhân viên kiểm lại rồi trả lời bác ngay ạ.");
  assert.ok(broken.calls.some((c) => c.path === "/api/hop-thu/can-nguoi"));
});

test("BrainService: money already sent is HANDED OVER by the router with the neutral sentence — never the engine's bare greeting, never the agent", async () => {
  const said = "em đã cọc 300k vào stk của shop rồi nhé";
  const landing = fakeLanding({ thread: [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: "2026-09-16T10:59:50.000Z" }] });
  const model = scriptedModel([ANALYSIS, "{\"reply\":\"khong duoc toi day\"}"]);
  const { brain } = await licensedBrain(landing, model);

  const result = await brain.handleInbound({ ...MESSAGE, chu: said });
  assert.equal((result as { viSao?: string }).viSao, "chuyen_nguoi_that");
  assert.equal(model.seen.length, 1, "LLM#1 read the turn; the agent never runs for a payment claim");
  assert.ok(!isAgentCall(model.seen[0]!));
  // Both halves: the customer hears the NEUTRAL acknowledgement (the bot never says the money
  // arrived — 24/09/2026), and the shop is told there is work waiting.
  const sent = landing.calls.find((c) => c.path === "/api/hop-thu/gui")!;
  assert.equal(sent.body!["chu"], "Dạ em đã nhận thông tin, em báo người phụ trách đối chiếu và báo lại bác ngay ạ.");
  const notice = landing.calls.find((c) => c.path === "/api/hop-thu/can-nguoi")!;
  assert.ok(notice, "nobody was told before 21/09/2026 — that was the whole bug");
  assert.equal(String(notice.body!["lyDo"]), "payment_ack");
  assert.ok(!landing.calls.some((c) => c.body?.["ten"] === "catalog.search"), "the rule engine did not run");
});

test("BrainService: the shop's own 'a person takes this' topic is honoured AFTER the router, with the pack's handoff sentence", async () => {
  const said = "cho em xin hoá đơn đỏ của đơn hôm qua";
  const landing = fakeLanding({ thread: [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: "2026-09-16T10:59:50.000Z" }], chuDeNguoi: ["hoá đơn đỏ"] });
  const model = scriptedModel([ANALYSIS, "{\"reply\":\"khong duoc toi day\"}"]);
  const { brain } = await licensedBrain(landing, model);
  const result = await brain.handleInbound({ ...MESSAGE, chu: said });
  assert.equal((result as { viSao?: string }).viSao, "chuyen_nguoi_that");
  assert.equal(model.seen.length, 1, "the agent never runs");
  const sent = landing.calls.find((c) => c.path === "/api/hop-thu/gui")!;
  assert.equal(sent.body!["chu"], "Dạ em nhờ nhân viên kiểm lại rồi trả lời bác ngay ạ.");
  assert.match(String(landing.calls.find((c) => c.path === "/api/hop-thu/can-nguoi")!.body!["lyDo"]), /bo luat nganh/);
});

test("ẢNH KHÁCH GỬI: bộ não đọc ảnh trước lượt, hỏi landing ảnh là mã nào, rồi đưa kết luận vào ngữ cảnh của agent", async () => {
  const photo = "https://scontent.test/boston.jpg";
  const landing = fakeLanding({
    thread: [{ chieu: "den", boi: "khach", chu: "còn mẫu này không shop", soAnh: 1, luc: "2026-09-16T10:59:50.000Z" }],
    khopAnh: { chot: { ket: "tu_tin", ma: "JP9252", viSao: "catalog_gallery_fingerprint" }, ungVien: [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M" }], khoangCach: 4, loiNhan: "" }
  });
  const vision = scriptedModel(["{\"brand\":\"adidas\",\"model\":\"Boston 13\",\"color\":\"xanh\",\"code\":\"\",\"confidence\":0.8}"]);
  const model = scriptedModel([ANALYSIS, "{\"reply\":\"Dạ Boston 13 size 42 bên em còn ạ\"}"]);
  const { brain } = await licensedBrain(landing, model, { vision });

  const result = await brain.handleInbound({ ...MESSAGE, chu: "còn mẫu này không shop", soAnh: 1, anh: [photo, "javascript:alert(1)"] });
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  // Chỉ ảnh https mới được gửi cho mô hình nhìn ảnh.
  assert.deepEqual(vision.seen[0]!.at(-1)!.images, [photo]);
  const asked = landing.calls.find((c) => c.body?.["ten"] === "catalog.matchImage");
  assert.ok(asked, "phải hỏi landing — ảnh catalog nằm ở máy shop, Xeon không giữ");
  assert.deepEqual(asked!.body!["input"], { anh: photo, maDocDuoc: "" });
  // Kết luận nằm trong prompt của agent, nên agent tra kho theo mã đã chắc.
  assert.match(model.seen[1]![0]!.content, /ẢNH KHÁCH GỬI: adidas Boston 13 xanh\. Ảnh trùng ảnh catalog của mã JP9252 \(ADIZERO BOSTON 13 M\)/);
});

test("ẢNH KHÁCH GỬI: ảnh dùng chung nhiều mã thì CẤM agent tự chọn; landing đời cũ không mở công cụ thì vẫn trả lời như trước", async () => {
  const photo = "https://scontent.test/chung.jpg";
  const ask = fakeLanding({
    thread: [{ chieu: "den", boi: "khach", chu: "mẫu này còn không", soAnh: 1, luc: "2026-09-16T10:59:50.000Z" }],
    khopAnh: { chot: { ket: "hoi_lai", viSao: "shared_catalog_image", luaChon: ["KE3752", "KE3753"], loiNhan: "Ảnh này dùng chung cho nhiều mã." }, ungVien: [{ ma: "KE3752", ten: "Galaxy 6" }, { ma: "KE3753", ten: "Galaxy 6 W" }], khoangCach: 4, loiNhan: "" }
  });
  const vision = scriptedModel(["{\"brand\":\"adidas\",\"model\":\"Galaxy 6\",\"color\":\"đen\",\"code\":\"KE0117\"}"]);
  const model = scriptedModel([ANALYSIS, "{\"reply\":\"Dạ bác xác nhận giúp em mẫu nào ạ?\"}"]);
  const { brain } = await licensedBrain(ask, model, { vision });
  await brain.handleInbound({ ...MESSAGE, chu: "mẫu này còn không", soAnh: 1, anh: [photo] });
  const prompt = model.seen[1]![0]!.content;
  assert.match(prompt, /chữ đọc được trên ảnh: KE0117/, "chữ trên tem vẫn được nói ra, nhưng không được dùng một mình");
  assert.match(prompt, /CHƯA CHẮC là mã nào — có thể KE3752 \(Galaxy 6\) hoặc KE3753 \(Galaxy 6 W\)/);
  assert.match(prompt, /KHÔNG được tự chọn một mã/);

  // Landing chưa có công cụ khớp ảnh: vẫn đọc ảnh, nhưng nói rõ là chưa đối chiếu được.
  const old = fakeLanding({ thread: [{ chieu: "den", boi: "khach", chu: "mẫu này còn không", soAnh: 1, luc: "2026-09-16T10:59:50.000Z" }] });
  const vision2 = scriptedModel(["{\"brand\":\"nike\",\"model\":\"Pegasus 41\",\"color\":\"trắng\",\"code\":\"\"}"]);
  const { brain: brainOld } = await licensedBrain(old, scriptedModel([ANALYSIS, "{\"reply\":\"Dạ em kiểm giúp bác ạ\"}"]), { vision: vision2 });
  const answered = await brainOld.handleInbound({ ...MESSAGE, chu: "mẫu này còn không", soAnh: 1, anh: [photo] });
  assert.equal(answered.daTraLoi, true);
  assert.ok(!old.calls.some((c) => c.body?.["ten"] === "catalog.matchImage"), "công cụ không mở thì không gọi");

  // Không có mô hình nhìn ảnh: mọi thứ chạy y như trước, không một lời nào về ảnh.
  const blind = fakeLanding({ thread: [{ chieu: "den", boi: "khach", chu: "mẫu này còn không", soAnh: 1, luc: "2026-09-16T10:59:50.000Z" }] });
  const plain = scriptedModel([ANALYSIS, "{\"reply\":\"Dạ em kiểm giúp bác ạ\"}"]);
  const { brain: brainBlind } = await licensedBrain(blind, plain);
  await brainBlind.handleInbound({ ...MESSAGE, chu: "mẫu này còn không", soAnh: 1, anh: [photo] });
  assert.doesNotMatch(plain.seen[1]![0]!.content, /ẢNH KHÁCH GỬI: /);
});

test("BrainService: a money-transfer message skips the agent entirely (only LLM#1 reads it)", async () => {
  const landing = fakeLanding();
  const model = scriptedModel([ANALYSIS, "{\"reply\":\"x\"}"]);
  const { brain } = await licensedBrain(landing, model);
  await brain.handleInbound({ ...MESSAGE, chu: "em chuyển khoản rồi nha shop" });
  assert.equal(model.seen.length, 1);
  assert.ok(!isAgentCall(model.seen[0]!));
});

test("BrainService: a first greeting is a SCRIPT — sent at once, no agent turn spent, the memory still written", async () => {
  const landing = fakeLanding({ thread: [{ chieu: "den", boi: "khach", chu: "chào shop", soAnh: 0, luc: "2026-09-16T10:59:50.000Z" }] });
  // LLM#1 reads a greeting as a greeting; the router's script wins (Desk: local_greeting_wins).
  const model = scriptedModel([ANALYSIS.replace("product_advice", "greeting"), "{\"reply\":\"khong duoc toi day\"}"]);
  const { brain } = await licensedBrain(landing, model);
  const result = await brain.handleInbound({ ...MESSAGE, chu: "chào shop" });
  assert.deepEqual(result, { daTraLoi: true, hanhDong: "send", traLoi: "Dạ em nghe ạ, bác đang tìm mẫu nào để em hỗ trợ ạ?" });
  assert.equal(model.seen.length, 1, "LLM#1 only");
  const saved = landing.calls.filter((c) => c.path.startsWith("/api/bo-nao/tri-nho/") && c.body !== null).at(-1);
  assert.ok(saved, "the ledger was written after the script went out");
});

test("BrainService: quota spent → LLM#3 answers from the facts (no person called); agent blocked → LLM#3 too, under the same review", async () => {
  const landing = fakeLanding();
  // Turn 1 uses the single agent turn of the hour; turn 2: LLM#1, no agent, LLM#3.
  const model = scriptedModel([
    ANALYSIS, "{\"reply\":\"Dạ bác chạy cự ly bao nhiêu ạ?\"}",
    ANALYSIS, "{\"reply\":\"Dạ bác cho em xin tên mẫu để em tra tồn ạ\",\"needsHuman\":false,\"reason\":\"thieu mau\"}"
  ]);
  const { brain, logger } = await licensedBrain(landing, model, { agentTurnsPerHour: 1 });
  await brain.handleInbound(MESSAGE);
  const second = await brain.handleInbound({ ...MESSAGE, nguoi: "k2", maHoiThoai: "facebook:k2" });
  assert.deepEqual(second, { daTraLoi: true, hanhDong: "agent", traLoi: "Dạ bác cho em xin tên mẫu để em tra tồn ạ" });
  assert.ok(logger.warnings.some((m) => /het quota/.test(m)));
  assert.equal(model.seen.length, 4);
  assert.ok(!isAgentCall(model.seen[3]!), "the fourth call is LLM#3, not the agent");
  assert.match(model.seen[3]![1]!.content, /VI DU CAU NGUOI TRUC THAT/, "LLM#3's lean prompt");
  assert.ok(!landing.calls.some((c) => c.path === "/api/hop-thu/can-nguoi"), "a spent quota is not a reason to call a person any more");

  // The agent writes an invented price three times and is blocked: LLM#3 answers; its own invented price is blocked the same way.
  const blockedLanding = fakeLanding();
  const stubborn = "{\"reply\":\"Dạ đôi này 2.500.000đ ạ\"}";
  const draftModel = scriptedModel([ANALYSIS, stubborn, stubborn, stubborn, "{\"reply\":\"Dạ bác cho em xin tên mẫu ạ\"}"]);
  const { brain: blockedBrain } = await licensedBrain(blockedLanding, draftModel);
  const result = await blockedBrain.handleInbound(MESSAGE);
  assert.deepEqual(result, { daTraLoi: true, hanhDong: "agent", traLoi: "Dạ bác cho em xin tên mẫu ạ" });
  const stillInvents = scriptedModel([ANALYSIS, stubborn, stubborn, stubborn, stubborn]);
  const inventLanding = fakeLanding();
  const { brain: inventBrain } = await licensedBrain(inventLanding, stillInvents);
  const refused = await inventBrain.handleInbound(MESSAGE);
  assert.equal((refused as { viSao?: string }).viSao, "chuyen_nguoi_that", "LLM#3 invented a price too: blocked, the engine could not answer, a person is called");
  assert.ok(!inventLanding.calls.some((c) => c.path === "/api/hop-thu/gui" && /2\.500\.000/.test(String(c.body!["chu"]))), "the invented price never reached the customer");
});

// ---- Burst gathering (Sales Desk scheduleServerAIRouter) ---------------------------------------

/** Sleeps that only end when the test says so, recording how long each asked for. */
function manualSleeps() {
  const pending: { ms: number; wake: () => void }[] = [];
  return {
    pending,
    sleep: (ms: number) => new Promise<void>((wake) => { pending.push({ ms, wake }); }),
    wakeAll: async () => { for (const p of pending.splice(0)) p.wake(); await new Promise((r) => setTimeout(r, 20)); }
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test("burst: three quick messages get ONE answer, to the last, with the whole burst in view", async () => {
  const burst = [
    { chieu: "den", boi: "khach", chu: "shop ơi", soAnh: 0, luc: "2026-09-16T10:59:50.000Z" },
    { chieu: "den", boi: "khach", chu: "tìm giày chạy", soAnh: 0, luc: "2026-09-16T10:59:52.000Z" },
    { chieu: "den", boi: "khach", chu: "size 42", soAnh: 0, luc: "2026-09-16T10:59:54.000Z" }
  ];
  const landing = fakeLanding({ thread: burst });
  const model = scriptedModel([ANALYSIS, "{\"reply\":\"Dạ bác chạy cự ly bao nhiêu ạ?\"}", "{\"reply\":\"thua\"}"]);
  const sleeps = manualSleeps();
  const { brain } = await licensedBrain(landing, model, { burstWaitMs: 6000, imageWaitMs: 7000, sleep: sleeps.sleep });

  const turns = burst.map((m) => brain.handleInbound({ ...MESSAGE, chu: m.chu, luc: m.luc }));
  await settle();
  assert.deepEqual(sleeps.pending.map((p) => p.ms), [6000, 6000, 6000]);
  await sleeps.wakeAll();
  const results = await Promise.all(turns);

  assert.deepEqual(results.slice(0, 2), [{ daTraLoi: false, viSao: "gop_vao_tin_sau" }, { daTraLoi: false, viSao: "gop_vao_tin_sau" }]);
  assert.equal((results[2] as { hanhDong?: string }).hanhDong, "agent");
  assert.equal(landing.calls.filter((c) => c.path === "/api/hop-thu/gui").length, 1, "one answer for the burst");
  assert.equal(model.seen.length, 2, "one analysis, one agent turn");
  assert.match(model.seen[1]![1]!.content, /KHACH: shop ơi\n(\[[\d/ :]+\] )?KHACH: tìm giày chạy\n(\[[\d/ :]+\] )?KHACH: size 42/);
});

test("burst: the customer writes again WHILE the agent is writing — the stale reply is dropped, the newer turn answers", async () => {
  const landing = fakeLanding();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const answers = ["{\"reply\":\"Dạ câu cũ ạ\"}", "{\"reply\":\"Dạ câu mới ạ\"}"];
  let calls = 0;
  const model: ChatModelPort = {
    ready: () => true,
    complete: async () => { calls += 1; if (calls === 1) await gate; return { ok: true, text: answers.shift()!, model: "gia" }; }
  };
  // Agent only: the gate below must hold the AGENT's first call, not an analysis.
  const { brain, logger } = await licensedBrain(landing, model, { analyzer: null, writer: null });
  const first = brain.handleInbound({ ...MESSAGE, chu: "tìm giày chạy" });
  await settle();
  const second = brain.handleInbound({ ...MESSAGE, chu: "size 42 nhé" });
  await settle();
  release();
  assert.deepEqual(await first, { daTraLoi: false, viSao: "gop_vao_tin_sau" });
  assert.equal((await second as { traLoi?: string }).traLoi, "Dạ câu mới ạ");
  const sent = landing.calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => c.body!["chu"]);
  assert.deepEqual(sent, ["Dạ câu mới ạ"]);
  assert.ok(logger.infos.some((m) => /khach nhan them trong luc soan/.test(m)));
});

test("burst: a photo, or text pointing at one, waits 7 s more — unless the message is an old replay", async () => {
  const sleeps = manualSleeps();
  const { brain } = await licensedBrain(fakeLanding(), scriptedModel([]), { burstWaitMs: 6000, imageWaitMs: 7000, sleep: sleeps.sleep });
  const fresh = "2026-09-16T10:59:59.000Z";
  void brain.handleInbound({ ...MESSAGE, maHoiThoai: "facebook:a", nguoi: "a", chu: "", soAnh: 1, luc: fresh });
  void brain.handleInbound({ ...MESSAGE, maHoiThoai: "facebook:b", nguoi: "b", chu: "còn đôi này size 42 không", luc: fresh });
  void brain.handleInbound({ ...MESSAGE, maHoiThoai: "facebook:c", nguoi: "c", chu: "đôi này còn không", luc: "2026-09-16T10:00:00.000Z" });
  void brain.handleInbound({ ...MESSAGE, maHoiThoai: "facebook:d", nguoi: "d", chu: "size 42", luc: fresh });
  await settle();
  assert.deepEqual(sleeps.pending.map((p) => p.ms), [13000, 13000, 6000, 6000]);
  await sleeps.wakeAll();
});

test("BrainService: the gateway is down for a whole turn -> wait 5 s and run the whole turn again; the customer gets the real answer", async () => {
  const landing = fakeLanding();
  const down = new Error("gateway HTTP 502");
  // LLM#1 eats the first failure (→ null); the agent's four attempts fail; the whole turn runs again.
  const model = scriptedModel([down, down, down, down, down, "{\"reply\":\"Dạ bác chạy cự ly bao nhiêu ạ?\"}"]);
  const pauses: number[] = [];
  const { brain, logger } = await licensedBrain(landing, model, { sleep: async (ms: number) => { pauses.push(ms); } });
  const result = await brain.handleInbound(MESSAGE);
  assert.equal((result as { traLoi?: string }).traLoi, "Dạ bác chạy cự ly bao nhiêu ạ?");
  assert.deepEqual(pauses, [5000], "the brain waited once before running the turn again");
  assert.deepEqual(landing.calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => c.body!["chu"]), ["Dạ bác chạy cự ly bao nhiêu ạ?"]);
  assert.ok(logger.warnings.some((m) => /chay lai ca luot/.test(m)));
});
