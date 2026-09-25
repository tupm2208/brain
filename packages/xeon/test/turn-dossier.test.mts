/**
 * The TURN DOSSIER (21/09/2026): what is kept of one answered message, what is never kept, and the
 * point of the whole thing — that a turn kept this way can be RE-RUN and reach the same answer
 * without a landing, without a gateway and without the network.
 *
 * See `KE-HOACH-NHAT-KY-CHAN-DOAN.md`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BrainService, CaseNotReproducible, DiskDossierStore, LicenseLedger, LicenseService, MemoryDossierStore,
  MemoryLogger, SalesAgent,
  agentProfileOf, generateSigningKey, indexRow, makeCase, recordingToolBox, renderDossier, replayToolBox,
  replayTurn, retentionClass, runCase, safeName, scriptedChatModel, scrubSecrets,
  type ChatMessage, type ChatModelPort, type FetchLike, type RecordedToolCall, type TurnDossier
} from "@sp/xeon";

const T0 = Date.parse("2026-09-21T09:00:00.000Z");
const clock = { now: () => new Date(T0) };
const noSleep = async (): Promise<void> => undefined;

/** A catalogue big enough that the old 400-character cut would have thrown most of it away. */
const CATALOG = Array.from({ length: 12 }, (_, i) => ({
  ma: `JP92${50 + i}`,
  ten: `ADIZERO BOSTON ${13 + i} M`,
  loai: "HANG SAN",
  cac_size: [{ size: "42", gia: 3290000 + i * 10000 }],
  anh: "",
  link: `https://shop.vn/product/jp92${50 + i}`
}));

function scriptedModel(answers: string[]): ChatModelPort & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen,
    ready: () => true,
    complete: async (messages) => {
      seen.push(messages.map((m) => ({ ...m })));
      const next = answers.shift();
      if (next === undefined) return { ok: false, viSao: "het kich ban", transient: false };
      return { ok: true, text: next, model: "gia/mo-hinh-thu" };
    }
  };
}

function fakeLanding(thread: { chieu: string; boi: string; chu: string; soAnh: number; luc: string }[] = []) {
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "storefront.link", "catalog.find", "shop.bankAccount", "conversation.recent"];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: thread } });
      if (tool === "catalog.find") return reply({ ok: true, data: { ketQua: CATALOG } });
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 5000 } });
      return reply({ ok: true, data: { items: [], rows: [], truncated: false, asOf: "" } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: null });
    if (u.pathname === "/api/hop-thu/gui") return reply({ ok: true });
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  return { fetch };
}

async function licensedBrain(fetch: FetchLike, model: ChatModelPort, dossier: MemoryDossierStore) {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop.vn" });
  const logger = new MemoryLogger();
  const agent = new SalesAgent({ model, logger, clock, sleep: noSleep });
  return { brain: new BrainService({ license, fetch, logger, clock, agent, sleep: noSleep, dossier }), logger };
}

const MESSAGE = { tenant: "toprun", kenh: "facebook", nguoi: "k1", chu: "cho em hỏi đôi boston size 42", maHoiThoai: "facebook:k1" };
const THREAD = [{ chieu: "den", boi: "khach", chu: MESSAGE.chu, soAnh: 0, luc: "2026-09-21T08:59:50.000Z" }];

// ---- what is kept, what never is ---------------------------------------------------------------

