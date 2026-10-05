/**
 * 05/10/2026 — phiếu Desk "Bot chốt hoặc hứa 'phiếu đặt hàng bên dưới' nhưng thẻ phiếu không đi".
 *
 * Nguyên tắc: khi bot nói có phiếu thì phiếu phải đi; khách chốt / giục phiếu với món đủ mã + biến thể còn
 * hàng thì phiếu đi bất kể đường trả lời (kể cả khi gọi người), mỗi dòng giữ biến thể riêng; phiếu không
 * đi thì câu hứa bị cắt và (khi cần) gọi người.
 *
 * Tầng 1 bằng ngành giả (nhà thuốc: biến thể "hộp 10" / "vỉ 1"), tầng 2 bằng gói `giay-chay` thật,
 * tầng 3 bằng hồ sơ shop có / không khai `banHang.khiChot`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import { EntityExtractor, entityLexiconOf, loadDialogueConfig, loadEntityConfig, loadPack, loadReplyGateConfig, repairFormPromise } from "@sp/brain";
import { emptyShopProfile } from "@sp/contract";
import {
  BrainService, ContextAnalyzer, LicenseLedger, LicenseService, MemoryDossierStore, MemoryLogger, ReplyDispatcher, SalesAgent, generateSigningKey, orderLinesIn, systemCapabilities,
  type ChatMessage, type ChatModelPort, type FetchLike
} from "@sp/xeon";

const VARS = { khach: "bác", Khach: "Bác", shop: "em", tenNguoiPhuTrach: "người phụ trách" };

// ---------------------------------------------------------------- tầng 1: ngành giả

const thuoc = (ma: string, labels: string[]) => ({ ma, ten: `THUỐC ${ma}`, cac_size: labels.map((size) => ({ size, gia: 50000, so_luong: 3 })), link: `https://nhathuoc.vn/p/${ma}` });

test("tầng 1 (nhà thuốc giả): hai mã, mỗi mã một biến thể của CHÍNH nó → một phiếu hai dòng; thiếu / thừa biến thể → không đoán", () => {
  const found = [thuoc("TH01", ["Hộp 10", "Vỉ 1"]), thuoc("TH02", ["Hộp 10", "Vỉ 1"])];
  assert.deepEqual(orderLinesIn("cho mình lấy TH01 hộp 10 với TH02 vỉ 1 nhé", found), [{ ma: "TH01", size: "Hộp 10" }, { ma: "TH02", size: "Vỉ 1" }]);
  assert.deepEqual(orderLinesIn("lấy TH01 với TH02 hộp 10", found), [], "TH01 has no variant of its own → nothing");
  assert.deepEqual(orderLinesIn("lấy TH01 hộp 10 vỉ 1 và TH02 vỉ 1", found), [], "two variants for one code → nothing");
  assert.deepEqual(orderLinesIn("lấy TH01 hộp 10", found), [], "one code → the single-item path decides");
  const d = new ReplyDispatcher();
  const hoSo = emptyShopProfile(); hoSo.banHang.khiChot = "phieu";
  const plan = d.plan({ reply: "Dạ", found, stock: null, theDaGui: [], daChaoAi: true, firstReply: false, intent: "place_order", closingSignals: [], readyToBuy: false, focusCode: "", requestedSize: "", hoSo, asksFootMeasure: "", site: "https://nhathuoc.vn", message: "lấy TH01 hộp 10 với TH02 vỉ 1" });
  assert.deepEqual(plan.phieu, { items: [{ ma: "TH01", size: "Hộp 10" }, { ma: "TH02", size: "Vỉ 1" }] });
  assert.equal(plan.chot, true);
});

test("tầng 1 (nhà thuốc giả): câu hứa phiếu chỉ giữ khi phiếu đi; không đi → cắt, hỏi món hoặc gọi người", () => {
  const cfg = loadReplyGateConfig("nha-thuoc").contact;
  assert.notEqual(cfg.formPromise, "", "the promise pattern is tier 1 — every industry has it");
  const promise = "Dạ thuốc này còn ạ. Em gửi phiếu đặt hàng bên dưới, bác điền giúp em nhé.";
  assert.equal(repairFormPromise(promise, cfg, { formSent: true, personNeeded: false, vars: VARS }).reply, promise, "the form went: nothing changes");
  const cut = repairFormPromise(promise, cfg, { formSent: false, personNeeded: false, vars: VARS });
  assert.equal(cut.cut, true);
  assert.equal(cut.reply, "Dạ thuốc này còn ạ.");
  assert.equal(cut.callPerson, false);
  const onlyPromise = repairFormPromise("Dạ em gửi form đặt hàng ngay bên dưới ạ.", cfg, { formSent: false, personNeeded: false, vars: VARS });
  assert.match(onlyPromise.reply, /cho em xin mẫu và phân loại/, "tier 1 asks for the item in neutral words");
  const person = repairFormPromise("Dạ hệ thống sẽ gửi phiếu đặt hàng để bác tự điền ạ.", cfg, { formSent: false, personNeeded: true, vars: VARS });
  assert.equal(person.reply, "Dạ để em báo người phụ trách chốt đơn với bác ngay ạ.");
  assert.equal(person.callPerson, true);
  // A form already sent earlier is not a promise; nor is a warranty slip.
  const earlier = "Dạ bác điền giúp em phiếu em đã gửi phía trên nhé.";
  assert.equal(repairFormPromise(earlier, cfg, { formSent: false, personNeeded: false, vars: VARS }).cut, false);
  assert.equal(repairFormPromise("Dạ em gửi phiếu bảo hành kèm hàng ạ.", cfg, { formSent: false, personNeeded: false, vars: VARS }).cut, false);
});

test("tầng 1: khách XIN / GIỤC phiếu là tín hiệu chốt (lời chung, mọi ngành)", () => {
  const pharmacy = loadPack("nha-thuoc");
  const ex = new EntityExtractor(loadEntityConfig("nha-thuoc"), entityLexiconOf(pharmacy.lexicon, loadDialogueConfig("nha-thuoc")));
  for (const said of ["Gửi phiếu đi shop", "Cho em cái form đặt hàng", "gửi em link đặt hàng với"]) {
    assert.ok(ex.extract(said).closingSignals.length > 0, said);
  }
  assert.equal(ex.extract("thuốc này uống mấy lần một ngày").closingSignals.length, 0);
});

test("tầng 1: agent được báo TRƯỚC khi viết là lượt này phiếu có đi hay không", () => {
  const hoSo = emptyShopProfile(); hoSo.banHang.khiChot = "phieu";
  const open = ["catalog.find", "conversation.recent", "order.formLink"];
  const no = systemCapabilities({ open, visionReady: false, hoSo, phieu: "khong-gui" }).join("\n");
  assert.match(no, /LUOT NAY HE THONG KHONG GUI PHIEU/);
  assert.doesNotMatch(no, /em gửi phiếu đặt hàng bên dưới/);
  const yes = systemCapabilities({ open, visionReady: false, hoSo, phieu: "se-gui" }).join("\n");
  assert.match(yes, /em gửi phiếu đặt hàng bên dưới/);
});

// ---------------------------------------------------------------- tầng 2: giày chạy

const giay = (ma: string, sizes: string[], loai = "HANG SAN") => ({ ma, ten: `MẪU ${ma}`, loai, cac_size: sizes.map((size) => ({ size, gia: 1990000, so_luong: 1 })), link: `https://shop.vn/product/${ma.toLowerCase()}` });

test("tầng 2 (giay-chay): 'Em lấy IM7681 size 42 và JP9252 size 41' → một phiếu hai dòng đúng size; nấc '41-1/3' đọc đúng", () => {
  const found = [giay("IM7681", ["41", "42", "43"]), giay("JP9252", ["41", "41 1/3", "42"])];
  assert.deepEqual(orderLinesIn("Em lấy IM7681 size 42 và JP9252 size 41", found), [{ ma: "IM7681", size: "42" }, { ma: "JP9252", size: "41" }]);
  assert.deepEqual(orderLinesIn("lấy IM7681 42 với JP9252 41-1/3 nhé", found), [{ ma: "IM7681", size: "42" }, { ma: "JP9252", size: "41 1/3" }]);
  assert.deepEqual(orderLinesIn("lấy IM7681 42.5 với JP9252 41", found), [], "42.5 is not 42");
});

test("tầng 2 (giay-chay): câu hỏi lại khi hứa phiếu mà chưa đủ món nói 'size' của ngành", () => {
  const cfg = loadReplyGateConfig("giay-chay").contact;
  assert.match(repairFormPromise("Dạ em gửi phiếu bên dưới ạ.", cfg, { formSent: false, personNeeded: false, vars: VARS }).reply, /mẫu và size/);
});

test("tầng 2 + 3: lượt chốt — đơn đang chạy chặn phiếu mới → cần người; shop chưa khai cách chốt mà đủ món → cần người; chưa đủ món → hỏi", () => {
  const d = new ReplyDispatcher();
  const stock = { productCode: "JP9252", productName: "MẪU JP9252", requestedSize: "42", stock: { size: "42", qty: 1, approximate: false }, price: 1990000, otherKho: [], variantsAvailable: [] };
  const base = { reply: "Dạ", found: [giay("JP9252", ["42"])], stock, theDaGui: [], daChaoAi: true, firstReply: false, intent: "ask_size", closingSignals: ["gui phieu"], readyToBuy: false, focusCode: "JP9252", requestedSize: "42", asksFootMeasure: "", site: "https://shop.vn", message: "Gửi phiếu đi shop" };
  const phieu = emptyShopProfile(); phieu.banHang.khiChot = "phieu";
  // "Gửi phiếu đi shop" (intent is NOT place_order) on a settled item → the form goes.
  assert.deepEqual(d.plan({ ...base, hoSo: phieu }).phieu, { items: [{ ma: "JP9252", size: "42" }] });
  // The same words with nothing settled → no form, no person: the bot asks.
  const loose = d.plan({ ...base, hoSo: phieu, stock: null, focusCode: "", requestedSize: "" });
  assert.equal(loose.phieu, undefined);
  assert.equal(loose.canNguoiChot, "");
  assert.equal(loose.chot, true);
  // A running order and "gửi phiếu" → no new form, a person.
  const running = d.plan({ ...base, hoSo: phieu, orderedCodes: ["JP9252"], namedThisTurn: [] });
  assert.equal(running.phieu, undefined);
  assert.equal(running.canNguoiChot, "don_dang_chay");
  // A question about the order already placed ("bao giờ lấy được hàng" → shipping) is not a new order: no person notice.
  assert.equal(d.plan({ ...base, hoSo: phieu, intent: "shipping", closingSignals: ["lay"], message: "bao giờ lấy được hàng", orderedCodes: ["JP9252"], namedThisTurn: [] }).canNguoiChot, "");
  // Tier 3 left empty (khiChot ""): never a guess — a person takes the settled order.
  const blank = d.plan({ ...base, hoSo: emptyShopProfile() });
  assert.equal(blank.phieu, undefined);
  assert.equal(blank.canNguoiChot, "chua_khai_cach_chot");
  // Tier 3 "goi-nguoi": a person, no form.
  const viaPerson = emptyShopProfile(); viaPerson.banHang.khiChot = "goi-nguoi";
  assert.equal(d.plan({ ...base, hoSo: viaPerson }).goiNguoi, true);
});

// ---------------------------------------------------------------- qua cả đường đi (landing giả)

const T0 = Date.parse("2026-10-05T09:00:00.000Z");
const clock = { now: () => new Date(T0) };
const noSleep = async (): Promise<void> => undefined;
const AT = "2026-10-05T08:59:50.000Z";

function scriptedModel(answers: string[]): ChatModelPort & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen, ready: () => true,
    complete: async (messages) => {
      seen.push(messages.map((m) => ({ ...m })));
      const next = answers.shift();
      return next === undefined ? { ok: false, viSao: "het kich ban", transient: true } : { ok: true, text: next, model: "gia" };
    }
  };
}

const analysis = (over: Record<string, unknown>): string => JSON.stringify({
  intent: "place_order", confidence: 0.9, entities: {}, needProfile: { buyerType: "", experience: "", insistOnProduct: false }, needBrief: { readyToBuy: true },
  focus: { product: "", products: [], changed: false, reason: "", roles: [] }, contextSummary: "", episodeSummary: "", customerGoal: "",
  referencesPreviousMessage: false, missingInformation: [], lookupCommands: [], riskFlags: [], ...over
});

interface Call { path: string; body: Record<string, unknown> | null }

function landing(o: { said: string; found: unknown[]; khiChot: string; formChan?: string }) {
  const calls: Call[] = [];
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "catalog.find", "conversation.recent", "order.formLink", "shop.profile"];
  const hoSo = { ...emptyShopProfile(), banHang: { ...emptyShopProfile().banHang, khiChot: o.khiChot }, xungHo: { khach: "bác", shop: "em" } };
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: [{ chieu: "den", boi: "khach", chu: o.said, soAnh: 0, luc: AT }], hoiThoai: { daChaoAi: true, dienThoaiDaCho: false, theDaGui: [] } } });
      if (tool === "catalog.find") return reply({ ok: true, data: { ketQua: o.found } });
      if (tool === "shop.profile") return reply({ ok: true, data: { hoSo, chinhSach: { doiTra: "", ship: "", baoHanh: "" }, kho: [] } });
      if (tool === "order.formLink") {
        if (o.formChan) return reply({ ok: true, data: { url: "", dienSan: "khong", loiMoi: "", chan: { lyDo: o.formChan, maDon: "ORD-1" } } });
        const items = (body!["input"] as { items: { ma: string; size: string }[] }).items;
        return reply({ ok: true, data: { url: `https://shop.vn/dat-hang?items=${items.map((i) => `${i.ma}:${i.size}`).join("~")}`, dienSan: "khong", loiMoi: "Dạ em gửi phiếu đặt hàng bên dưới ạ.", the: { tieuDe: "Đặt đơn ngay", phuDe: "", anh: "" } } });
      }
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 5000 } });
      return reply({ ok: true, data: { items: [], rows: [], truncated: false, asOf: "" } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: null });
    if (u.pathname === "/api/hop-thu/gui") return reply({ ok: true, guiNgay: true, daGui: { the: [], boQua: [], linkLoc: false, phieuDatHang: body?.["phieuDatHang"] !== undefined, anhHuongDan: false, chaoAi: false } });
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  return {
    fetch, calls,
    sent: () => calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => c.body ?? {}),
    formInputs: () => calls.filter((c) => c.path === "/api/bo-nao/cong-cu" && c.body?.["ten"] === "order.formLink").map((c) => c.body!["input"] as { items: { ma: string; size: string }[] }),
    notices: () => calls.filter((c) => c.path === "/api/hop-thu/can-nguoi").map((c) => String(c.body!["lyDo"]))
  };
}

async function brainWith(fetch: FetchLike, analyzer: ChatModelPort, agent: ChatModelPort) {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "shopgiay", tenShop: "Shop Giay", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop.vn" });
  const logger = new MemoryLogger();
  const dossier = new MemoryDossierStore();
  const brain = new BrainService({
    license, fetch, logger, clock, sleep: noSleep, dossier,
    agent: new SalesAgent({ model: agent, logger, clock, sleep: noSleep }),
    analyzer: new ContextAnalyzer({ model: analyzer, logger }), writer: null
  });
  return { brain, dossier };
}

const ask = (said: string) => ({ tenant: "shopgiay", kenh: "facebook", nguoi: "k1", chu: said, maHoiThoai: "facebook:k1" });

test("đường đi: 'Em lấy IM7681 size 42 và JP9252 size 41' → order.formLink một lần với HAI dòng, phiếu đi kèm câu", async () => {
  const said = "Em lấy IM7681 size 42 và JP9252 size 41";
  const site = landing({ said, found: [giay("IM7681", ["41", "42"]), giay("JP9252", ["41", "42"])], khiChot: "phieu" });
  const agent = scriptedModel(["{\"reply\":\"Dạ IM7681 size 42 và JP9252 size 41 đều còn ạ, em gửi phiếu đặt hàng bên dưới bác điền giúp em nhé.\"}"]);
  const { brain } = await brainWith(site.fetch, scriptedModel([analysis({ entities: { productCode: "IM7681", size: "42" } })]), agent);
  const result = await brain.handleInbound(ask(said));
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  assert.deepEqual(site.formInputs()[0]?.items, [{ ma: "IM7681", size: "42" }, { ma: "JP9252", size: "41" }]);
  const sent = site.sent()[0]!;
  assert.ok(sent["phieuDatHang"] !== undefined, "the form rides with the reply");
  assert.match(String(sent["chu"]), /phiếu đặt hàng bên dưới/, "the promise stays: the form went");
});

test("đường đi: mẫu kho ĐỐI TÁC (hàng order) còn size → phiếu vẫn đi, không im lặng", async () => {
  const said = "Ok. Lấy đôi JP9252 - có 41-1/3 nhé";
  const site = landing({ said, found: [giay("JP9252", ["41 1/3", "42"], "HANG ORDER")], khiChot: "phieu" });
  const agent = scriptedModel(["{\"reply\":\"Dạ JP9252 size 41 1/3 bên em đặt được ạ, em gửi phiếu đặt hàng bên dưới bác điền giúp em nhé.\"}"]);
  const { brain } = await brainWith(site.fetch, scriptedModel([analysis({ entities: { productCode: "JP9252", size: "41 1/3" } })]), agent);
  const result = await brain.handleInbound(ask(said));
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  assert.deepEqual(site.formInputs()[0]?.items, [{ ma: "JP9252", size: "41 1/3" }]);
  assert.ok(site.sent()[0]!["phieuDatHang"] !== undefined);
});

test("đường đi: landing CHẶN phiếu (đang bàn đơn cũ) → câu hứa phiếu bị cắt, câu báo người thay, người trực được gọi", async () => {
  const said = "chốt JP9252 size 42 gửi phiếu đi shop";
  const site = landing({ said, found: [giay("JP9252", ["42"])], khiChot: "phieu", formChan: "dang_ban_don_cu" });
  const agent = scriptedModel(["{\"reply\":\"Dạ JP9252 size 42 còn ạ. Em gửi phiếu đặt hàng bên dưới, bác điền giúp em nhé.\"}"]);
  const { brain } = await brainWith(site.fetch, scriptedModel([analysis({ entities: { productCode: "JP9252", size: "42" } })]), agent);
  await brain.handleInbound(ask(said));
  assert.equal(site.formInputs().length, 1, "the form was asked");
  const sent = site.sent()[0]!;
  assert.equal(sent["phieuDatHang"], undefined);
  const text = String(sent["chu"]);
  assert.doesNotMatch(text, /phiếu đặt hàng bên dưới/, "no promise of what did not go");
  assert.match(text, /JP9252 size 42 còn/, "the rest of the reply stays");
  assert.match(text, /báo người phụ trách chốt đơn/);
  assert.ok(site.notices().some((n) => /phieu khong di/.test(n)), site.notices().join(" | "));
});

test("đường đi: shop chốt QUA NGƯỜI (tầng 3) mà agent lỡ hứa phiếu → cắt + câu báo người + gọi người", async () => {
  const said = "chốt JP9252 size 42 nhé";
  const site = landing({ said, found: [giay("JP9252", ["42"])], khiChot: "goi-nguoi" });
  const agent = scriptedModel(["{\"reply\":\"Dạ JP9252 size 42 còn ạ, em gửi phiếu đặt hàng bên dưới nhé.\"}"]);
  const { brain } = await brainWith(site.fetch, scriptedModel([analysis({ entities: { productCode: "JP9252", size: "42" } })]), agent);
  await brain.handleInbound(ask(said));
  assert.equal(site.formInputs().length, 0);
  const text = String(site.sent()[0]!["chu"]);
  assert.doesNotMatch(text, /phiếu đặt hàng bên dưới/);
  assert.match(text, /báo người phụ trách chốt đơn/);
  assert.ok(site.notices().some((n) => /shop chot qua nguoi/.test(n)));
});

// ---------------------------------------------------------------- phiếu 2026-09-11 (phần Xeon): tin báo theo đơn của landing

test("tin landing tự báo theo đơn (boi 'don-hang') là tiếng tự động của trang, không phải người trực: bot không nhường, không lấy làm nguồn sự thật", async () => {
  const { BOT_AUTHORS, writtenByPerson } = await import("@sp/xeon");
  assert.equal(writtenByPerson({ chieu: "di", boi: "don-hang" }), false);
  assert.equal(writtenByPerson({ chieu: "di", boi: "Minh" }), true);
  assert.ok(BOT_AUTHORS.has("don-hang"));
});

test("phiếu 2026-09-11 (phần cổng soát): mã vận đơn 'SPXVN063632957159' trong câu không bị đọc thành mã hàng VN06363; link tra cứu giữ nguyên", async () => {
  const B = await import("@sp/brain");
  const gate = new B.ReplyGate(B.loadReplyGateConfig("giay-chay"));
  const vn = { ma: "VN06363", ten: "MẪU VN06363", cac_size: [{ size: "42", gia: 1990000, so_luong: 1 }], link: "https://shop.example/product/vn06363" };
  const reply = "Dạ đơn của bác mã vận đơn SPXVN063632957159, bác tra cứu hành trình tại https://spx.vn/track?SPXVN063632957159 ạ.";
  const r = gate.run(reply, {
    shopSaid: "", customerSaid: "e gửi lại tracking ạ", customerMessage: "e gửi lại tracking ạ", policy: "", hoSo: null, found: [vn], stockFacts: null,
    lookups: { orderLooked: true, tracking: { url: "https://spx.vn/track?SPXVN063632957159", code: "SPXVN063632957159" } }, links: {}, pronoun: "bác", uncertainProduct: false,
    site: "shop.example", tenShop: "Shop"
  });
  assert.match(r.reply, /https:\/\/spx\.vn\/track\?SPXVN063632957159/);
  assert.doesNotMatch(r.reply, /product\/vn06363/i);
});
