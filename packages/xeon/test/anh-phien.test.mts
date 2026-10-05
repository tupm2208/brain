/**
 * 05/10/2026 — bốn phiếu Desk nhóm ẢNH + NGỮ CẢNH PHIÊN (bước 1 nền lượt, 2 đọc ảnh, 4–5 định tuyến / sự thật):
 *   - "ảnh lượt này mượn dữ liệu ngoài phiên": ảnh chưa nhận ra / phiên mới thì "đôi này" KHÔNG phải mẫu của
 *     phiên trước — khung hội thoại, mã LLM#1 điền, tiêu điểm LLM#1 trỏ vào sổ đều chỉ tính khi PHIÊN NÀY nhắc;
 *   - "ảnh ngoài lượt và sticker": ảnh cũ hơn cửa sổ tươi không phải "ảnh khách vừa gửi" (hồ sơ ghi số ảnh bỏ);
 *   - "vai trò ảnh": page vừa xin xem món khách ĐANG DÙNG → ảnh là tham chiếu; ảnh đã khớp + câu hỏi thật thì
 *     không mang gợi ý "ảnh chưa rõ"; ảnh khớp chắc thì danh sách size kèm bậc giá, nấc gần size hỏi đứng trước;
 *   - "khách gửi ảnh rồi hỏi, bot vẫn xin ảnh": bằng chứng ảnh đọc từ LỊCH SỬ tin (không chỉ bộ nhớ), cổng soát
 *     sửa câu xin lại ảnh.
 * MỘT định nghĩa phiên / tuổi ảnh (`conversation-state.ts`) cho mọi luật.
 *
 * Tầng 1 thử bằng ngành NHÀ THUỐC (không giày, không hãng); tầng 2 nạp gói `giay-chay` thật.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import {
  BrainService, ImageIntake, LicenseLedger, LicenseService, MemoryDossierStore, MemoryLogger, TurnContextBuilder, generateSigningKey,
  type ChatMessage, type ChatModelPort, type FetchLike
} from "@sp/xeon";
import { PHOTO_FRESH_MS, ReplyGate, loadDialogueConfig, loadLedgerTexts, loadReplyGateConfig, sessionStartIndex, turnAnchorMs, photoIsFresh } from "@sp/brain";

const T0 = Date.parse("2026-10-05T09:00:00.000Z");
const clock = { now: () => new Date(T0) };
const ago = (minutes: number): string => new Date(T0 - minutes * 60_000).toISOString();
const daysAgo = (days: number): string => new Date(T0 - days * 86_400_000).toISOString();
const noSleep = async (): Promise<void> => undefined;
const PHOTO = "https://scontent.test/khach.jpg";

interface Line { chieu: "den" | "di"; boi: string; chu: string; soAnh: number; luc: string; maTin?: string; anh?: string[] }
interface Call { path: string; body: Record<string, unknown> | null }

function scriptedModel(answers: string[]): ChatModelPort & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen, ready: () => true,
    complete: async (messages) => { seen.push(messages.map((m) => ({ ...m }))); const next = answers.shift(); return next === undefined ? { ok: false, viSao: "het", transient: false } : { ok: true, text: next, model: "gia" }; }
  };
}

function fakeLanding(o: { thread: Line[]; state?: unknown; found?: unknown[]; khopAnh?: unknown }) {
  const calls: Call[] = [];
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "catalog.find", "conversation.recent", ...(o.khopAnh !== undefined ? ["catalog.matchImage"] : [])];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: o.thread, hoiThoai: { daChaoAi: true, dienThoaiDaCho: false, theDaGui: [] } } });
      if (tool === "catalog.find") return reply({ ok: true, data: { ketQua: o.found ?? [] } });
      if (tool === "catalog.matchImage") return reply({ ok: true, data: o.khopAnh });
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 50 } });
      return reply({ ok: true, data: { items: [], rows: [], truncated: false, asOf: "" } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: init.method === "GET" ? (o.state ?? null) : null });
    if (u.pathname === "/api/hop-thu/gui") return reply({ ok: true, guiNgay: true });
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  return {
    fetch, calls,
    sent: () => calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => String(c.body!["chu"])),
    lookups: () => calls.filter((c) => c.path === "/api/bo-nao/cong-cu" && c.body !== null && String(c.body["ten"]).startsWith("catalog.")).map((c) => JSON.stringify(c.body!["input"] ?? {}))
  };
}

async function brainFor(landing: { fetch: FetchLike }, nganh: string, models: { analyzer?: ChatModelPort; agent?: ChatModelPort; writer?: ChatModelPort; vision?: ChatModelPort } = {}) {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "shop-gia", tenShop: "Shop Giả", nganh, manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop-gia.vn" });
  const logger = new MemoryLogger();
  const dossier = new MemoryDossierStore();
  const { ContextAnalyzer, SalesAgent, DraftWriter } = await import("@sp/xeon");
  const brain = new BrainService({
    license, fetch: landing.fetch, logger, clock, sleep: noSleep, dossier,
    analyzer: models.analyzer ? new ContextAnalyzer({ model: models.analyzer, logger }) : null,
    agent: models.agent ? new SalesAgent({ model: models.agent, logger, clock, sleep: noSleep }) : undefined,
    writer: models.writer ? new DraftWriter({ model: models.writer, logger }) : null,
    ...(models.vision ? { vision: models.vision } : {})
  });
  return { brain, dossier };
}

const analysis = (over: Record<string, unknown> = {}): string => JSON.stringify({
  intent: "ask_price", confidence: 0.9, entities: {}, needProfile: { buyerType: "", experience: "", insistOnProduct: false }, needBrief: {},
  focus: { product: "", products: [], changed: false, reason: "", roles: [] }, contextSummary: "", episodeSummary: "", customerGoal: "",
  referencesPreviousMessage: false, missingInformation: [], lookupCommands: [], riskFlags: [], ...over
});

const OLD = daysAgo(13);
/** Thirteen days ago the page listed two items; the memory still holds them. */
const OLD_STATE = (over: Record<string, unknown> = {}) => ({
  tenant: "shop-gia", conversationId: "facebook:k1", turns: [],
  ledger: { products: [{ code: "TH0123", name: "Siro ho thảo dược A", brand: "", source: "page_goi_y", firstAt: OLD, lastAt: OLD, askedSizes: [], status: "hoi_gia" }], orders: [], aiSummaries: [], openThread: "", customerGoal: "", updatedAt: OLD },
  ...over
});
const OLD_LINES: Line[] = [
  { chieu: "den", boi: "khach", chu: "có siro ho cho bé không", soAnh: 0, luc: OLD },
  { chieu: "di", boi: "bo-nao", chu: "Dạ bên em có Siro ho thảo dược A (TH0123) https://shop-gia.vn/?p=TH0123 ạ", soAnh: 0, luc: OLD }
];
const PHOTO_TURN = (chu: string): Line => ({ maTin: "m_now", chieu: "den", boi: "khach", chu, soAnh: 1, luc: ago(0.2), anh: [PHOTO] });
const MSG = (chu: string, photo = true) => ({ tenant: "shop-gia", kenh: "facebook", nguoi: "k1", chu, maHoiThoai: "facebook:k1", maTin: "m_now", luc: ago(0.2), ...(photo ? { soAnh: 1, anh: [PHOTO] } : {}) });

