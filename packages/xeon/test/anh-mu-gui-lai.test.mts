/**
 * 05/10/2026 — phiếu Desk 2026-09-08 "kết quả phân tích của một lượt MÙ ẢNH được dùng lại và tự gửi" (bước 1–2, kênh gửi).
 *
 * Nguyên tắc chung: một tin chỉ được coi là "đã phân tích" khi lượt đó THẬT SỰ đọc đủ bằng chứng của tin (mọi ảnh
 * của tin được một mô hình đọc); bằng chứng gửi kèm câu trả lời chỉ đếm ảnh đọc được; câu soạn xong mà không gửi
 * được thì lượt được chạy lại (một lần), không coi là đã trả lời.
 *
 * OMI chỉ có MỘT đường lượt (Xeon `TurnPipeline`) cho cửa thật, nháp người trực và Soạn bot — không có nơi thứ hai
 * phân tích cùng tin rồi chia kết quả; "bộ nhớ đã phân tích" của OMI là nhãn ảnh theo mã tin (`imageLabels`).
 * Tầng 1: ngành giả (nhà thuốc).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import { AiDeskService, BrainService, LicenseLedger, LicenseService, MemoryLogger, generateSigningKey, type ChatMessage, type ChatModelPort, type FetchLike } from "@sp/xeon";

const T0 = Date.parse("2026-10-05T09:00:00.000Z");
const clock = { now: () => new Date(T0) };
const ago = (minutes: number): string => new Date(T0 - minutes * 60_000).toISOString();
const noSleep = async (): Promise<void> => undefined;
const OK_PHOTO = "https://scontent.test/doc-duoc.jpg";
const BAD_PHOTO = "https://scontent.test/hong.jpg";

interface Line { chieu: "den" | "di"; boi: string; chu: string; soAnh: number; luc: string; maTin?: string; anh?: string[] }
interface Call { path: string; method: string; body: Record<string, unknown> | null }

/** A vision model that reads one picture and fails on the other. */
function visionModel(): ChatModelPort & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen, ready: () => true,
    complete: async (messages: ChatMessage[]) => {
      const image = String(messages.flatMap((m) => m.images ?? [])[0] ?? "");
      seen.push(image);
      if (image === BAD_PHOTO) return { ok: false, viSao: "het_gio", transient: true };
      return { ok: true, text: JSON.stringify({ loai: "san_pham", brand: "", model: "", color: "", code: "", amount: 0, orderCode: "", text: "", confidence: 0.4 }), model: "gia" };
    }
  };
}

function fakeLanding(o: { thread: Line[]; failSend?: boolean; takeover?: { tiepQuan: boolean; viSao: string } }) {
  const calls: Call[] = [];
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "catalog.find", "conversation.recent"];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, method: String(init.method ?? "GET"), body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: o.thread, hoiThoai: { daChaoAi: true, dienThoaiDaCho: false, theDaGui: [] } } });
      if (tool === "catalog.find") return reply({ ok: true, data: { ketQua: [] } });
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 50 } });
      return reply({ ok: true, data: { items: [], rows: [], truncated: false, asOf: "" } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: null });
    if (u.pathname === "/api/hop-thu/gui") return o.failSend === true ? reply({ ok: false, error: "meta_tu_choi", message: "(#200) Permissions error" }, 502) : reply({ ok: true, guiNgay: true });
    if (u.pathname === "/api/hop-thu/tiep-quan") return reply({ ok: true, ...(o.takeover ?? { tiepQuan: true, viSao: "" }) });
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  const saved = () => calls.filter((c) => c.path.startsWith("/api/bo-nao/tri-nho/") && c.method === "PUT").map((c) => (c.body!["trangThai"] ?? {}) as { imageLabels?: Record<string, string> });
  return { fetch, calls, saved, sent: () => calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => c.body!), takeovers: () => calls.filter((c) => c.path === "/api/hop-thu/tiep-quan").length };
}

/** A manual clock for the retry: `run()` fires what is pending. */
function manualTimer() {
  const pending: { run: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    pending,
    timer: (run: () => void, ms: number) => { const t = { run, ms, cancelled: false }; pending.push(t); return () => { t.cancelled = true; }; },
    fire: async () => { for (const t of pending.splice(0)) if (!t.cancelled) t.run(); await new Promise((r) => setTimeout(r, 20)); }
  };
}