test("scrubSecrets removes what never helps reproduce a bug, and keeps what does", () => {
  const scrubbed = scrubSecrets({
    maNhanTin: "abc123", matKhau: "hunter2", token: "t", authorization: "Bearer zzz",
    // Kept on purpose (decision of 21/09/2026): without these a bug cannot be reproduced.
    ma: "JP9252", sdt: "0912345678", diaChi: "12 Lê Lợi, Q1",
    chu: "key của em là TR-ABCD-EFGH-JKLM-NPQR, gọi bằng Bearer abcdef123456 nhé"
  });
  assert.equal(scrubbed.maNhanTin, "***");
  assert.equal(scrubbed.matKhau, "***");
  assert.equal(scrubbed.token, "***");
  assert.equal(scrubbed.authorization, "***");
  // A product code is `ma`; masking it would gut the dossier.
  assert.equal(scrubbed.ma, "JP9252");
  assert.equal(scrubbed.sdt, "0912345678");
  assert.equal(scrubbed.diaChi, "12 Lê Lợi, Q1");
  // A licence key or a bearer token written in free text is masked wherever it turns up.
  assert.match(scrubbed.chu, /TR-\*\*\*\*-\*\*\*\*-\*\*\*\*-\*\*\*\*/);
  assert.match(scrubbed.chu, /Bearer \*\*\*/);
  assert.ok(!scrubbed.chu.includes("abcdef123456"));
});

test("scrubSecrets walks arrays and nests, and does not hang on a cycle", () => {
  const cyclic: Record<string, unknown> = { ten: "vòng", token: "x" };
  cyclic["self"] = cyclic;
  const scrubbed = scrubSecrets({ danhSach: [{ password: "p", ma: "A1" }], long: cyclic }) as Record<string, any>;
  assert.equal(scrubbed["danhSach"][0].password, "***");
  assert.equal(scrubbed["danhSach"][0].ma, "A1");
  assert.equal(scrubbed["long"].token, "***");
});

// ---- recording and replaying the tool box ------------------------------------------------------

test("recordingToolBox keeps the RAW value the landing returned, in order; replayToolBox gives it back", async () => {
  const calls: RecordedToolCall[] = [];
  const box = recordingToolBox({
    findStock: async (args) => ({ hoi: args["q"], ketQua: CATALOG.slice(0, 2) }),
    policy: async () => "đổi trả trong 7 ngày",
    bankAccount: async () => ({ nganHang: "VCB", so: "0123" })
  }, calls, clock);

  await box.findStock({ q: "boston" });
  await box.policy();
  await box.findStock({ q: "pegasus" });

  assert.deepEqual(calls.map((c) => c.ten), ["findStock", "policy", "findStock"]);
  assert.deepEqual(calls[0]!.args, { q: "boston" });
  assert.equal((calls[0]!.ketQua as { hoi: string }).hoi, "boston");
  assert.equal(calls[1]!.ketQua, "đổi trả trong 7 ngày");

  // A replay walks the same two findStock calls in the same order — not the first one twice.
  const replay = replayToolBox(calls);
  assert.equal((await replay.findStock({}) as { hoi: string }).hoi, "boston");
  assert.equal((await replay.findStock({}) as { hoi: string }).hoi, "pegasus");
  assert.equal(await replay.policy(), "đổi trả trong 7 ngày");
});

test("recordingToolBox records a tool that threw, and the replay throws the same way", async () => {
  const calls: RecordedToolCall[] = [];
  const box = recordingToolBox({
    findStock: async () => { throw new Error("landing 503"); },
    policy: async () => "",
    bankAccount: async () => ({})
  }, calls, clock);
  await assert.rejects(() => box.findStock({ q: "x" }), /landing 503/);
  assert.equal(calls[0]!.loi, "landing 503");
  await assert.rejects(() => replayToolBox(calls).findStock({}), /landing 503/);
});

// ---- classifying -------------------------------------------------------------------------------

test("a turn that went wrong is classed 'hong' and kept longer; a clean one is 'thuong'", () => {
  const base = {
    version: 1 as const, stt: 1, luc: "2026-09-21T09:00:00.000Z", shop: "toprun", maHoiThoai: "facebook:k1",
    nguoi: "k1", kenh: "facebook", duongDi: "agent" as const, ketCuc: "da-tra-loi" as const, msTong: 10,
    tinKhach: { chu: "alo", soAnh: 0, luc: "" }
  };
  assert.equal(retentionClass(base), "thuong");
  assert.equal(retentionClass({ ...base, ketCuc: "chuyen-nguoi-that" }), "hong");
  // Answered, but only after a reply was blocked: that is exactly the turn someone comes asking about.
  assert.equal(retentionClass({
    ...base,
    agent: { model: "m", goiNganh: "giay-chay", luot: {} as never, systemPrompt: "", traLoiModel: [], congCu: [], buoc: [{ step: 1, error: "chan: gia_khong_nguon: 1" }], soBuoc: 1 }
  }), "hong");
  assert.equal(indexRow(base, "0001-thuong.json").tin, "alo");
});