// ---------------------------------------------------------------- MỘT định nghĩa phiên / tuổi ảnh

test("tầng 1: phiên = sau khoảng lặng 6 giờ cuối; mốc lượt = giờ tin khách (không lùi về tin page cũ); ảnh tươi = 15 phút", () => {
  assert.equal(sessionStartIndex([OLD, OLD, ago(1), ago(0)]), 2);
  assert.equal(sessionStartIndex([ago(30), undefined, ago(0)]), 0, "a line without a time never cuts");
  assert.equal(turnAnchorMs(ago(20), ago(0), T0), T0 - 20 * 60_000, "a draft made later measures from the customer's message");
  assert.equal(turnAnchorMs(undefined, undefined, T0), T0);
  assert.equal(turnAnchorMs("", OLD, T0), Date.parse(OLD), "no time on the message: the newest line, never an older one");
  assert.ok(photoIsFresh(ago(14), T0) && !photoIsFresh(ago(20), T0) && photoIsFresh(undefined, T0));
  assert.equal(PHOTO_FRESH_MS, 15 * 60_000);
});

// ---------------------------------------------------------------- bước 1: nền lượt

const builderFor = (nganh: string) => new TurnContextBuilder({ dialogue: loadDialogueConfig(nganh), ledgerTexts: loadLedgerTexts(), brands: [] });

