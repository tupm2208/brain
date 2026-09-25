/**
 * Đ7 — AI at Xeon: the draft door that never sends (with its trace, honouring the landing's mode),
 * the token ledger and the one price table, the sandbox, batch analysis of PII-stripped archives,
 * knowledge proposals and photo reading. Every model here is a script: no network, no key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AiController, AiDeskService, BrainService, LicenseLedger, LicenseService, ManualClock, MemoryLogger, MeteredChatModel, PriceTable,
  SalesAgent, UsageLedger, cleanPricing, costVnd, generateSigningKey, normalizeModelKey, readOnlyTools, readOpenAiUsage, renderKnowledge, withUsage,
  type ChatMessage, type ChatModelPort, type ChatOutcome, type FetchLike
} from "@sp/xeon";

const T0 = new Date("2026-09-17T03:00:00.000Z");
const noSleep = async (): Promise<void> => undefined;
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

function scriptedModel(answers: string[], usage = { prompt_tokens: 1000, completion_tokens: 200 }): ChatModelPort & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen,
    ready: () => true,
    complete: async (messages): Promise<ChatOutcome> => {
      seen.push(messages.map((m) => ({ ...m })));
      const next = answers.shift();
      if (next === undefined) return { ok: false, viSao: "het kich ban", transient: false };
      return { ok: true, text: next, model: "ag/gemini-3.7-flash-low", usage: readOpenAiUsage(usage) };
    }
  };
}

const BOSTON = [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M", loai: "HANG SAN", cac_size: [{ size: "42", gia: 3290000 }], anh: "https://shop.vn/a.jpg", link: "https://shop.vn/product/jp9252" }];
const KNOWLEDGE = {
  hoiDap: [{ intent: "shipping", cauHoi: "ship mấy ngày", traLoi: "Dạ nội thành 1 ngày ạ" }],
  quyTac: [{ tieuDe: "Hỏi cự ly trước", noiDung: "Khách hỏi chung thì hỏi cự ly chạy trước khi gửi mẫu", loai: "clarification_rule" }],
  cauMau: [{ cauKhach: "còn size 42 không", traLoi: "Dạ bác cho em xin mã mẫu nhé", lyDo: "thiếu mã" }],
  kienThuc: [], thuVien: [], hoSoMau: [],
  spNgoai: { ma: "NG-0917-01", ten: "Boston 12 xanh", size: "42", gia: 1490000 },
  cauHinh: { tatHangDoiTac: true }
};

interface Call { path: string; body: Body | null }

function fakeLanding(thread: { chieu: string; boi: string; chu: string; soAnh: number; luc: string }[], { knowledge = true } = {}) {
  const calls: Call[] = [];
  const tools = ["catalog.search", "catalog.find", "shop.bankAccount", "conversation.recent", "policy.get", "order.lookup", ...(knowledge ? ["training.knowledge"] : [])];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Body : null;
    calls.push({ path: u.pathname, body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: thread } });
      if (tool === "catalog.find") return reply({ ok: true, data: { ketQua: BOSTON } });
      if (tool === "training.knowledge") return reply({ ok: true, data: KNOWLEDGE });
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      return reply({ ok: true, data: { items: [], truncated: false } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: null });
    return reply({ ok: true });
  };
  return { fetch, calls };
}

async function setup(thread: Parameters<typeof fakeLanding>[0], model: ChatModelPort, { knowledge = true, dataDirectory = null as string | null } = {}) {
  const clock = new ManualClock(T0);
  const ledgerBook = await LicenseLedger.open();
  const license = new LicenseService({ ledger: ledgerBook, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const one = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  const two = await license.issueKey({ shop: "shop2", tenShop: "Shop Hai", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  const regOne = await license.registerLanding({ key: one.key, diaChi: "https://shop.vn" });
  const regTwo = await license.registerLanding({ key: two.key, diaChi: "https://shop2.vn" });
  assert.ok(regOne.ok && regTwo.ok);
  const logger = new MemoryLogger();
  const landing = fakeLanding(thread, { knowledge });
  const prices = new PriceTable(dataDirectory);
  const usage = new UsageLedger(dataDirectory, prices);
  const metered = new MeteredChatModel(model, usage, clock, "ag/gemini-3.7-flash-low");
  const agent = new SalesAgent({ model: metered, logger, clock, sleep: noSleep });
  const brain = new BrainService({ license, fetch: landing.fetch, logger, clock, agent, sleep: noSleep });
  const desk = new AiDeskService({ brain, model: metered, clock, logger });
  const controller = new AiController({ desk, ledger: usage, prices, license, priceEditors: ["toprun"], clock, logger });
  const ask = async (method: string, route: string, payload: unknown, token: string): Promise<{ status: number; body: Body }> => {
    let status = 0;
    let body: Body = {};
    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as IncomingMessage;
    const res = { writeHead(code: number) { status = code; return this; }, end(text: string) { body = text ? JSON.parse(text) : {}; } } as unknown as ServerResponse;
    const handled = await controller.handle(req, res, { method, path: route, ip: "1.1.1.1", readJson: async () => payload as Record<string, unknown> });
    assert.equal(handled, true);
    return { status, body };
  };
  return { brain, desk, landing, usage, prices, ask, clock, tokenOne: regOne.ok ? regOne.maNhanTin : "", tokenTwo: regTwo.ok ? regTwo.maNhanTin : "" };
}

const THREAD = [
  { chieu: "den", boi: "khach", chu: "shop còn Boston 13 size 42 không, số em 0912345678", soAnh: 0, luc: "2026-09-17T02:59:00.000Z" }
];

test("price table: gateway prefixes and thinking levels share a price; dated rows; unknown model = no price; a bad table is refused", () => {
  assert.equal(normalizeModelKey("ag/gemini-3.7-flash-low"), "gemini-3.7-flash");
  assert.equal(normalizeModelKey("claude-opus-5-20260101"), "claude-opus-5");
  const table = new PriceTable(null);
  assert.equal(table.priceFor("ag/gemini-3.7-flash-low", new Date("2026-12-31T10:00:00.000Z"))!.input, 0.75);
  assert.equal(table.priceFor("ag/gemini-3.7-flash-low", new Date("2027-01-01T10:00:00.000Z"))!.input, 1.5, "the 2027 price applies from 01/01 Vietnam time");
  assert.equal(table.priceFor("mo-hinh-la", T0), null);
  // 1M input at $0.75 + 1M output at $3.75, 26.120 đ/USD
  assert.equal(costVnd({ inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0 }, table.priceFor("gemini-3.7-flash", T0), 26120), 117540);
  assert.equal(cleanPricing({ rateVndPerUsd: 5, models: [] }).ok, false);
  assert.match(String((cleanPricing({ rateVndPerUsd: 26000, models: [{ key: "x", input: -1, output: 1 }] }) as { viSao: string }).viSao), /không âm/);
  const good = cleanPricing({ rateVndPerUsd: "26000", models: [{ key: "ag/Gemini-3.7-Flash-high", input: "1", output: "2", from: "2027-01-01" }, { key: "", input: "", output: "" }] });
  assert.ok(good.ok);
  assert.deepEqual(good.ok && good.pricing.models, [{ key: "gemini-3.7-flash", input: 1, output: 2, from: "2027-01-01" }], "an empty row is dropped");
  assert.deepEqual(readOpenAiUsage({ prompt_tokens: 100, completion_tokens: 111, reasoning_tokens: 2885 }), { inputTokens: 100, outputTokens: 2996, reasoningTokens: 2885, cacheReadTokens: 0 }, "the gateway counts reasoning OUTSIDE completion");
});

test("DRAFT: the reply and every step come back, NOTHING is sent, memory is not written; the shop's approved knowledge reaches the prompt; partner goods paused = own stock only", async () => {
  const model = scriptedModel([
    "{\"tool\":\"tra_kho\",\"args\":{\"ten\":\"Boston 13\",\"size\":\"42\"}}",
    "{\"reply\":\"Dạ Boston 13 size 42 bên em còn, giá 3.290.000đ ạ.\"}"
  ]);
  const { desk, landing, usage } = await setup(THREAD, model);
  const r = await desk.draft({ tenant: "toprun", maHoiThoai: "facebook:k1", kenh: "facebook", cheDo: "suggest", nguon: "nguoi" });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.traLoi, "Dạ Boston 13 size 42 bên em còn, giá 3.290.000đ ạ.");
  assert.equal(r.nguonTraLoi, "agent");
  assert.equal(r.choPhepTuGui, false, "suggest mode: a person sends");
  assert.doesNotMatch(r.tinKhach, /0912345678/, "the customer's phone never comes back in the trace");
  // The same pipeline as the live door: the thread, the router's decision, the shop's knowledge, the tool, the verdict.
  assert.deepEqual(r.dauVet.map((s) => s.loai), ["doc", "quyet-dinh", "doc", "cong-cu", "quyet-dinh", "quyet-dinh"], "…and what would go WITH the reply (Giai đoạn 7)");
  assert.match(r.dauVet[5]!.chiTiet, /landing chen cau chao/, "the opening reply carries the landing's greeting");
  assert.match(r.dauVet[1]!.chiTiet, /agent_draft \(ask_size_needs_catalog\)/);
  assert.match(r.dauVet[3]!.chiTiet, /Boston 13[\s\S]*JP9252/, "the tool step shows what was asked and what came back");
  assert.ok(!landing.calls.some((c) => c.path === "/api/hop-thu/gui"), "a draft is never sent");
  assert.ok(!landing.calls.some((c) => c.path.startsWith("/api/bo-nao/tri-nho/") && c.body !== null), "memory is read for the ground of the turn, never written by a draft");
  const findCall = landing.calls.find((c) => c.body?.["ten"] === "catalog.find")!;
  assert.equal(findCall.body!["input"]["chi_hang_san"], true, "partner goods paused: the finder is told in-stock only");
  const system = model.seen[0]![0]!.content;
  assert.match(system, /HOI DAP SHOP DA DUYET[\s\S]*ship mấy ngày/);
  assert.match(system, /VI DU VAN PHONG SHOP/);
  assert.match(system, /SAN PHAM NGOAI HE THONG[\s\S]*NG-0917-01/);
  // The ledger knows whose call it was.
  const rows = usage.rows("toprun", 0, Date.now() + 1e10);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0]!.agent, rows[0]!.channel, rows[0]!.conversationId, rows[0]!.inputTokens], ["ai_draft", "facebook", "facebook:k1", 1000]);
  assert.ok(Number(rows[0]!.costVnd) > 0);
});

test("DRAFT modes: an AUTOMATIC request for a conversation that is off is skipped; a person pressing 'Soạn bot' still gets one; no agent = the rule engine on read-only tools", async () => {
  const model = scriptedModel([]);
  const { desk, landing } = await setup(THREAD, { ready: () => false, complete: model.complete });
  const skipped = await desk.draft({ tenant: "toprun", maHoiThoai: "facebook:k1", kenh: "facebook", cheDo: "off", nguon: "tu-dong" });
  assert.equal(skipped.ok && skipped.boQua, "bot_tat");
  assert.ok(landing.calls.every((c) => c.body === null), "skipped before reading the conversation");
  const manual = await desk.draft({ tenant: "toprun", maHoiThoai: "facebook:k1", kenh: "facebook", cheDo: "off", nguon: "nguoi" });
  assert.equal(manual.ok, true, JSON.stringify(manual));
  assert.ok(manual.ok && manual.dauVet.some((s) => s.ten === "Không dùng mô hình"));
  assert.ok(!landing.calls.some((c) => c.path === "/api/hop-thu/gui"));
  assert.ok(!landing.calls.some((c) => c.path.startsWith("/api/bo-nao/tri-nho/") && c.body !== null), "memory is read, never written");
  const human = await desk.draft({ tenant: "toprun", maHoiThoai: "facebook:k1", kenh: "facebook", cheDo: "auto", nguon: "nguoi" });
  assert.equal(human.ok, true);
  const refund = await setup([{ chieu: "den", boi: "khach", chu: "hàng lỗi em muốn khiếu nại", soAnh: 0, luc: "2026-09-17T02:59:00.000Z" }], scriptedModel(["{\"reply\":\"x\"}"]));
  const handoff = await refund.desk.draft({ tenant: "toprun", maHoiThoai: "facebook:k1", kenh: "facebook", cheDo: "auto", nguon: "nguoi" });
  assert.equal(handoff.ok && handoff.canNguoi, true);
  assert.equal(handoff.ok && handoff.traLoi, "");
  assert.equal(handoff.ok && handoff.hanhDong, "human_handoff");
  assert.ok(!refund.landing.calls.some((c) => c.path === "/api/hop-thu/can-nguoi"), "a draft never calls a person");
  // A greeting is the router's script: no model, a sentence the person can send as is.
  const greet = await setup([{ chieu: "den", boi: "khach", chu: "chào shop", soAnh: 0, luc: "2026-09-17T02:59:00.000Z" }], scriptedModel(["{\"reply\":\"x\"}"]));
  const scripted = await greet.desk.draft({ tenant: "toprun", maHoiThoai: "facebook:k1", kenh: "facebook", cheDo: "auto", nguon: "nguoi" });
  assert.equal(scripted.ok && scripted.traLoi, "Dạ em nghe ạ, bác đang tìm mẫu nào để em hỗ trợ ạ?");
  assert.equal(scripted.ok && scripted.nguonTraLoi, "may-luat");
  assert.equal(scripted.ok && scripted.hanhDong, "script_reply");
  assert.ok(!greet.landing.calls.some((c) => c.path === "/api/hop-thu/gui" || c.path === "/api/hop-thu/can-nguoi"));
});

test("readOnlyTools: a tool that writes is refused even when the landing opens it", async () => {
  const inner = { available: () => ["catalog.search", "order.lookup"] as never[], online: () => true, call: async () => ({ ok: true, tool: "order.lookup", data: {} }) as never };
  const port = readOnlyTools(inner);
  assert.deepEqual(port.available(), ["catalog.search"]);
  const r = await port.call("order.lookup", { conversationId: "x" as never, phoneGivenInConversation: "0912345678" });
  assert.equal(r.ok, false);
});

test("/tin-den with cheDo suggest or off never sends; auto still does", async () => {
  const model = scriptedModel(["{\"reply\":\"Dạ còn ạ\"}"]);
  const { brain, landing } = await setup(THREAD, model);
  const message = { tenant: "toprun", kenh: "facebook", nguoi: "k1", chu: "còn không shop", maHoiThoai: "facebook:k1" };
  assert.deepEqual(await brain.handleInbound({ ...message, cheDo: "suggest" }), { daTraLoi: false, viSao: "che_do_khong_tu_gui" });
  assert.deepEqual(await brain.handleInbound({ ...message, cheDo: "off" }), { daTraLoi: false, viSao: "che_do_khong_tu_gui" });
  assert.equal(model.seen.length, 0);
  const sent = await brain.handleInbound({ ...message, cheDo: "auto" });
  assert.equal((sent as { hanhDong?: string }).hanhDong, "agent");
  assert.ok(landing.calls.some((c) => c.path === "/api/hop-thu/gui"));
});

test("SANDBOX: a made-up conversation, throwaway memory, never sent, ledger row on channel demo", async () => {
  const model = scriptedModel(["{\"reply\":\"Dạ bác chạy cự ly bao nhiêu ạ?\"}"]);
  const { desk, landing, usage } = await setup([], model);
  const r = await desk.sandbox({ tenant: "toprun", lichSu: [{ ai: "khach", chu: "shop ơi" }, { ai: "shop", chu: "dạ em nghe" }], chu: "tìm giày chạy 42" });
  assert.equal(r.ok && r.traLoi, "Dạ bác chạy cự ly bao nhiêu ạ?");
  assert.match(model.seen[0]![1]!.content, /KHACH: shop ơi[\s\S]*PAGE \(nguoi truc\): dạ em nghe[\s\S]*KHACH: tìm giày chạy 42/);
  assert.ok(!landing.calls.some((c) => c.path === "/api/hop-thu/gui" || c.body?.["ten"] === "conversation.recent"));
  assert.equal(usage.rows("toprun", 0, 1e14)[0]!.channel, "demo");
});

test("WEB ADVISOR: the same machinery for a visitor on the shop's site — own ledger row, still sends nothing", async () => {
  const model = scriptedModel(["{\"reply\":\"Dạ mẫu này bên em còn size 42 ạ.\"}"]);
  const { desk, landing, usage } = await setup([], model);
  const r = await desk.sandbox({ tenant: "toprun", lichSu: [], chu: "còn size 42 không shop", mucDich: "web" });
  assert.equal(r.ok && r.traLoi, "Dạ mẫu này bên em còn size 42 ạ.");
  // Nothing is sent, and no real conversation is read: a website visitor has none.
  assert.ok(!landing.calls.some((c) => c.path === "/api/hop-thu/gui" || c.body?.["ten"] === "conversation.recent"));
  const row = usage.rows("toprun", 0, 1e14)[0]!;
  assert.equal(row.channel, "web", "the token screen must be able to tell web traffic from Demo AI");
  assert.equal(row.agent, "web_advisor");
});

test("ANALYZE: personal data is stripped once more before the model sees it; output is cleaned; no model = 503", async () => {
  const model = scriptedModel([JSON.stringify({
    tomTat: "Khách hỏi size nhiều",
    nguyenTac: [{ tieuDe: "Hỏi mã", chiTiet: "Hỏi mã trước", loai: "hoi_lai" }],
    cauHoi: [{ intent: "ask_size", cauHoi: "còn size {size} không, gọi 0987654321", traLoi: "Dạ bác cho em mã", loai: "dynamic_rule", lyDo: "hay gặp" }, { intent: "x", cauHoi: "", traLoi: "" }]
  })]);
  const { desk } = await setup([], model);
  const r = await desk.analyze({ tenant: "toprun", hoiThoai: [{ ma: "facebook:1", tin: [{ chieu: "den", chu: "còn 42 không, sđt 0912345678, mail a@b.vn" }, { chieu: "di", chu: "dạ còn" }] }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const sent = model.seen[0]![1]!.content;
  assert.doesNotMatch(sent, /0912345678|a@b\.vn/);
  const ketQua = r.ok ? r.ketQua as Body : {};
  assert.equal(ketQua["cauHoi"].length, 1, "an empty candidate is dropped");
  assert.doesNotMatch(ketQua["cauHoi"][0].cauHoi, /0987654321/, "a phone the model echoes is stripped from the result too");
  const off = await setup([], { ready: () => false, complete: model.complete });
  const refused = await off.desk.analyze({ tenant: "toprun", hoiThoai: [{ ma: "x", tin: [{ chieu: "den", chu: "a" }] }] });
  assert.deepEqual(refused.ok ? null : [refused.status, refused.error], [503, "chua_co_mo_hinh"]);
});

test("PROPOSE and READ IMAGE: JSON cleaned; the photo goes as an image part; catalogue candidates follow", async () => {
  const model = scriptedModel([
    JSON.stringify({ id: "Tennis Người Mới!", name: "Tennis cho người mới", priority: 300, useWhen: ["tennis", "mới chơi"], description: "d", content: "# Tennis" }),
    JSON.stringify({ brand: "adidas", model: "Adizero Boston 13", color: "đen", code: "jp9252!", confidence: 0.8 })
  ]);
  const { desk } = await setup([], model);
  const proposal = await desk.propose({ tenant: "toprun", chuDe: "Tư vấn tennis cho người mới" });
  assert.equal(proposal.ok, true);
  const p = proposal.ok ? proposal.deXuat as Body : {};
  assert.deepEqual([p["id"], p["priority"], p["path"]], ["tennis_ng_i_m_i", 100, "knowledge/tennis_ng_i_m_i.md"]);
  const image = await desk.readImage({ tenant: "toprun", anh: ["https://scontent.test/giay.jpg"], goiY: "boston 1tr490", maHoiThoai: "facebook:k1", kenh: "facebook", mucDich: "" });
  assert.equal(image.ok, true, JSON.stringify(image));
  assert.deepEqual(model.seen[1]![1]!.images, ["https://scontent.test/giay.jpg"]);
  assert.equal(image.ok && (image.doc as Body)["code"], "JP9252");
  assert.equal(image.ok && image.ungVien[0]!["ma"], "JP9252");
});

test("Đ10 READ IMAGE purposes: a box tag gives code + sizes + primary size, a partner stock photo gives sizes + price; each has its own prompt and ledger agent", async () => {
  const model = scriptedModel([
    JSON.stringify({ brand: "adidas", model: "Adizero", code: "it2132", sizes: ["UK 8", "FR 42", "", "US 8.5"], primarySize: "42", text: "IT2132 FR 42", confidence: 0.9 }),
    JSON.stringify({ brand: "nike", model: "Pegasus 41", code: "", sizes: ["42", "42.5", "44"], price: "1490000.4", text: "Pegasus 41 size 42 42.5 44 1tr490", confidence: 0.7 })
  ]);
  const { desk } = await setup([], model);
  const tag = await desk.readImage({ tenant: "toprun", anh: ["data:image/jpeg;base64,AAAA"], goiY: "", maHoiThoai: "", kenh: "kho", mucDich: "tem" });
  assert.equal(tag.ok, true, JSON.stringify(tag));
  const t = tag.ok ? tag.doc as Body : {};
  assert.deepEqual([t["code"], t["primarySize"], t["sizes"]], ["IT2132", "42", ["UK 8", "FR 42", "US 8.5"]]);
  assert.match(String(model.seen[0]![0]!.content), /TEM\/NHAN/, "the tag prompt, not the customer-photo prompt");
  const stock = await desk.readImage({ tenant: "toprun", anh: ["data:image/jpeg;base64,BBBB"], goiY: "runner", maHoiThoai: "", kenh: "kho", mucDich: "ton-anh" });
  const d = stock.ok ? stock.doc as Body : {};
  assert.deepEqual([d["sizes"], d["price"], d["primarySize"]], [["42", "42.5", "44"], 1490000, undefined]);
  assert.match(String(model.seen[1]![0]!.content), /ton kho doi tac/);
});

test("TOKEN LEDGER over the door: a shop sees ONLY its own rows; sums per day / group / agent / model / conversation; the price table is read by all, written only by an editor", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xeon-ai-"));
  const model = scriptedModel(["{\"reply\":\"Dạ còn ạ\"}"]);
  const { ask, usage, tokenOne, tokenTwo, prices } = await setup(THREAD, model, { dataDirectory: dir });
  await withUsage({ shop: "toprun", agent: "bot_l2", channel: "zalo", conversationId: "zalo:g1" }, async () => {
    usage.record({ context: { shop: "toprun", agent: "bot_l2", channel: "zalo", conversationId: "zalo:g1" }, model: "ag/gemini-3.7-flash-low", ok: true, usage: { inputTokens: 5000, outputTokens: 500, reasoningTokens: 0, cacheReadTokens: 0 }, at: new Date("2026-09-16T05:00:00.000Z") });
  });
  usage.record({ context: { shop: "toprun", agent: "content_writer", postId: "lo_1-1" }, model: "claude-opus-5", ok: false, error: "Bearer sk-abcdefghijklmnop hỏng", at: new Date("2026-09-17T01:00:00.000Z") });
  usage.record({ context: { shop: "shop2", agent: "bot_l2", channel: "facebook", conversationId: "facebook:x" }, model: "claude-opus-5", ok: true, usage: { inputTokens: 9e6, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 }, at: T0 });
  const draft = await ask("POST", "/ai/goi-y", { maHoiThoai: "facebook:k1", cheDo: "auto", nguon: "nguoi" }, tokenOne);
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.equal(draft.body["choPhepTuGui"], true);

  const mine = await ask("POST", "/ai/token", { soNgay: 7 }, tokenOne);
  const s = mine.body["soToken"];
  assert.equal(s.totals.calls, 3, "two of toprun's rows + the draft; shop2's row is not here");
  assert.equal(s.totals.failedCalls, 1);
  assert.ok(s.byDay.length === 7 && s.byDay.some((d: Body) => d.groups.tra_loi_khach));
  assert.deepEqual(s.byGroup.map((g: Body) => g.group).sort(), ["content", "tra_loi_khach"]);
  assert.equal(s.topConversations[0].conversationId, "zalo:g1");
  assert.deepEqual(s.channelOptions.map((c: Body) => c.channel).sort(), ["fanpage", "zalo"]);
  assert.equal(s.content.posts[0].postId, "lo_1-1");
  const onlyZalo = await ask("POST", "/ai/token", { soNgay: 7, kenh: "zalo" }, tokenOne);
  assert.equal(onlyZalo.body["soToken"].totals.calls, 1);
  const theirs = await ask("POST", "/ai/token", { soNgay: 1 }, tokenTwo);
  assert.equal(theirs.body["soToken"].totals.calls, 1);
  const text = fs.readFileSync(path.join(dir, "ai-usage", "2026-09.ndjson"), "utf8");
  assert.doesNotMatch(text, /sk-abcdefghijklmnop|0912345678/, "no key, no message text in the ledger");

  const read = await ask("GET", "/ai/bang-gia", {}, tokenTwo);
  assert.equal(read.body["duocSua"], false);
  assert.equal(read.body["source"], "default");
  const refused = await ask("POST", "/ai/bang-gia", { rateVndPerUsd: 25000, models: [] }, tokenTwo);
  assert.equal(refused.status, 403);
  const saved = await ask("POST", "/ai/bang-gia", { rateVndPerUsd: 25000, models: [{ key: "claude-opus-5", input: 4, output: 20 }] }, tokenOne);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(new PriceTable(dir).read().pricing.rateVndPerUsd, 25000, "written to the data directory");
  assert.equal(prices.priceFor("gemini-3.7-flash", T0), null, "the saved table REPLACES the defaults");
  const bad = await ask("POST", "/ai/goi-y", {}, tokenOne);
  assert.equal(bad.status, 400);
  const stranger = await ask("POST", "/ai/token", {}, "ma-la");
  assert.equal(stranger.status, 401);
});

test("REPORTED TOKENS (/ai/ghi-token): a scan the landing paid for itself lands in the shop's book; only the landing's own agents; the gateway's usage block is read here", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xeon-ghi-token-"));
  const { ask, tokenOne, tokenTwo } = await setup([], scriptedModel([]), { dataDirectory: dir });

  const written = await ask("POST", "/ai/ghi-token", {
    viec: "tag_scan", kenh: "kho", maHoiThoai: "quet-tem:dt1", model: "ag/gemini-3.7-flash-low", ok: true,
    // The gateway's own block, verbatim: reasoning OUTSIDE completion, as only Xeon knows to read.
    soLieu: { prompt_tokens: 2000, completion_tokens: 40, reasoning_tokens: 600 }
  }, tokenOne);
  assert.equal(written.status, 200, JSON.stringify(written.body));
  assert.equal(written.body["daGhi"], true);

  const failed = await ask("POST", "/ai/ghi-token", { viec: "tag_scan", model: "ag/gemini-3.7-flash-low", ok: false, loi: "HTTP 500" }, tokenOne);
  assert.equal(failed.status, 200, JSON.stringify(failed.body));

  const book = await ask("POST", "/ai/token", { soNgay: 7 }, tokenOne);
  const s = book.body["soToken"];
  assert.equal(s.totals.calls, 2, "both the good scan and the one the gateway charged for but botched");
  assert.equal(s.totals.failedCalls, 1, "a scan that came back wrong is still money spent");
  assert.equal(s.totals.outputTokens, 640, "reasoning counted outside completion, as this gateway reports it");
  assert.deepEqual(s.byGroup.map((g: Body) => g.group), ["kho"], "label scans read as warehouse work, not as answering customers");

  const forged = await ask("POST", "/ai/ghi-token", { viec: "bot_l2", model: "claude-opus-5", ok: true }, tokenOne);
  assert.equal(forged.status, 400, "a landing cannot write rows that look like the bot answering customers");
  const noModel = await ask("POST", "/ai/ghi-token", { viec: "tag_scan", ok: true }, tokenOne);
  assert.equal(noModel.status, 400);
  const stranger = await ask("POST", "/ai/ghi-token", { viec: "tag_scan", model: "x", ok: true }, "ma-la");
  assert.equal(stranger.status, 401);
  assert.equal((await ask("POST", "/ai/token", { soNgay: 7 }, tokenTwo)).body["soToken"].totals.calls, 0, "another shop's book is untouched");
});

test("renderKnowledge: nothing = empty; a huge library is capped", () => {
  assert.equal(renderKnowledge(null), "");
  const big = { ...KNOWLEDGE, spNgoai: null, cauHinh: { tatHangDoiTac: false }, thuVien: Array.from({ length: 5 }, (_, i) => ({ ten: `T${i}`, dungKhi: ["a"], noiDung: "x".repeat(5000) })) };
  const text = renderKnowledge(big);
  assert.ok(text.length <= 9100);
  assert.doesNotMatch(text, /SAN PHAM NGOAI/);
});