function scriptedModel(answers: string[]): ChatModelPort {
  return { ready: () => true, complete: async () => { const next = answers.shift(); return next === undefined ? { ok: false, viSao: "het", transient: false } : { ok: true, text: next, model: "gia" }; } };
}
const ANALYSIS = JSON.stringify({
  intent: "send_image", confidence: 0.9, entities: {}, needProfile: { buyerType: "", experience: "", insistOnProduct: false }, needBrief: {},
  focus: { product: "", products: [], changed: false, reason: "", roles: [] }, contextSummary: "", episodeSummary: "", customerGoal: "",
  referencesPreviousMessage: false, missingInformation: [], lookupCommands: [], riskFlags: []
});
/** LLM#1 + LLM#3 that answer: the turn goes the model road (`deliver`), where the photo label is written. */
const writers = () => ({ analyzer: scriptedModel([ANALYSIS]), writer: scriptedModel(["{\"reply\":\"Dạ để em kiểm tra ạ\",\"needsHuman\":false}"]) });

async function brainFor(landing: { fetch: FetchLike }, opts: { vision?: ChatModelPort; timer?: ReturnType<typeof manualTimer>; analyzer?: ChatModelPort; writer?: ChatModelPort } = {}) {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "shop-gia", tenShop: "Shop Giả", nganh: "nha-thuoc", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop-gia.vn" });
  const logger = new MemoryLogger();
  const { ContextAnalyzer, DraftWriter } = await import("@sp/xeon");
  const brain = new BrainService({
    license, fetch: landing.fetch, logger, clock, sleep: noSleep, ...(opts.vision ? { vision: opts.vision } : {}), ...(opts.timer ? { timer: opts.timer.timer } : {}),
    analyzer: opts.analyzer ? new ContextAnalyzer({ model: opts.analyzer, logger }) : null,
    writer: opts.writer ? new DraftWriter({ model: opts.writer, logger }) : null
  });
  return { brain, logger };
}

const MSG = (over: Record<string, unknown> = {}) => ({ tenant: "shop-gia", kenh: "facebook", nguoi: "k1", chu: "có loại này không", maHoiThoai: "facebook:k1", maTin: "m_q", luc: ago(0.2), ...over });

test("tin có 2 ảnh, mô hình chỉ đọc được 1 → tin KHÔNG bị đánh dấu đã đọc (lượt sau đọc lại), bằng chứng gửi kèm đếm 1 ảnh", async () => {
  const thread: Line[] = [
    { maTin: "m_anh", chieu: "den", boi: "khach", chu: "", soAnh: 2, luc: ago(1), anh: [OK_PHOTO, BAD_PHOTO] },
    { maTin: "m_q", chieu: "den", boi: "khach", chu: "có loại này không", soAnh: 0, luc: ago(0.2) }
  ];
  const landing = fakeLanding({ thread });
  const { brain } = await brainFor(landing, { vision: visionModel(), ...writers() });
  await brain.handleInbound(MSG());
  assert.ok(landing.saved().some((s) => s.imageLabels !== undefined), "the model road ran and saved its memory");
  const labels = landing.saved().at(-1)?.imageLabels ?? {};
  assert.equal(labels["m_anh"], undefined, "a message one of whose photos was never read is not 'already analysed'");
  const evidence = landing.sent().at(-1)?.["bangChung"] as { soAnh: number } | undefined;
  assert.equal(evidence?.soAnh, 1, "only the photo a model read counts as evidence");
});

test("tin 1 ảnh đọc được → được đánh dấu (lượt sau không đọc lại, đỡ tốn lượt mô hình)", async () => {
  const thread: Line[] = [
    { maTin: "m_anh", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(1), anh: [OK_PHOTO] },
    { maTin: "m_q", chieu: "den", boi: "khach", chu: "có loại này không", soAnh: 0, luc: ago(0.2) }
  ];
  const landing = fakeLanding({ thread });
  const vision = visionModel();
  const { brain } = await brainFor(landing, { vision, ...writers() });
  await brain.handleInbound(MSG());
  const labels = landing.saved().at(-1)?.imageLabels ?? {};
  assert.ok((labels["m_anh"] ?? "") !== "", JSON.stringify(labels));
});