test("tầng 1 (nhà thuốc): ảnh của chùm tin 14 phút trước là ảnh lượt này; 20 phút là lịch sử — hồ sơ đếm ảnh bỏ, không còn bằng chứng ảnh", () => {
  const b = builderFor("nha-thuoc");
  const build = (photoAgo: number) => b.build({
    tenant: "shop-gia", conversationId: "facebook:k1", now: new Date(T0),
    message: { maTin: "m2", chu: "loại này còn không", luc: ago(0) }, state: null,
    recent: { tin: [{ maTin: "m1", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(photoAgo), anh: [PHOTO] }, { maTin: "m2", chieu: "den", boi: "khach", chu: "loại này còn không", soAnh: 0, luc: ago(0) }] }
  });
  const fresh = build(14);
  assert.deepEqual(fresh.photos.map((p) => p.url), [PHOTO]);
  assert.equal(fresh.photoEvidence, true);
  assert.equal(fresh.stalePhotos, 0);
  const stale = build(20);
  assert.equal(stale.photos.length, 0, "twenty minutes old: not 'the photo the customer just sent'");
  assert.equal(stale.stalePhotos, 1, "the dossier says a photo was left out as too old");
  assert.equal(stale.photoEvidence, false);
});

test("tầng 1 (nhà thuốc): ảnh đã đọc (có nhãn) 5 phút trước không đọc lại, nhưng VẪN là bằng chứng khách đã gửi ảnh — bộ nhớ trống (nháp) cũng vậy", () => {
  const ctx = builderFor("nha-thuoc").build({
    tenant: "shop-gia", conversationId: "facebook:k1", now: new Date(T0 + 20 * 60_000),
    message: { maTin: "m3", chu: "shop có siro ho cho bé loại 100ml không", luc: ago(0) },
    state: { tenant: "shop-gia" as never, conversationId: "facebook:k1" as never, turns: [], imageLabels: { m1: "[ảnh: đoán là siro ho — chưa xác nhận]" } },
    recent: { tin: [
      { maTin: "m1", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(5), anh: [PHOTO] },
      { maTin: "m2", chieu: "di", boi: "bo-nao", chu: "Dạ anh chị cần tìm loại nào ạ?", soAnh: 0, luc: ago(4) },
      { maTin: "m3", chieu: "den", boi: "khach", chu: "shop có siro ho cho bé loại 100ml không", soAnh: 0, luc: ago(0) }
    ] }
  });
  assert.equal(ctx.photos.length, 0);
  assert.equal(ctx.photoEvidence, true, "measured from the customer's message, not from a draft made twenty minutes later");
  assert.equal(ctx.anchorAt, ago(0));
});

test("tầng 1 (nhà thuốc): tin page của PHIÊN TRƯỚC không làm khung hội thoại — không 'page vừa gửi mẫu', không mã cũ; cùng phiên thì có", () => {
  const b = builderFor("nha-thuoc");
  const lexicon = { products: [{ code: "TH0123", name: "Siro ho thảo dược A" }] };
  const old = b.build({ tenant: "shop-gia", conversationId: "facebook:k1", now: new Date(T0), message: { maTin: "m_now", chu: "cái này còn không", luc: ago(0.2) }, state: null, lexicon, recent: { tin: [...OLD_LINES, PHOTO_TURN("cái này còn không")] } });
  assert.equal(old.frame, null, "a page line thirteen days old is not what the page JUST said");
  assert.equal(old.sessionStartAt, ago(0.2));
  const same = b.build({ tenant: "shop-gia", conversationId: "facebook:k1", now: new Date(T0), message: { maTin: "m_now", chu: "cái này còn không", luc: ago(0.2) }, state: null, lexicon, recent: { tin: [{ ...OLD_LINES[0]!, luc: ago(9) }, { ...OLD_LINES[1]!, luc: ago(7) }, PHOTO_TURN("cái này còn không")] } });
  assert.equal(same.frame?.productCode, "TH0123", "the page's card of seven minutes ago is still the frame");
});

test("tầng 2 (giày): page vừa xin xem đôi ĐANG ĐI / tem / số cm → khung đánh dấu ảnh tiếp theo là THAM CHIẾU; câu hỏi khác thì không; nhà thuốc không có từ vựng đó", () => {
  const frameOf = (nganh: string, pageText: string) => builderFor(nganh).build({
    tenant: "shop", conversationId: "facebook:k1", now: new Date(T0), message: { maTin: "m2", chu: "", soAnh: 1, anh: [PHOTO], luc: ago(0) }, state: null,
    recent: { tin: [{ maTin: "m1", chieu: "di", boi: "Minh", chu: pageText, soAnh: 0, luc: ago(2) }, { maTin: "m2", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(0), anh: [PHOTO] }] }
  }).frame;
  assert.equal(frameOf("giay-chay", "Dạ đôi đang đi tem ghi bao nhiêu cm ạ")?.asksReference, true);
  assert.equal(frameOf("giay-chay", "Bác đang đi đôi nào để em canh size ạ")?.asksReference, true);
  assert.equal(frameOf("giay-chay", "Dạ bác cần tìm mẫu nào ạ?")?.asksReference, undefined);
  assert.equal(frameOf("nha-thuoc", "Dạ đôi đang đi tem ghi bao nhiêu cm ạ")?.asksReference, undefined, "tier 1 holds no reference words: which item is a reference is the industry's call");
});

