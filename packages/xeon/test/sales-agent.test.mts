/**
 * The sales agent (Sales Desk level 2, moved to Xeon 16/09/2026): the JSON tool loop, the reply
 * review (no invented price, no foreign link, no banned phrase), and its place in BrainService —
 * first in line, the rule engine behind it whenever it cannot or must not answer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BrainService, LicenseLedger, LicenseService, MemoryLogger, SalesAgent, generateSigningKey, moneyAmounts, parseAgentJson, reviewReply,
  type ChatMessage, type ChatModelPort, type FetchLike, type HistoryLine
} from "@sp/xeon";
import { loadPack } from "@sp/brain";

const T0 = Date.parse("2026-09-16T11:00:00.000Z");
const clock = { now: () => new Date(T0) };
const PACK = loadPack("giay-chay");

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

test("parseAgentJson reads JSON wrapped in prose or fences, braces inside strings included; moneyAmounts reads the ways prices are written", () => {
  assert.deepEqual(parseAgentJson("Dạ đây: ```json\n{\"reply\":\"giá {đẹp}\"}\n```"), { reply: "giá {đẹp}" });
  assert.equal(parseAgentJson("không có json"), null);
  assert.deepEqual(moneyAmounts("giá 3.290.000đ, tầm 1tr2 hoặc 890k"), [3290000, 1200000, 890000]);
  assert.deepEqual(moneyAmounts("size 42 2/3, gọi 0968411655, mã JP9252, đơn TR12345"), [], "phones, codes and sizes are not prices");
});

test("reviewReply: a price seen in a tool blocks nothing; an invented price, a foreign link or a banned phrase blocks the reply", () => {
  const base = { knownAmounts: new Set([3290000]), allowedHosts: new Set(["shop.vn"]), neverSay: PACK.identity.neverSay };
  assert.equal(reviewReply({ ...base, reply: "Dạ Boston 13 size 42 còn, giá 3.290.000đ ạ. https://shop.vn/product/jp9252" }), null);
  assert.match(String(reviewReply({ ...base, reply: "Dạ giá 2.990.000đ ạ" })), /gia_khong_nguon/);
  assert.match(String(reviewReply({ ...base, reply: "Bác xem ở https://adidas.com.vn/boston" })), /link_la/);
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
  assert.match(system, /HOI NHU CAU TRUOC KHI GUI MAU/, "Desk rules are in the prompt");
  assert.match(system, /https:\/\/shop\.vn\/\?sport=Running/, "{site} is filled in");
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

test("SalesAgent: a transient gateway failure is called again with growing pauses (1s, 2s, 4s); a wrong key is not", async () => {
  const pauses: number[] = [];
  const sleep = async (ms: number) => { pauses.push(ms); };
  const flaky = scriptedModel([new Error("gateway HTTP 524"), new Error("mô hình trả về rỗng"), new Error("gateway HTTP 429"), "{\"reply\":\"Dạ em đây ạ\"}"]);
  const outcome = await new SalesAgent({ model: flaky, logger: new MemoryLogger(), clock, sleep }).run({ agent: PACK.agent!, site: "https://shop.vn", history: HISTORY, tools: toolBox([]) });
  assert.equal(outcome.ok && outcome.reply, "Dạ em đây ạ");
  assert.deepEqual(pauses, [1000, 2000, 4000]);

  const wrongKey = scriptedModel([new Error("401 sai key"), "{\"reply\":\"khong duoc toi day\"}"]);
  const refused = await new SalesAgent({ model: wrongKey, logger: new MemoryLogger(), clock, sleep }).run({ agent: PACK.agent!, site: "https://shop.vn", history: HISTORY, tools: toolBox([]) });
  assert.equal(refused.ok, false);
  assert.equal(wrongKey.seen.length, 1, "a wrong key is not retried");
  assert.equal(!refused.ok && refused.modelDown, false);
});

test("mustHuman: complaints and money transfers never go to the agent", () => {
  assert.equal(SalesAgent.mustHuman(PACK, "em đã chuyển khoản rồi nhé"), true);
  assert.equal(SalesAgent.mustHuman(PACK, "hàng lỗi, em muốn khiếu nại"), true);
  assert.equal(SalesAgent.mustHuman(PACK, "tôi cần tìm 1 đôi tầm 1tr2 đi vừa chân cỡ 42"), false);
});

// ---- BrainService ------------------------------------------------------------------------------

interface Call { path: string; body: Record<string, unknown> | null }

function fakeLanding({ thread = [] as { chieu: string; boi: string; chu: string; soAnh: number; luc: string }[] } = {}) {
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
  return { fetch, calls };
}

async function licensedBrain(landing: ReturnType<typeof fakeLanding>, model: ChatModelPort, extra: Partial<ConstructorParameters<typeof BrainService>[0]> = {}) {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop.vn" });
  const logger = new MemoryLogger();
  const agent = new SalesAgent({ model, logger, clock, sleep: noSleep });
  return { brain: new BrainService({ license, fetch: landing.fetch, logger, clock, agent, sleep: noSleep, ...extra }), logger };
}

const MESSAGE = { tenant: "toprun", kenh: "facebook", nguoi: "k1", chu: "tôi cần tìm 1 đôi tầm 1tr2 đi vừa chân cỡ 42", maHoiThoai: "facebook:k1" };

test("BrainService: the agent answers first — it reads the thread, and its reply is sent through the landing", async () => {
  const landing = fakeLanding({ thread: [{ chieu: "den", boi: "khach", chu: MESSAGE.chu, soAnh: 0, luc: "2026-09-16T10:59:50.000Z" }] });
  const model = scriptedModel(["{\"reply\":\"Dạ bác mua giày để chạy bộ hay đi học, đi chơi hằng ngày ạ?\"}"]);
  const { brain } = await licensedBrain(landing, model);
  const result = await brain.handleInbound(MESSAGE);
  assert.deepEqual(result, { daTraLoi: true, hanhDong: "agent", traLoi: "Dạ bác mua giày để chạy bộ hay đi học, đi chơi hằng ngày ạ?" });
  const sent = landing.calls.find((c) => c.path === "/api/hop-thu/gui")!;
  assert.equal(sent.body!["chu"], "Dạ bác mua giày để chạy bộ hay đi học, đi chơi hằng ngày ạ?");
  assert.match(model.seen[0]![1]!.content, /KHACH: tôi cần tìm 1 đôi tầm 1tr2/);
  assert.ok(!landing.calls.some((c) => c.path.startsWith("/api/bo-nao/tri-nho/")), "the rule engine did not run");
});

test("BrainService: a human answered 2 minutes ago -> the bot stays quiet; the agent failing -> the rule engine answers", async () => {
  const human = fakeLanding({ thread: [
    { chieu: "den", boi: "khach", chu: "alo", soAnh: 0, luc: "2026-09-16T10:57:00.000Z" },
    { chieu: "di", boi: "omi", chu: "chào bạn", soAnh: 0, luc: "2026-09-16T10:58:00.000Z" }
  ] });
  const quiet = await licensedBrain(human, scriptedModel(["{\"reply\":\"x\"}"]));
  assert.deepEqual(await quiet.brain.handleInbound(MESSAGE), { daTraLoi: false, viSao: "nguoi_dang_truc" });
  assert.ok(!human.calls.some((c) => c.path === "/api/hop-thu/gui"));

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

test("BrainService: a money-transfer message skips the agent entirely", async () => {
  const landing = fakeLanding();
  const model = scriptedModel(["{\"reply\":\"x\"}"]);
  const { brain } = await licensedBrain(landing, model);
  await brain.handleInbound({ ...MESSAGE, chu: "em chuyển khoản rồi nha shop" });
  assert.equal(model.seen.length, 0);
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
  const model = scriptedModel(["{\"reply\":\"Dạ bác chạy cự ly bao nhiêu ạ?\"}", "{\"reply\":\"thua\"}"]);
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
  assert.equal(model.seen.length, 1, "the model ran once");
  assert.match(model.seen[0]![1]!.content, /KHACH: shop ơi\nKHACH: tìm giày chạy\nKHACH: size 42/);
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
  const { brain, logger } = await licensedBrain(landing, model);
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
  const model = scriptedModel([down, down, down, down, "{\"reply\":\"Dạ bác chạy cự ly bao nhiêu ạ?\"}"]);
  const pauses: number[] = [];
  const { brain, logger } = await licensedBrain(landing, model, { sleep: async (ms: number) => { pauses.push(ms); } });
  const result = await brain.handleInbound(MESSAGE);
  assert.equal((result as { traLoi?: string }).traLoi, "Dạ bác chạy cự ly bao nhiêu ạ?");
  assert.deepEqual(pauses, [5000], "the brain waited once before running the turn again");
  assert.deepEqual(landing.calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => c.body!["chu"]), ["Dạ bác chạy cự ly bao nhiêu ạ?"]);
  assert.ok(logger.warnings.some((m) => /chay lai ca luot/.test(m)));
});
