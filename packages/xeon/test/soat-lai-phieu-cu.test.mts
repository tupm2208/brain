/**
 * SOÁT LẠI 05/10/2026 — Ca kiểm của các phiếu Desk `da-xu-ly` từ 30/09 (soát nhanh) chạy lại qua cả lượt Xeon:
 * agent + cổng soát nhìn cùng một nguồn chính sách, lời hứa gọi người bật cờ người trực, "còn màu/đôi nào
 * khác" ra danh sách biến thể thật, ảnh CDN tải hụt, khách vừa gửi ảnh thì không bị xin lại ảnh.
 * Tầng 1 chạy cả ngành GIẢ (nhà thuốc) khi hàng Ca kiểm không phải từ vựng giày.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { pharmacyPack, runningShoesPack } from "./industries.mts";
import {
  BrainService, ContextAnalyzer, ImageFetcher, ImageIntake, LicenseLedger, LicenseService, MemoryDossierStore, MemoryLogger, SalesAgent, generateSigningKey,
  type ChatMessage, type ChatModelPort, type FetchLike, type HistoryLine
} from "@sp/xeon";
import { loadCommonAgent } from "@sp/brain";

const T0 = Date.parse("2026-10-05T09:00:00.000Z");
const clock = { now: () => new Date(T0) };
const noSleep = async (): Promise<void> => undefined;
const ago = (minutes: number): string => new Date(T0 - minutes * 60_000).toISOString();
const PHOTO = "https://scontent.test/khach-5phut.jpg";

function model(answers: string[]): ChatModelPort & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen, ready: () => true,
    complete: async (messages) => { seen.push(messages.map((m) => ({ ...m }))); const next = answers.shift(); return next === undefined ? { ok: false, viSao: "het", transient: true } : { ok: true, text: next, model: "gia" }; }
  };
}

const analysis = (intent: string, over: Record<string, unknown> = {}): string => JSON.stringify({
  intent, confidence: 0.9, entities: {}, needProfile: { buyerType: "", experience: "", insistOnProduct: false }, needBrief: {},
  focus: { product: "", products: [], changed: false, reason: "", roles: [] }, contextSummary: "", episodeSummary: "", customerGoal: "",
  referencesPreviousMessage: false, missingInformation: [], lookupCommands: [], riskFlags: [], ...over
});

type Line = { maTin?: string; chieu: string; boi: string; chu: string; soAnh: number; luc: string; anh?: string[] };
interface Options { thread: Line[]; found?: unknown[]; policy?: string }

function landing(o: Options) {
  const calls: { path: string; body: Record<string, unknown> | null }[] = [];
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "storefront.link", "catalog.find", "shop.bankAccount", "conversation.recent"];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: o.thread, hoiThoai: { daChaoAi: true, theDaGui: [] } } });
      if (tool === "catalog.find") return reply({ ok: true, data: { ketQua: (o.found ?? []).length > 0 ? o.found : "KHONG tim thay san pham nao khop" } });
      if (tool === "policy.get") return reply({ ok: true, data: o.policy ? { found: true, text: o.policy, updatedAt: ago(60) } : { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 5000 } });
      return reply({ ok: true, data: { items: [], rows: [], truncated: false, asOf: "" } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: null });
    if (u.pathname === "/api/hop-thu/gui") return reply({ ok: true, guiNgay: true });
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  return {
    fetch, calls,
    sent: () => calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => String(c.body!["chu"])),
    toolCalls: () => calls.filter((c) => c.path === "/api/bo-nao/cong-cu" && c.body !== null).map((c) => String(c.body!["ten"]))
  };
}

async function brainWith(fetch: FetchLike, analyzer: ChatModelPort, agent: ChatModelPort | null) {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "shopgia", tenShop: "Shop Giả", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop.vn" });
  const logger = new MemoryLogger();
  const dossier = new MemoryDossierStore();
  const brain = new BrainService({
    license, fetch, logger, clock, sleep: noSleep, dossier,
    agent: agent ? new SalesAgent({ model: agent, logger, clock, sleep: noSleep }) : undefined,
    analyzer: new ContextAnalyzer({ model: analyzer, logger }),
    writer: null
  });
  return { brain, dossier, logger };
}

const MESSAGE = (chu: string) => ({ tenant: "shopgia", kenh: "facebook", nguoi: "k1", chu, maHoiThoai: "facebook:k1" });

// =====================================================================================================
// Phiếu 2026-09-01-agent-va-cong-soat-thieu-nguon-that
// =====================================================================================================

const ORDER_POLICY = "Hàng order về sau 3-7 ngày kể từ khi cọc.";

test("agent tự gọi chinh_sach, LLM#1 không xin tra chính sách → cổng vẫn đọc chính sách của landing: '3-7 ngày' đúng chính sách được giữ", async () => {
  const said = "hàng order thì bao lâu về vậy shop";
  const l = landing({ thread: [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: ago(0.2) }], policy: ORDER_POLICY });
  const agent = model(["{\"tool\":\"chinh_sach\",\"args\":{}}", "{\"reply\":\"Dạ hàng order bên em về sau 3-7 ngày kể từ khi cọc ạ.\"}"]);
  const { brain, dossier } = await brainWith(l.fetch, model([analysis("shipping")]), agent);
  await brain.handleInbound(MESSAGE(said));
  assert.ok(agent.seen.length >= 2, "the agent ran and called its tool");
  assert.match(agent.seen[1]!.at(-1)!.content, /KET QUA chinh_sach/);
  assert.match(l.sent()[0] ?? "", /3-7 ngày/, JSON.stringify(dossier.last()?.congSoat ?? null));
});

test("agent nói '5-9 ngày' mà chính sách ghi 3-7 → cổng cắt số không có nguồn", async () => {
  const said = "hàng order thì bao lâu về vậy shop";
  const l = landing({ thread: [{ chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: ago(0.2) }], policy: ORDER_POLICY });
  const agent = model(["{\"tool\":\"chinh_sach\",\"args\":{}}", "{\"reply\":\"Dạ hàng order bên em về sau 5-9 ngày ạ.\"}"]);
  const { brain } = await brainWith(l.fetch, model([analysis("shipping")]), agent);
  await brain.handleInbound(MESSAGE(said));
  const sent = l.sent().join(" ");
  assert.ok(sent !== "", "something was sent");
  assert.doesNotMatch(sent, /5-9 ngày/);
});

test("tai_khoan_shop: lời dặn chung bắt agent gọi công cụ trước khi nghi STK; công cụ lỗi → agent được bảo không tự phán", async () => {
  const chung = loadCommonAgent();
  const rules = chung.khoi.flatMap((k) => k.loiDan).join("\n");
  assert.match(rules, /goi tai_khoan_shop de doi chieu/);
  assert.match(rules, /Nghi oan khach la loi rat nang/);
  assert.match(rules, /KHONG nghi oan khach chuyen nham/);
  assert.match(rules, /Khach xin so tai khoan: goi tai_khoan_shop roi doc dung so/);
  assert.ok(runningShoesPack.agent!.tools.some((t) => t.name === "tai_khoan_shop"), "the tool is offered to the agent");
  const agentModel = model(["{\"tool\":\"tai_khoan_shop\",\"args\":{}}", "{\"reply\":\"Dạ để em kiểm tra lại rồi báo anh ngay ạ.\"}"]);
  const agent = new SalesAgent({ model: agentModel, logger: new MemoryLogger(), clock, sleep: noSleep });
  const history: HistoryLine[] = [{ who: "khach", text: "em chuyển vào stk 999 rồi nhé", images: 1 }];
  const out = await agent.run({
    agent: runningShoesPack.agent!, chung, site: "https://shop.vn", history,
    tools: { findStock: async () => [], policy: async () => "", bankAccount: async () => { throw new Error("landing het gio"); } }
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  const toolResult = agentModel.seen[1]!.at(-1)!.content;
  assert.match(toolResult, /KET QUA tai_khoan_shop: LOI/);
  assert.match(toolResult, /Khong duoc bia/);
  assert.match(agentModel.seen[0]![0]!.content, /goi tai_khoan_shop de doi chieu/, "the rule reaches the agent's prompt");
});

// =====================================================================================================
// Phiếu 2026-09-01-hua-goi-nguoi-nhung-khong-bao-nguoi-that
// =====================================================================================================

for (const pack of [runningShoesPack, pharmacyPack]) {
  test(`${pack.id}: câu agent hứa gọi người (mọi cách nói) → bật cờ người trực; câu thường thì không`, () => {
    const chung = loadCommonAgent();
    for (const reply of [
      "Dạ em báo người phụ trách kiểm tra lại rồi báo anh ngay ạ.",
      "Dạ để em gọi người vào xử lý cho bác nhé.",
      "Dạ để em báo bên phụ trách ạ",
      "Dạ em nhờ nhân viên vào hỗ trợ mình ngay ạ."
    ]) assert.equal(SalesAgent.handsOver(pack, reply, chung), true, reply);
    for (const reply of ["Dạ mẫu này còn size 42 ạ.", "Dạ mọi người vào xem mẫu này nhiều lắm ạ.", "Dạ mẫu này nhiều người gọi là bản đặc biệt ạ."]) {
      assert.equal(SalesAgent.handsOver(pack, reply, chung), false, reply);
    }
  });
}

// =====================================================================================================
// Phiếu 2026-09-05-con-mau-khac-size-nay-liet-ke-ban-cung-mau (qua cả lượt)
// =====================================================================================================

const B13 = { ma: "JP9252", ten: "ADIZERO BOSTON 13 M", loai: "HANG SAN", cac_size: [{ size: "42", gia: 3290000, so_luong: 1 }, { size: "44", gia: 3290000, so_luong: 1 }], anh: "", link: "https://shop.vn/product/jp9252" };
const B13_DEN = { ma: "IF9414", ten: "ADIZERO BOSTON 13 M den", loai: "HANG SAN", cac_size: [{ size: "44", gia: 3290000, so_luong: 2 }], anh: "", link: "https://shop.vn/product/if9414" };
const B13_TRANG = { ma: "IF9999", ten: "ADIZERO BOSTON 13 M trang", loai: "HANG SAN", cac_size: [{ size: "42", gia: 3290000, so_luong: 2 }], anh: "", link: "https://shop.vn/product/if9999" };

for (const said of ["size 44 còn những đôi nào", "còn màu khác không shop"]) {
  test(`(đang bàn Boston 13) '${said}' → ghi chú agent có DANH SÁCH biến thể cùng mẫu còn hàng (không phán 'hết')`, async () => {
    const thread: Line[] = [
      { chieu: "den", boi: "khach", chu: "boston 13 size 44 còn không", soAnh: 0, luc: ago(3) },
      { chieu: "di", boi: "bo-nao", chu: "Dạ Boston 13 (JP9252) size 44 còn 1 đôi ạ.", soAnh: 0, luc: ago(2) },
      { chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: ago(0.2) }
    ];
    const l = landing({ thread, found: [B13, B13_DEN, B13_TRANG] });
    const agent = model(["{\"reply\":\"Dạ còn ạ.\"}"]);
    const focus = { product: "JP9252", products: ["JP9252"], changed: false, reason: "", roles: [] };
    const { brain } = await brainWith(l.fetch, model([analysis("ask_size", { entities: { productCode: "JP9252", size: "44" }, focus })]), agent);
    await brain.handleInbound(MESSAGE(said));
    assert.ok(agent.seen.length > 0, "the agent ran");
    const system = agent.seen[0]![0]!.content;
    assert.match(system, /KHACH HOI MAU\/SIZE KHAC cua ADIZERO BOSTON 13 M \(JP9252\)/, said);
    assert.match(system, /IF9414/);
    assert.doesNotMatch(system.slice(system.indexOf("KHACH HOI MAU")), /IF9999[^\n]*size con: 44/);
  });
}

// =====================================================================================================
// Phiếu 2026-09-06-anh-cdn-tai-hut-lan-dau-bot-bao-anh-chua-hien-thi
// =====================================================================================================

test("CDN từ chối cả hai lần → log cảnh báo có mã hội thoại, lỗi vào hồ sơ lượt, mô hình nhận ĐỊA CHỈ ảnh", async () => {
  const warnings: string[] = [];
  const logger = { info: () => undefined, warn: (m: string) => { warnings.push(m); } };
  let tries = 0;
  const fetcher = new ImageFetcher({ fetch: async () => { tries += 1; return { ok: false, status: 403, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }; }, sleep: async () => undefined });
  const vision = model([JSON.stringify({ loai: "san_pham", brand: "", model: "", color: "", code: "", amount: 0, orderCode: "", text: "", confidence: 0.2 })]);
  const intake = new ImageIntake({ vision, fetcher, logger: logger as never, clock });
  const reading = await intake.read({
    tenant: "shopgia", binding: { gateway: { tools: { available: () => [], call: async () => ({ ok: false, error: { message: "x" } }) } } } as never,
    photos: [{ url: PHOTO, at: ago(0.1) }], conversationId: "facebook:k9", text: { heThong: "doc anh", huongDan: [], nhan: {} }
  });
  assert.equal(tries, 2, "one retry");
  assert.ok(reading !== null);
  assert.ok(reading!.loi.some((e) => /tai anh: HTTP 403/.test(e)), reading!.loi.join(" | "));
  assert.ok(warnings.some((w) => /facebook:k9/.test(w) && /khong tai duoc anh/.test(w)), warnings.join(" | "));
  assert.ok(vision.seen.length > 0, "the model was still asked");
  const shown = vision.seen[0]!.flatMap((m) => m.images ?? []);
  assert.ok(shown.includes(PHOTO), `the model got the address: ${JSON.stringify(shown)}`);
  assert.doesNotMatch(reading!.note ?? "", /chưa hiển thị/);
});

// =====================================================================================================
// Phiếu 2026-09-01-bot-xin-anh-khi-khach-vua-gui-anh (câu thật của ca Duong Xuan, qua cả lượt)
// =====================================================================================================

test("ảnh ở tin trước 5 phút + 'Shop có hoka slide 3 nữ size 36 hoặc 36,5 ko shop'; agent lỡ viết 'gửi giúp em hình ảnh mẫu' → câu đi ra thừa nhận đã nhận ảnh, không xin ảnh", async () => {
  const said = "Shop có hoka slide 3 nữ size 36 hoặc 36,5 ko shop";
  const thread: Line[] = [
    { maTin: "m1", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(5), anh: [PHOTO] },
    { maTin: "m2", chieu: "den", boi: "khach", chu: said, soAnh: 0, luc: ago(0.2) }
  ];
  const l = landing({ thread, found: [] });
  const agent = model(["{\"reply\":\"Dạ bác gửi giúp em hình ảnh mẫu nhé.\"}", "{\"reply\":\"Dạ bác gửi giúp em hình ảnh mẫu nhé.\"}"]);
  const { brain } = await brainWith(l.fetch, model([analysis("ask_size", { entities: { productName: "hoka slide 3", brand: "hoka", size: "36" } })]), agent);
  await brain.handleInbound(MESSAGE(said));
  const sent = l.sent().join(" ");
  assert.ok(sent !== "", "something was sent");
  assert.doesNotMatch(sent, /gửi giúp em hình ảnh mẫu|xin (ảnh|hình) hoặc tên/i, sent);
});