// ---------------------------------------------------------------- bước 2: đọc ảnh

test("tầng 1: ảnh gửi kèm tin khách vẫn được đọc khi nháp soạn 20 phút sau (đo theo giờ tin khách, không theo đồng hồ)", async () => {
  const later = { now: () => new Date(T0 + 20 * 60_000) };
  const vision = scriptedModel(["{\"loai\":\"san_pham\",\"brand\":\"\",\"model\":\"Bình gốm men lam\",\"color\":\"lam\",\"code\":\"\",\"confidence\":0.6}"]);
  const intake = new ImageIntake({ vision, fetcher: null, logger: { info: () => undefined, warn: () => undefined } as never, clock: later });
  const binding = { gateway: { tools: { available: () => [], call: async () => ({ ok: false, error: { message: "khong" } }) } } } as never;
  const text = { heThong: "doc anh", huongDan: [], nhan: {} } as never;
  assert.equal(await intake.read({ tenant: "t", binding, photos: [{ url: PHOTO, at: ago(1) }], conversationId: "c", text }), null, "by the clock alone the photo looks twenty minutes old");
  const read = await intake.read({ tenant: "t", binding, photos: [{ url: PHOTO, at: ago(1) }], conversationId: "c", text, asOf: ago(0) });
  assert.ok(read !== null && read.read.model === "Bình gốm men lam");
});

// ---------------------------------------------------------------- bước 4–5: mẫu ngoài phiên

test("tầng 1 (nhà thuốc): ảnh chưa nhận ra, phiên mới — mã LLM#1 điền từ tin 13 ngày trước bị vứt, tiêu điểm LLM#1 trỏ vào sổ cũ không tra; khách tự gõ mã thì giữ", async () => {
  for (const over of [{ entities: { productCode: "TH0123" } }, { focus: { product: "TH0123", products: ["TH0123"], changed: true, reason: "", roles: [] } }]) {
    const landing = fakeLanding({ thread: [...OLD_LINES, PHOTO_TURN("loại này còn không")], state: OLD_STATE() });
    const { brain, dossier } = await brainFor(landing, "nha-thuoc", { analyzer: scriptedModel([analysis(over)]) });
    await brain.handleInbound(MSG("loại này còn không"));
    assert.ok(!landing.lookups().some((l) => /TH0123/.test(l)), `no lookup of the old code (${JSON.stringify(over)}): ${landing.lookups().join(" | ")}`);
    assert.equal(dossier.last()!.suThat?.mauChinh?.ma ?? "", "", `nothing old is the item in focus: ${JSON.stringify(over)} ${JSON.stringify(dossier.last()!.suThat)}`);
    assert.equal(dossier.last()!.suThat?.ton ?? null, null);
  }
  // The customer TYPED the code with the photo: that is this session's own word.
  const typed = fakeLanding({ thread: [...OLD_LINES, PHOTO_TURN("TH0123 còn không")], state: OLD_STATE() });
  const { brain } = await brainFor(typed, "nha-thuoc", { analyzer: scriptedModel([analysis({ entities: { productCode: "TH0123" } })]) });
  await brain.handleInbound(MSG("TH0123 còn không"));
  assert.ok(typed.lookups().some((l) => /TH0123/.test(l)), typed.lookups().join(" | "));
});

test("tầng 1 (nhà thuốc): page gửi mẫu 7 phút trước (cùng phiên) rồi khách chụp ảnh — mã LLM#1 vẫn được tra", async () => {
  const thread = [{ ...OLD_LINES[0]!, luc: ago(9) }, { ...OLD_LINES[1]!, luc: ago(7) }, PHOTO_TURN("loại này còn không")];
  const landing = fakeLanding({ thread, state: OLD_STATE() });
  const { brain } = await brainFor(landing, "nha-thuoc", { analyzer: scriptedModel([analysis({ entities: { productCode: "TH0123" } })]) });
  await brain.handleInbound(MSG("loại này còn không"));
  assert.ok(landing.lookups().some((l) => /TH0123/.test(l)), landing.lookups().join(" | "));
});