// ---- on disk, one folder per merchant ----------------------------------------------------------

test("safeName makes a conversation id usable as a folder on every platform, without collisions", () => {
  // ":" is illegal on Windows; two different ids must never share a folder.
  assert.ok(!safeName("facebook:k1").includes(":"));
  assert.notEqual(safeName("facebook:k1"), safeName("facebook_k1"));
  assert.equal(safeName("plain-id.1"), "plain-id.1");
});

test("DiskDossierStore: one folder per shop, a numbered file per turn, an index row for each", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ho-so-"));
  try {
    const store = new DiskDossierStore({ root, clock, logger: new MemoryLogger() });
    const base: TurnDossier = {
      version: 1, stt: 0, luc: "2026-09-21T09:00:00.000Z", shop: "toprun", maHoiThoai: "facebook:k1",
      nguoi: "k1", kenh: "facebook", duongDi: "agent", ketCuc: "da-tra-loi", msTong: 12,
      tinKhach: { chu: "đôi này còn không", soAnh: 0, luc: "" }
    };
    await store.write(base);
    await store.write({ ...base, ketCuc: "chuyen-nguoi-that", viSao: "chuyen_nguoi_that" });
    // A second merchant's evidence lives apart: one shop having a bad hour cannot push the other out.
    await store.write({ ...base, shop: "dasbui" });

    const rows = await store.readIndex("toprun");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.stt), [1, 2]);
    assert.equal(rows[0]!.tin, "đôi này còn không");
    assert.match(rows[0]!.tep, /0001-thuong\.json$/);
    assert.match(rows[1]!.tep, /0002-hong\.json$/);
    assert.equal((await store.readIndex("dasbui")).length, 1);

    const loaded = await store.load("toprun", rows[1]!.tep);
    assert.equal(loaded!.viSao, "chuyen_nguoi_that");
    assert.equal(loaded!.stt, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the sweep drops an ordinary dossier past its 7 days and keeps a broken one past them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ho-so-"));
  try {
    const store = new DiskDossierStore({ root, clock: { now: () => new Date() }, logger: new MemoryLogger() });
    const base: TurnDossier = {
      version: 1, stt: 0, luc: "2026-09-21T09:00:00.000Z", shop: "toprun", maHoiThoai: "c1",
      nguoi: "k1", kenh: "facebook", duongDi: "agent", ketCuc: "da-tra-loi", msTong: 1,
      tinKhach: { chu: "x", soAnh: 0, luc: "" }
    };
    await store.write(base);
    await store.write({ ...base, ketCuc: "hong" });

    // Age both by 10 days: past "thuong" (7), inside "hong" (30).
    const folder = store.folderFor("toprun", "c1");
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    for (const name of await fs.readdir(folder)) await fs.utimes(path.join(folder, name), old, old);

    assert.equal(await store.sweep(), 1);
    assert.deepEqual(await fs.readdir(folder), ["0002-hong.json"]);

    await store.forget("toprun");
    assert.equal((await fs.readdir(root)).includes("toprun"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ---- the whole point ---------------------------------------------------------------------------

test("a real turn is kept whole: the full tool result, every model answer, the blocked reply and why", async () => {
  const dossier = new MemoryDossierStore();
  const model = scriptedModel([
    "{\"tool\":\"tra_kho\",\"args\":{\"q\":\"boston 42\"}}",
    // A price no tool ever returned: `reviewReply` blocks it and the model is told to write again.
    "{\"reply\":\"Dạ đôi Boston size 42 giá 3.500.000đ ạ\"}",
    "{\"reply\":\"Dạ đôi Boston size 42 giá 3.290.000đ ạ\"}"
  ]);
  const { brain } = await licensedBrain(fakeLanding(THREAD).fetch, model, dossier);
  const result = await brain.handleInbound(MESSAGE);
  assert.equal((result as { daTraLoi: boolean }).daTraLoi, true);

  const d = dossier.last()!;
  assert.equal(d.shop, "toprun");
  assert.equal(d.maHoiThoai, "facebook:k1");
  assert.equal(d.duongDi, "agent");
  assert.equal(d.ketCuc, "da-tra-loi");
  assert.equal(d.tinKhach.chu, MESSAGE.chu);

  const agent = d.agent!;
  assert.equal(agent.model, "gia/mo-hinh-thu");
  assert.equal(agent.goiNganh, "giay-chay");
  // The RESOLVED prompt, not the pack's template: a pack edited next week must not rewrite this turn.
  assert.match(agent.systemPrompt, /shop\.vn/);
  assert.ok(!agent.systemPrompt.includes("{site}"));

  // Every answer the model gave, in order — a replay feeds these straight back.
  assert.equal(agent.traLoiModel.length, 3);
  assert.match(agent.traLoiModel[1]!, /3\.500\.000/);

  // The tool result is kept WHOLE. The old 400-character cut is what made a dossier unreplayable.
  const toolStep = agent.buoc.find((s) => s.tool === "tra_kho")!;
  assert.deepEqual(toolStep.args, { q: "boston 42" });
  assert.ok(toolStep.result!.length > 400, `tool result was cut to ${toolStep.result!.length} chars`);
  assert.match(toolStep.result!, /JP9261/);

  // Why the bot said what it said usually ends right here.
  const blockedStep = agent.buoc.find((s) => s.blocked !== undefined)!;
  assert.match(blockedStep.error!, /^chan: gia_khong_nguon: 3500000$/);
  assert.match(blockedStep.blocked!, /3\.500\.000/);

  // And the raw value the landing returned, for the replay.
  assert.deepEqual(agent.congCu.map((c) => c.ten), ["findStock"]);
  assert.equal((agent.congCu[0]!.ketQua as { ma: string }[])[0]!.ma, "JP9250");
});

test("DIEN LAI: the kept turn runs again from the dossier alone and reaches the same answer", async () => {
  const dossier = new MemoryDossierStore();
  const { brain } = await licensedBrain(fakeLanding(THREAD).fetch, scriptedModel([
    "{\"tool\":\"tra_kho\",\"args\":{\"q\":\"boston 42\"}}",
    "{\"reply\":\"Dạ đôi Boston size 42 giá 3.500.000đ ạ\"}",
    "{\"reply\":\"Dạ đôi Boston size 42 giá 3.290.000đ ạ\"}"
  ]), dossier);
  const original = await brain.handleInbound(MESSAGE) as { traLoi: string };
  const kept = dossier.last()!.agent!;

  // No landing, no gateway, no network: the turn as data, the recorded tool results, the recorded
  // model answers. This is what `chan-doan dien-lai` will do.
  const replayed = await new SalesAgent({
    model: scriptedModel([...kept.traLoiModel]), logger: new MemoryLogger(), clock, sleep: noSleep
  }).run({ ...kept.luot, tools: replayToolBox(kept.congCu) });

  assert.equal(replayed.ok, true);
  // The dossier keeps the agent's OWN reply; what went out passed the reply gate on top (stage 6), and
  // the outbound text is that gated one — here identical, since the price has its source in the tool result.
  assert.equal(replayed.ok && replayed.reply, kept.traLoi);
  assert.equal(original.traLoi, kept.traLoi);
  // Same shape too: the tool step, the block, the rewrite.
  assert.deepEqual(replayed.trace.map((s) => s.tool ?? s.error), kept.buoc.map((s) => s.tool ?? s.error));
});

// ---- replayTurn: the machine behind `chan-doan dien-lai` ---------------------------------------

/** A turn that called a tool, had a reply blocked, then answered — enough shape to compare. */
async function keptTurn(): Promise<TurnDossier> {
  const dossier = new MemoryDossierStore();
  const { brain } = await licensedBrain(fakeLanding(THREAD).fetch, scriptedModel([
    "{\"tool\":\"tra_kho\",\"args\":{\"q\":\"boston 42\"}}",
    "{\"reply\":\"Dạ đôi Boston size 42 giá 3.500.000đ ạ\"}",
    "{\"reply\":\"Dạ đôi Boston size 42 giá 3.290.000đ ạ\"}"
  ]), dossier);
  await brain.handleInbound(MESSAGE);
  return dossier.last()!;
}

/** The same turn, but the customer typed a phone number — what `dong-bai` has to deal with. */
async function keptTurnWithPhone(): Promise<TurnDossier> {
  const chu = "cho em hỏi đôi boston size 42, sdt em là 0912345678";
  const dossier = new MemoryDossierStore();
  const { brain } = await licensedBrain(fakeLanding([{ chieu: "den", boi: "khach", chu, soAnh: 0, luc: "2026-09-21T08:59:50.000Z" }]).fetch, scriptedModel([
    "{\"tool\":\"tra_kho\",\"args\":{\"q\":\"boston 42\"}}",
    "{\"reply\":\"Dạ đôi Boston size 42 giá 3.500.000đ ạ\"}",
    "{\"reply\":\"Dạ đôi Boston size 42 giá 3.290.000đ ạ\"}"
  ]), dossier);
  await brain.handleInbound({ ...MESSAGE, chu });
  return dossier.last()!;
}

test("replayTurn with the scripted model comes out identical — that is what says the dossier is honest", async () => {
  const result = await replayTurn(await keptTurn());
  assert.equal(result.giongNhau, true, result.khac.join("; "));
  assert.deepEqual(result.khac, []);
  assert.equal(result.dienLai.traLoi, result.goc.traLoi);
  assert.deepEqual(result.dienLai.buoc, result.goc.buoc);
  assert.match(result.goc.buoc.join(" "), /tra_kho/);
});

test("replayTurn tries another prompt on the same case — what `--pack` is for", async () => {
  const kept = await keptTurn();
  const profile = agentProfileOf("giay-chay");
  const tweaked = { ...profile, khoi: [...profile.khoi, { id: "thu", tieuDe: "Dang thu", shopSua: false, loiDan: "LUAT MOI DANG THU: luon xung \"em\"." }] };
  // Our own scripted model, so we can look at what it was actually shown.
  const model = scriptedChatModel([...kept.agent!.traLoiModel]);
  const result = await replayTurn(kept, { agent: tweaked, model });

  assert.match(model.seen[0]![0]!.content, /LUAT MOI DANG THU/);
  // The tool results are still the recorded ones: nothing reached out to a landing.
  assert.match(model.seen[1]![1]!.content, /KHACH: cho em hỏi đôi boston size 42/);
  assert.equal(result.giongNhau, true, "same answers scripted back = same turn, prompt aside");
});

test("agentProfileOf resolves a pack, and refuses one that has no agent", () => {
  assert.ok(agentProfileOf("giay-chay").khoi.length > 0);
  assert.throws(() => agentProfileOf("khong-co-goi-nay"));
});

test("a replay that asks the model MORE than the original turn did is reported, not crashed", async () => {
  const kept = await keptTurn();
  // Drop the last recorded answer: the replay reaches a step with nothing to say.
  const short: TurnDossier = { ...kept, agent: { ...kept.agent!, traLoiModel: kept.agent!.traLoiModel.slice(0, 1) } };
  const result = await replayTurn(short);
  assert.equal(result.giongNhau, false);
  assert.equal(result.dienLai.viSao, "het_cau_da_ghi");
  assert.ok(result.khac.some((k) => /câu trả lời khác|lý do khác/.test(k)));
});

test("replayTurn refuses a turn the agent never took (a scripted one, an engine one), and says why", async () => {
  const dossier = new MemoryDossierStore();
  const { brain } = await licensedBrain(fakeLanding(THREAD).fetch, scriptedModel([]), dossier);
  // Since 25/09/2026 a payment claim is the ROUTER's: a script, no agent half at all.
  await brain.handleInbound({ ...MESSAGE, chu: "em chuyển khoản rồi nha shop" });
  assert.equal(dossier.last()!.duongDi, "kich-ban");
  assert.equal(dossier.last()!.version, 2);
  assert.equal(dossier.last()!.router?.quyetDinh, "human_handoff");
  await assert.rejects(() => replayTurn(dossier.last()!), /kịch bản.*không có phần agent/);
});

// ---- cửa vào: tìm, đọc, đóng bài ---------------------------------------------------------------

test("tim matches without accents or case, over what the customer said AND what the bot answered", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ho-so-"));
  try {
    const store = new DiskDossierStore({ root, clock, logger: new MemoryLogger() });
    const base: TurnDossier = {
      version: 1, stt: 0, luc: "2026-09-21T09:00:00.000Z", shop: "toprun", maHoiThoai: "facebook:k1",
      nguoi: "k1", kenh: "facebook", duongDi: "agent", ketCuc: "da-tra-loi", msTong: 1,
      tinKhach: { chu: "đôi này còn không shop", soAnh: 0, luc: "" },
      agent: { model: "m", goiNganh: "giay-chay", luot: {} as never, systemPrompt: "", traLoiModel: [], congCu: [], buoc: [], soBuoc: 1, traLoi: "Dạ còn size 42 ạ" }
    };
    await store.write(base);
    await store.write({ ...base, maHoiThoai: "facebook:k2", tinKhach: { chu: "bao giờ giao hàng", soAnh: 0, luc: "" } });

    // Người tra gõ không dấu, như cách shop đọc qua điện thoại.
    assert.equal((await store.search({ text: "doi nay con khong" })).length, 1);
    assert.equal((await store.search({ text: "ĐÔI NÀY" })).length, 1);
    // Khớp cả câu bot trả.
    assert.equal((await store.search({ text: "size 42" }))[0]!.row.maHoiThoai, "facebook:k1");
    assert.equal((await store.search({ text: "không có chữ này" })).length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("gan-day narrows by hours and by 'only the ones that went wrong'", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ho-so-"));
  try {
    const now = new Date("2026-09-21T12:00:00.000Z");
    const store = new DiskDossierStore({ root, clock: { now: () => now }, logger: new MemoryLogger() });
    const base: TurnDossier = {
      version: 1, stt: 0, luc: "2026-09-21T11:30:00.000Z", shop: "toprun", maHoiThoai: "c-moi",
      nguoi: "k1", kenh: "facebook", duongDi: "agent", ketCuc: "da-tra-loi", msTong: 1,
      tinKhach: { chu: "mới", soAnh: 0, luc: "" }
    };
    await store.write(base);
    await store.write({ ...base, maHoiThoai: "c-cu", luc: "2026-09-20T11:30:00.000Z", tinKhach: { chu: "cũ", soAnh: 0, luc: "" } });
    await store.write({ ...base, maHoiThoai: "c-hong", ketCuc: "chuyen-nguoi-that", tinKhach: { chu: "hỏng", soAnh: 0, luc: "" } });

    assert.deepEqual((await store.search({ hours: 2 })).map((f) => f.row.tin).sort(), ["hỏng", "mới"]);
    assert.deepEqual((await store.search({ hours: 2, hong: true })).map((f) => f.row.tin), ["hỏng"]);
    // Newest first, so the eye lands on what just happened.
    assert.equal((await store.search({ limit: 1 }))[0]!.row.luc, "2026-09-21T11:30:00.000Z");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("tim --sau finds a phrase that only exists inside a tool result", async () => {
  const dossier = await keptTurn();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ho-so-"));
  try {
    const store = new DiskDossierStore({ root, clock, logger: new MemoryLogger() });
    await store.write(dossier);
    // "JP9261" never appears in the customer's message or the reply — only in what the tool returned.
    assert.equal((await store.search({ text: "JP9261" })).length, 0);
    assert.equal((await store.searchDeep({ text: "JP9261" })).length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("renderDossier tells the turn in the order the question is asked", async () => {
  const text = renderDossier(await keptTurn());
  assert.match(text, /KHÁCH NHẮN/);
  // Version 2: the router's decision is printed before the model's half; LLM#1 was off here.
  assert.match(text, /PHÂN TÍCH NGỮ CẢNH \(LLM#1\)[^\n]*\n\s+\(mô hình tắt/);
  assert.match(text, /BỘ ĐỊNH TUYẾN · agent_draft \(ask_size_needs_catalog\)/);
  // A version-1 dossier (no router, no analysis) still renders, with neither block.
  const old = renderDossier({ ...(await keptTurn()), version: 1, phanTich: undefined, router: undefined, nhap: undefined, ghiChu: undefined });
  assert.doesNotMatch(old, /BỘ ĐỊNH TUYẾN|PHÂN TÍCH NGỮ CẢNH/);
  assert.match(old, /ĐÃ GỬI KHÁCH/);
  assert.match(text, /LỊCH SỬ ĐƯA VÀO MODEL/);
  assert.match(text, /công cụ tra_kho/);
  assert.match(text, /✗ CHẶN: chan: gia_khong_nguon: 3500000/);
  assert.match(text, /câu bị chặn: .*3\.500\.000/);
  assert.match(text, /ĐÃ GỬI KHÁCH/);
  // A cut is announced, never silent: half a tool result must not read as the whole one.
  assert.match(text, /\+\d+ ký tự/);
  assert.ok(!renderDossier(await keptTurn(), { full: true }).includes("ký tự"), "nothing is cut with --day");
});

test("dong-bai: personal data becomes a STABLE stand-in, and the case still reproduces", async () => {
  const dossier = await keptTurnWithPhone();
  assert.match(JSON.stringify(dossier), /0912345678/, "the dossier itself keeps the real number");

  const file = await makeCase(dossier, { ten: "Đôi này còn không", ghiChu: "giá bịa bị chặn" });
  const raw = JSON.stringify(file);
  assert.ok(!raw.includes("0912345678"), "the case file does not carry the real number");
  // STABLE, not masked: the same number is the same stand-in everywhere, or the case stops working.
  const stands = [...raw.matchAll(/SDT-[a-z]{6}/g)].map((m) => m[0]);
  assert.ok(stands.length >= 2, `expected the number in at least two places, saw ${stands.length}`);
  assert.equal(new Set(stands).size, 1);
  // Letters only: a six-digit stand-in would read as a price to the reply reviewer.
  assert.ok(!/SDT-\d/.test(raw));

  assert.equal(file.ten, "doi-nay-con-khong");
  assert.equal(file.nguon.maHoiThoai, "facebook:k1");
  assert.equal((await runCase(file)).dat, true);
});

test("dong-bai refuses a turn it cannot cut: a case born failing is worse than none", async () => {
  const dossier = new MemoryDossierStore();
  const { brain } = await licensedBrain(fakeLanding(THREAD).fetch, scriptedModel([]), dossier);
  await brain.handleInbound({ ...MESSAGE, chu: "em chuyển khoản rồi nha shop" });
  await assert.rejects(() => makeCase(dossier.last()!), CaseNotReproducible);

  // And one whose recorded answers no longer produce the recorded reply.
  const broken = await keptTurn();
  broken.agent!.traLoi = "một câu chưa bao giờ được gửi";
  await assert.rejects(() => makeCase(broken), CaseNotReproducible);
});

test("runCase reports a regression instead of throwing, so the test can name the case", async () => {
  const file = await makeCase(await keptTurn());
  const drifted: typeof file = { ...file, mongDoi: { ...file.mongDoi, traLoi: "câu khác hẳn" } };
  const outcome = await runCase(drifted);
  assert.equal(outcome.dat, false);
  assert.ok(outcome.khac.some((k) => /mong đợi/.test(k)));
});

test("the store finds every turn of a conversation, oldest first, without being told the shop", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ho-so-"));
  try {
    const store = new DiskDossierStore({ root, clock, logger: new MemoryLogger() });
    const base: TurnDossier = {
      version: 1, stt: 0, luc: "2026-09-21T09:00:00.000Z", shop: "toprun", maHoiThoai: "facebook:k1",
      nguoi: "k1", kenh: "facebook", duongDi: "agent", ketCuc: "da-tra-loi", msTong: 1,
      tinKhach: { chu: "một", soAnh: 0, luc: "" }
    };
    await store.write(base);
    await store.write({ ...base, luc: "2026-09-21T09:05:00.000Z", tinKhach: { chu: "hai", soAnh: 0, luc: "" } });
    await store.write({ ...base, shop: "dasbui", maHoiThoai: "facebook:zz" });

    assert.deepEqual(await store.listShops(), ["dasbui", "toprun"]);
    const found = await store.findByConversation("facebook:k1");
    assert.deepEqual(found.map((f) => f.row.tin), ["một", "hai"]);
    assert.deepEqual(found.map((f) => f.shop), ["toprun", "toprun"]);
    assert.equal((await store.findByConversation("facebook:k1", "dasbui")).length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a turn the agent could not finish is still kept, with the reason", async () => {
  const dossier = new MemoryDossierStore();
  // The model answers nothing usable: the agent gives up and the rule engine takes the turn.
  const { brain } = await licensedBrain(fakeLanding(THREAD).fetch, scriptedModel([]), dossier);
  await brain.handleInbound(MESSAGE);

  const d = dossier.last()!;
  // `duongDi` names who produced the REPLY; that the agent tried and failed is told by its half
  // being there, with the reason. One message, one dossier, both halves in it.
  assert.equal(d.duongDi, "may-luat");
  assert.equal(d.agent!.traLoi, undefined);
  assert.ok(d.agent!.viSao !== undefined && d.agent!.viSao !== "");
  assert.ok(d.mayLuat !== undefined, "the rule engine's half was recorded too");
  assert.equal(retentionClass(d), "hong");
});

test("the rule engine's half keeps the state going in and out — the landing's copy blanks the customer", async () => {
  const dossier = new MemoryDossierStore();
  // A model with nothing scripted fails, so the turn falls to the rule engine. (It used to be driven
  // with "em chuyển khoản rồi nha shop"; since 21/09/2026 that message is handed to a PERSON and the
  // engine never runs, so it no longer shows the engine's half at all.)
  // ("chào shop" is a router SCRIPT since 25/09/2026 and never reaches the engine; a stock question does.)
  const { brain } = await licensedBrain(fakeLanding(THREAD).fetch, scriptedModel([]), dossier);
  await brain.handleInbound(MESSAGE);

  const d = dossier.last()!;
  assert.equal(d.duongDi, "may-luat");
  assert.equal(d.tinKhach.chu, MESSAGE.chu);
  assert.equal(d.router?.quyetDinh, "agent_draft", "the router handed the turn to the agent, which failed");
  const rules = d.mayLuat!;
  assert.equal(rules.trangThaiVao, null, "no state yet on the first turn");
  assert.ok(rules.trangThaiRa !== null, "the state written after the turn is kept");
  assert.equal(typeof rules.hanhDong, "string");
});

test("no store configured = nothing is written and nothing is built", async () => {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop.vn" });
  const logger = new MemoryLogger();
  const brain = new BrainService({
    license, fetch: fakeLanding(THREAD).fetch, logger, clock, sleep: noSleep,
    agent: new SalesAgent({ model: scriptedModel(["{\"reply\":\"Dạ em nghe bác ạ.\"}"]), logger, clock, sleep: noSleep })
  });
  const result = await brain.handleInbound(MESSAGE);
  assert.equal((result as { daTraLoi: boolean }).daTraLoi, true);
  assert.ok(!logger.warnings.some((m) => /ho-so/.test(m)), "the dossier path is silent when it is off");
});