test("ảnh tới muộn (chùm ảnh mới sau tin đã đọc) → ảnh mới được đọc, không dùng lại kết quả cũ", async () => {
  const thread: Line[] = [
    { maTin: "m_anh1", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(3), anh: [OK_PHOTO] },
    { maTin: "m_anh2", chieu: "den", boi: "khach", chu: "", soAnh: 2, luc: ago(1), anh: ["https://scontent.test/moi-1.jpg", "https://scontent.test/moi-2.jpg"] },
    { maTin: "m_q", chieu: "den", boi: "khach", chu: "có loại này không", soAnh: 0, luc: ago(0.2) }
  ];
  const landing = fakeLanding({ thread });
  const vision = visionModel();
  const { brain } = await brainFor(landing, { vision });
  // m_anh1 was read by an earlier turn (labelled); the newer photos were not.
  const memory = { tenant: "shop-gia", conversationId: "facebook:k1", turns: [], imageLabels: { m_anh1: "[ảnh: chưa nhận ra]" } };
  const fetch = landing.fetch;
  const wrapped: FetchLike = async (url, init) => (new URL(url).pathname.startsWith("/api/bo-nao/tri-nho/") && (init.method ?? "GET") === "GET"
    ? { ok: true, status: 200, json: async () => ({ ok: true, trangThai: memory }) } : fetch(url, init));
  const { brain: brain2 } = await brainFor({ fetch: wrapped }, { vision });
  void brain;
  await brain2.handleInbound(MSG());
  assert.ok(vision.seen.includes("https://scontent.test/moi-1.jpg") && vision.seen.includes("https://scontent.test/moi-2.jpg"), vision.seen.join(","));
});

test("nháp tại chỗ (Soạn bot / nháp tự soạn) khi khách vừa gửi chùm ảnh → lượt nháp đọc đủ ảnh chùm, không [] ", async () => {
  const thread: Line[] = [
    { maTin: "a1", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(2), anh: ["https://scontent.test/c1.jpg"] },
    { maTin: "a2", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(1.5), anh: ["https://scontent.test/c2.jpg"] },
    { maTin: "a3", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(1), anh: ["https://scontent.test/c3.jpg"] },
    { maTin: "m_q", chieu: "den", boi: "khach", chu: "mấy cái này còn không", soAnh: 0, luc: ago(0.2) }
  ];
  const landing = fakeLanding({ thread });
  const vision = visionModel();
  const { brain } = await brainFor(landing, { vision });
  const desk = new AiDeskService({ brain, model: vision, clock, logger: new MemoryLogger() });
  const out = await desk.draft({ tenant: "shop-gia", maHoiThoai: "facebook:k1", kenh: "facebook", cheDo: "auto", nguon: "nguoi" });
  assert.ok(out.ok);
  for (const u of ["c1", "c2", "c3"]) assert.ok(vision.seen.includes(`https://scontent.test/${u}.jpg`), `${u}: ${vision.seen.join(",")}`);
  assert.equal(landing.sent().length, 0, "a draft never sends");
});

test("câu soạn xong mà landing gửi HỎNG (Meta lỗi quyền) → lượt được chạy lại MỘT lần sau một phút; hỏng lần hai thì thôi", async () => {
  const thread: Line[] = [{ maTin: "m_q", chieu: "den", boi: "khach", chu: "shop ơi còn hàng không", soAnh: 0, luc: ago(0.2) }];
  const landing = fakeLanding({ thread, failSend: true });
  const timer = manualTimer();
  const { brain } = await brainFor(landing, { timer });
  await assert.rejects(brain.handleInbound(MSG({ chu: "shop ơi còn hàng không" })));
  assert.equal(timer.pending.length, 1, "one retry scheduled");
  assert.equal(timer.pending[0]!.ms, 60_000);
  await timer.fire();
  assert.equal(landing.takeovers(), 1, "the landing is asked to hand the turn back");
  // The landing re-pushed the same message; it fails again → no second retry.
  await assert.rejects(brain.handleInbound(MSG({ chu: "shop ơi còn hàng không" })));
  assert.equal(timer.pending.length, 0, "the same message is not retried twice");
});

test("gửi hỏng rồi KHÁCH nhắn tiếp trước khi tới giờ chạy lại → bỏ lần chạy lại (tin mới có lượt riêng)", async () => {
  const thread: Line[] = [{ maTin: "m_q", chieu: "den", boi: "khach", chu: "còn hàng không", soAnh: 0, luc: ago(0.2) }];
  const landing = fakeLanding({ thread, failSend: true });
  const timer = manualTimer();
  const { brain } = await brainFor(landing, { timer });
  await assert.rejects(brain.handleInbound(MSG({ chu: "còn hàng không" })));
  assert.equal(timer.pending.length, 1);
  await brain.handleInbound(MSG({ chu: "alo", maTin: "m_2" })).catch(() => undefined);
  assert.ok(timer.pending[0]!.cancelled, "a new customer message cancels the pending retry");
});