test("tầng 1 (nhà thuốc): không ảnh, cùng phiên, mã LLM#1 điền mà cả hội thoại không ai nhắc → mã bịa, không tra", async () => {
  const landing = fakeLanding({ thread: [{ chieu: "den", boi: "khach", chu: "còn siro ho không", soAnh: 0, luc: ago(0.2), maTin: "m_now" }] });
  const { brain } = await brainFor(landing, "nha-thuoc", { analyzer: scriptedModel([analysis({ entities: { productCode: "ZZ9999" } })]) });
  await brain.handleInbound(MSG("còn siro ho không", false));
  assert.ok(!landing.lookups().some((l) => /ZZ9999/.test(l)), landing.lookups().join(" | "));
});

// ---------------------------------------------------------------- bước 5: khách đã gửi ảnh rồi hỏi bằng chữ

test("tầng 1 (nhà thuốc): ảnh 3 phút trước (đã đọc, bộ nhớ trống) rồi hỏi mẫu không nhận ra → cổng ghi 'đã có ảnh', không 'chưa có gì'", async () => {
  const thread: Line[] = [
    { maTin: "m1", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(3), anh: [PHOTO] },
    { maTin: "m2", chieu: "di", boi: "bo-nao", chu: "Dạ anh chị cần tìm loại nào ạ?", soAnh: 0, luc: ago(2) },
    { maTin: "m_now", chieu: "den", boi: "khach", chu: "có loại này cho bé 2 tuổi không", soAnh: 0, luc: ago(0.2) }
  ];
  const landing = fakeLanding({ thread, state: { tenant: "shop-gia", conversationId: "facebook:k1", turns: [], imageLabels: { m1: "[ảnh: đoán là siro — chưa xác nhận]" } } });
  const { brain, dossier } = await brainFor(landing, "nha-thuoc", { analyzer: scriptedModel([analysis()]) });
  await brain.handleInbound(MSG("có loại này cho bé 2 tuổi không", false));
  assert.match(dossier.last()!.suThat?.chuaChac ?? "", /no_product_have_image/, JSON.stringify(dossier.last()!.suThat));
});

test("tầng 2 (giày): khách gửi ảnh rồi mới hỏi bằng chữ, mẫu không nhận ra → câu hỏi lại xin TÊN / MÃ, không xin lại ảnh chung chung", async () => {
  const thread: Line[] = [
    { maTin: "m1", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(2), anh: [PHOTO] },
    { maTin: "m2", chieu: "di", boi: "bo-nao", chu: "Dạ bác chờ em chút ạ", soAnh: 0, luc: ago(1.5) },
    { maTin: "m_now", chieu: "den", boi: "khach", chu: "Shop có mẫu này nữ size 36 hoặc 36,5 ko shop", soAnh: 0, luc: ago(0.2) }
  ];
  const landing = fakeLanding({ thread, state: { tenant: "shop-gia", conversationId: "facebook:k1", turns: [], imageLabels: { m1: "[ảnh: đoán là dép — chưa xác nhận]" } } });
  const { brain } = await brainFor(landing, "giay-chay", { analyzer: scriptedModel([analysis({ intent: "ask_size", entities: { size: "36" } })]) });
  await brain.handleInbound(MSG("Shop có mẫu này nữ size 36 hoặc 36,5 ko shop", false));
  const sent = landing.sent()[0] ?? "";
  assert.ok(sent !== "", "something was asked");
  assert.doesNotMatch(sent, /xin (ảnh|hình) hoặc tên/i, sent);
  assert.match(sent, /tên mẫu|mã/i, sent);
});

// ---------------------------------------------------------------- bước 10: cổng soát câu xin lại ảnh

const gateSources = (over: Record<string, unknown>) => ({
  shopSaid: "", customerSaid: "shop có loại này không", policy: "", hoSo: null, found: [], stockFacts: null, lookups: { orderLooked: false }, links: {},
  pronoun: "anh chị", uncertainProduct: true, ...over
}) as never;

test("tầng 1 (nhà thuốc): khách vừa gửi ảnh mà câu bot xin 'gửi ảnh' chung chung → sửa thành thừa nhận đã nhận ảnh + xin tên / mã; xin ảnh NHÃN (thứ khác) thì để; chưa có ảnh thì để nguyên", () => {
  const gate = new ReplyGate(loadReplyGateConfig("nha-thuoc"));
  const asked = "Dạ anh chị gửi giúp em hình ảnh sản phẩm để em kiểm tra nhé.";
  const fixed = gate.run(asked, gateSources({ photoSent: true }), { needsHuman: false });
  assert.ok(fixed.trace.includes("photo_already_sent"), fixed.trace.join(","));
  assert.doesNotMatch(fixed.reply, /gửi giúp em hình ảnh sản phẩm/);
  assert.match(fixed.reply, /nhận được ảnh/);
  assert.match(fixed.reply, /tên|mã/);
  const label = gate.run("Dạ anh chị chụp giúp em ảnh nhãn trên hộp để em tra đúng loại nhé.", gateSources({ photoSent: true }), { needsHuman: false });
  assert.ok(!label.trace.includes("photo_already_sent"), "asking for a DIFFERENT picture (the label) is not asking again");
  const none = gate.run(asked, gateSources({ photoSent: false }), { needsHuman: false });
  assert.ok(!none.trace.includes("photo_already_sent"));
  // "anh" the pronoun is not "ảnh": a sentence addressing the customer as "anh" is left alone.
  const pronoun = gate.run("Dạ em xin phép anh cho em biết tên sản phẩm ạ.", gateSources({ photoSent: true }), { needsHuman: false });
  assert.ok(!pronoun.trace.includes("photo_already_sent"));
});

// ---------------------------------------------------------------- vai trò ảnh: tham chiếu / đã khớp + câu hỏi thật / khớp chắc

const TWO_TIERS = [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M", loai: "HANG SAN", anh: "", link: "https://shop-gia.vn/product/jp9252", cac_size: [
  { size: "39", gia: 890000, so_luong: 1 }, { size: "40", gia: 890000, so_luong: 2 }, { size: "41 1/3", gia: 1190000, so_luong: 1 }, { size: "44", gia: 1190000, so_luong: 1 }, { size: "45", gia: 1190000, so_luong: 3 }
] }];
const READ = (over: Record<string, unknown> = {}): string => JSON.stringify({ loai: "san_pham", brand: "", model: "", color: "", code: "", amount: 0, orderCode: "", text: "", confidence: 0.8, ...over });

test("tầng 2 (giày): page vừa hỏi 'đôi đang đi tem ghi bao nhiêu cm' → ảnh khách là THAM CHIẾU: ghi chú có chữ đọc trên tem, không tra kho mẫu trong ảnh, không nhớ nó là mẫu đang bàn", async () => {
  const thread: Line[] = [
    { chieu: "den", boi: "khach", chu: "tư vấn em đôi chạy 10k", soAnh: 0, luc: ago(4) },
    { chieu: "di", boi: "bo-nao", chu: "Dạ đôi đang đi tem ghi bao nhiêu cm ạ", soAnh: 0, luc: ago(2) },
    { maTin: "m_now", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(0.2), anh: [PHOTO] }
  ];
  const read = READ({ brand: "nike", model: "Pegasus 40", text: "US 9 UK 8.5 EUR 42.5 27 cm" });
  const landing = fakeLanding({ thread, found: TWO_TIERS, khopAnh: { chot: { ket: "tu_tin", ma: "JP9252", viSao: "van_tay" }, ungVien: [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M" }] } });
  const { brain, dossier } = await brainFor(landing, "giay-chay", { analyzer: scriptedModel([analysis({ intent: "send_image" })]), vision: scriptedModel([read, read]), agent: scriptedModel(["{\"reply\":\"Dạ tem 27 cm thì bác đi size 42.5 ạ\"}"]) });
  await brain.handleInbound(MSG(""));
  const d = dossier.last()!;
  assert.equal(d.anh?.thamChieu, true);
  assert.match(d.ghiChu ?? "", /THAM CHIẾU/);
  assert.match(d.ghiChu ?? "", /US 9 UK 8\.5 EUR 42\.5 27 cm/, "the words on the tag are the answer");
  assert.ok(!landing.lookups().some((l) => /JP9252/.test(l)), `the shoe worn is not looked up: ${landing.lookups().join(" | ")}`);
  const saved = landing.calls.filter((c) => c.path.startsWith("/api/bo-nao/tri-nho/") && c.body !== null).at(-1)?.body as { trangThai?: { ledger?: { products?: { code: string }[] }; episode?: { focus?: { code: string } } } } | undefined;
  assert.ok(!(saved?.trangThai?.ledger?.products ?? []).some((p) => p.code === "JP9252"), "the reference is not remembered as an item talked about");
  assert.notEqual(saved?.trangThai?.episode?.focus?.code, "JP9252");
});

test("tầng 1 (nhà thuốc): ảnh ĐÃ khớp mã + câu hỏi thật → không kèm gợi ý 'ảnh chưa rõ, hỏi lại'; ảnh chưa nhận ra thì gợi ý đó vẫn còn", async () => {
  const item = [{ ma: "TH0123", ten: "Siro ho thảo dược A 100ml", loai: "HANG SAN", anh: "", link: "https://shop-gia.vn/product/th0123", cac_size: [{ size: "100ml", gia: 85000, so_luong: 4 }] }];
  const run = async (khopAnh: unknown, read = READ({ model: "Siro ho thảo dược A" })) => {
    const landing = fakeLanding({ thread: [PHOTO_TURN("loại này dùng cho bé mấy tuổi vậy shop")], found: item, ...(khopAnh !== undefined ? { khopAnh } : {}) });
    const { brain, dossier } = await brainFor(landing, "nha-thuoc", { analyzer: scriptedModel([analysis({ intent: "send_image" })]), vision: scriptedModel([read, read]), writer: scriptedModel(["{\"reply\":\"Dạ để em kiểm tra ạ\",\"needsHuman\":false}"]) });
    await brain.handleInbound(MSG("loại này dùng cho bé mấy tuổi vậy shop"));
    return dossier.last()!;
  };
  const matched = await run({ chot: { ket: "tu_tin", ma: "TH0123", viSao: "van_tay" }, ungVien: [{ ma: "TH0123", ten: "Siro ho thảo dược A 100ml" }] });
  assert.equal(matched.router?.lyDo, "image_unclear_ai", "the router read the photo turn as usual");
  assert.doesNotMatch(matched.ghiChu ?? "", /CAU HOI LAI MAU/, "a photo pinned to a code with a real question is no 'unclear photo'");
  const blind = await run(undefined, READ({ confidence: 0 }));
  assert.match(blind.ghiChu ?? "", /CAU HOI LAI MAU/, "a photo nobody recognised keeps the ask-back hint");
});

test("tầng 2 (giày): ảnh khớp CHẮC một mã có hai bậc giá → ghi chú liệt kê size kèm giá từng bậc; khách hỏi size hết thì nấc GẦN size hỏi đứng trước", async () => {
  const khopAnh = { chot: { ket: "tu_tin", ma: "JP9252", viSao: "ocr_code" }, ungVien: [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M" }] };
  const notesFor = async (chu: string, size: string) => {
    const landing = fakeLanding({ thread: [PHOTO_TURN(chu)], found: TWO_TIERS, khopAnh });
    const { brain, dossier } = await brainFor(landing, "giay-chay", { analyzer: scriptedModel([analysis({ intent: "ask_size", entities: size !== "" ? { size } : {} })]), vision: scriptedModel([READ({ code: "JP9252", model: "Adizero Boston 13" }), READ({ code: "JP9252", model: "Adizero Boston 13" })]), agent: scriptedModel(["{\"reply\":\"Dạ em kiểm tra ạ\"}"]) });
    await brain.handleInbound(MSG(chu));
    return dossier.last()!.ghiChu ?? "";
  };
  const all = await notesFor("đôi này giá sao shop", "");
  assert.match(all, /HE THONG DA TIM THAY TRONG KHO[\s\S]*JP9252/, "the pinned item's list is in the notes on a photo turn");
  assert.match(all, /39 \(1\): 890\.000đ/);
  assert.match(all, /45 \(3\): 1\.190\.000đ/);
  const near = await notesFor("đôi này còn size 42 không", "42");
  const line = /• ADIZERO BOSTON 13 M \(JP9252\)[^\n]*/.exec(near)?.[0] ?? "";
  assert.match(line, /con: 41 1\/3 \(1\): 1\.190\.000đ, (40|44) /, `nearest sizes first: ${line}`);
  assert.match(near, /TON THUC TE cua ADIZERO BOSTON 13 M \(JP9252\) size 42/, "the stock truth of the size asked, for the photo's code");
  assert.doesNotMatch(near, /CHUA RO MAU/, "no 'which item?' on a photo pinned to a code");
});

test("tầng 2 (giày): số đo chân khách nói ở PHIÊN TRƯỚC (4 tháng) không vào tính size của phiên mới; nói trong phiên này thì có", async () => {
  const notesFor = async (oldAt: string) => {
    const thread: Line[] = [
      { chieu: "den", boi: "khach", chu: "chân mình dài 25,5cm", soAnh: 0, luc: oldAt },
      { chieu: "di", boi: "bo-nao", chu: "Dạ anh cho em xin thêm độ rộng bàn chân ạ", soAnh: 0, luc: oldAt },
      { maTin: "m_now", chieu: "den", boi: "khach", chu: "mua cho con, tư vấn giúp size giày chạy", soAnh: 0, luc: ago(0.2) }
    ];
    const landing = fakeLanding({ thread, found: TWO_TIERS });
    const { brain, dossier } = await brainFor(landing, "giay-chay", { analyzer: scriptedModel([analysis({ intent: "product_advice" })]), agent: scriptedModel(["{\"reply\":\"Dạ bé chân dài bao nhiêu cm ạ?\"}"]) });
    await brain.handleInbound(MSG("mua cho con, tư vấn giúp size giày chạy", false));
    return dossier.last()!.ghiChu ?? "";
  };
  assert.doesNotMatch(await notesFor(daysAgo(120)), /SO DO( CHAN)? KHACH DA CHO/, "an old session's foot is not this order's");
  assert.match(await notesFor(ago(10)), /SO DO( CHAN)? KHACH DA CHO/, "the same words in this session count");
});

test("tầng 1 (nhà thuốc): ảnh mới chưa nhận ra, mã LLM#1 lấy từ NHÃN của ảnh đã nhận trong CÙNG phiên → vẫn được tra", async () => {
  const thread: Line[] = [
    { maTin: "m1", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(30), anh: ["https://scontent.test/truoc.jpg"] },
    { maTin: "m2", chieu: "di", boi: "bo-nao", chu: "Dạ loại này bên em còn ạ", soAnh: 0, luc: ago(29) },
    PHOTO_TURN("thế loại này thì sao")
  ];
  const landing = fakeLanding({ thread, state: { tenant: "shop-gia", conversationId: "facebook:k1", turns: [], imageLabels: { m1: "[ảnh: TH0123 Siro ho thảo dược A]" } } });
  const { brain } = await brainFor(landing, "nha-thuoc", { analyzer: scriptedModel([analysis({ entities: { productCode: "TH0123" } })]) });
  await brain.handleInbound(MSG("thế loại này thì sao"));
  assert.ok(landing.lookups().some((l) => /TH0123/.test(l)), landing.lookups().join(" | "));
});

test("tầng 2 (giày): câu xin lại ảnh được thay bằng câu ngành (tem size trong lưỡi giày); xin ảnh tem lưỡi giày / đế thì để", () => {
  const gate = new ReplyGate(loadReplyGateConfig("giay-chay"));
  const fixed = gate.run("Dạ bác cho em xin ảnh mẫu giày nhé. Em cảm ơn bác ạ.", gateSources({ photoSent: true, pronoun: "bác" }), { needsHuman: false });
  assert.ok(fixed.trace.includes("photo_already_sent"), fixed.trace.join(","));
  assert.match(fixed.reply, /tem size trong lưỡi giày/);
  assert.match(fixed.reply, /Em cảm ơn bác/, "the other sentences stay");
  const tag = gate.run("Dạ bác chụp giúp em ảnh tem trong lưỡi giày nhé.", gateSources({ photoSent: true, pronoun: "bác" }), { needsHuman: false });
  assert.ok(!tag.trace.includes("photo_already_sent"));
  const sole = gate.run("Dạ bác chụp giúp em hình mặt đế để em xem độ mòn nhé.", gateSources({ photoSent: true, pronoun: "bác" }), { needsHuman: false });
  assert.ok(!sole.trace.includes("photo_already_sent"));
});

test("tầng 1: danh sách biến thể cho ghi chú — một giá thì không lặp giá; nhiều bậc giá thì kèm giá; hỏi một nấc thì nấc gần đứng trước", async () => {
  const { SizeMatcher, variantsForNote, loadMatchingConfig } = await import("@sp/brain");
  const sizes = new SizeMatcher(loadMatchingConfig("nha-thuoc").sizes);
  const one = [{ size: "60", gia: 50000, so_luong: 2 }, { size: "100", gia: 50000 }];
  assert.deepEqual(variantsForNote(one, "", sizes), ["60 (2)", "100"]);
  const two = [{ size: "30", gia: 40000, so_luong: 1 }, { size: "60", gia: 70000, so_luong: 2 }, { size: "90", gia: 120000, so_luong: 1 }];
  assert.deepEqual(variantsForNote(two, "", sizes), ["30 (1): 40.000đ", "60 (2): 70.000đ", "90 (1): 120.000đ"]);
  assert.deepEqual(variantsForNote(two, "85", sizes).slice(0, 2), ["90 (1): 120.000đ", "60 (2): 70.000đ"]);
});
