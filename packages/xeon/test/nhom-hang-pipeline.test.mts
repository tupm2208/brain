/**
 * Câu hỏi NHÓM HÀNG qua cả lượt (05/10/2026, phiếu Desk 08/09 + 30/09 + 09/09 + 07/09).
 *
 * Landing giả trả `nhomKhop` như landing thật khi Xeon hỏi `catalog.find` với `chi_nhom`. Kỳ vọng:
 * câu hỏi một nhóm → không hỏi "mẫu nào", không bám mẫu cũ, agent được chạy với ghi chú MON /
 * LOAI_HANG + link bộ lọc `?type=`/`?sport=`; câu hỏi một món chưa rõ ("áo gió sz M") → vẫn hỏi lại.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import { BrainService, ContextAnalyzer, DraftWriter, LicenseLedger, LicenseService, MemoryDossierStore, MemoryLogger, SalesAgent, generateSigningKey, type ChatMessage, type ChatModelPort, type FetchLike } from "@sp/xeon";

const T0 = Date.parse("2026-10-05T09:00:00.000Z");
const clock = { now: () => new Date(T0) };
const noSleep = async (): Promise<void> => undefined;
const AT = "2026-10-05T08:59:50.000Z";

const HARDEN = { ma: "BB1", ten: "HARDEN VOLUME 9", loai: "HANG SAN", cac_size: [{ size: "42", gia: 3000000, so_luong: 1 }], anh: "", link: "https://shop.vn/product/bb1" };
const PANT = { ma: "PT1", ten: "ESSENTIALS PANT", loai: "HANG SAN", cac_size: [{ size: "M", gia: 900000, so_luong: 2 }], anh: "", link: "https://shop.vn/product/pt1" };
const EVO = { ma: "RN2", ten: "ADIZERO EVO SL WOVEN M", loai: "HANG SAN", cac_size: [{ size: "42", gia: 3500000, so_luong: 1 }, { size: "43", gia: 3500000, so_luong: 1 }], anh: "", link: "https://shop.vn/product/rn2" };
const JACKET = { ma: "JK1", ten: "OWN THE RUN JACKET", loai: "HANG SAN", cac_size: [{ size: "M", gia: 1200000, so_luong: 1 }], anh: "", link: "https://shop.vn/product/jk1" };

function model(answers: string[]): ChatModelPort & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen, ready: () => true,
    complete: async (messages) => { seen.push(messages.map((m) => ({ ...m }))); const next = answers.shift(); return next === undefined ? { ok: false, viSao: "het", transient: true } : { ok: true, text: next, model: "gia" }; }
  };
}

const analysis = (intent: string, entities: Record<string, unknown>): string => JSON.stringify({
  intent, confidence: 0.9, entities, needProfile: { buyerType: "", experience: "", insistOnProduct: false }, needBrief: {},
  focus: { product: "", products: [], changed: false, reason: "", roles: [] }, contextSummary: "", episodeSummary: "", customerGoal: "",
  referencesPreviousMessage: false, missingInformation: [], lookupCommands: [], riskFlags: []
});

interface Options { said: string; byName: unknown[] | string; group: Record<string, unknown> | null; groupItems?: unknown[]; state?: unknown }

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
      const input = (body!["input"] ?? {}) as Record<string, unknown>;
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: [{ chieu: "den", boi: "khach", chu: o.said, soAnh: 0, luc: AT }], hoiThoai: { daChaoAi: true, theDaGui: [] } } });
      if (tool === "catalog.find") {
        if (input["chi_nhom"] === true) return reply({ ok: true, data: { ketQua: o.group ? (o.groupItems ?? []) : "KHONG tim thay", ...(o.group ? { nhomKhop: o.group } : {}) } });
        return reply({ ok: true, data: { ketQua: o.byName } });
      }
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 5000 } });
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
    finds: () => calls.filter((c) => c.path === "/api/bo-nao/cong-cu" && c.body?.["ten"] === "catalog.find").map((c) => c.body!["input"] as Record<string, unknown>)
  };
}

async function brainWith(fetch: FetchLike, analyzer: ChatModelPort, agent: ChatModelPort | null, writer: ChatModelPort | null = null) {
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
    writer: writer ? new DraftWriter({ model: writer, logger }) : null
  });
  return { brain, dossier };
}

const MESSAGE = (chu: string) => ({ tenant: "shopgia", kenh: "facebook", nguoi: "k1", chu, maHoiThoai: "facebook:k1" });

test("phiếu 08/09: 'Shop có giày bóng rổ không?' — tên kho không có chữ bóng rổ → tra theo nhóm, không hỏi 'mẫu nào', agent được biết shop CÓ môn này", async () => {
  const said = "Shop có giày bóng rổ không?";
  const l = landing({ said, byName: "KHONG tim thay san pham nao khop", group: { loai: "Giày", mon: "Bóng rổ", link: "https://shop.vn/?type=Gi%C3%A0y&sport=B%C3%B3ng%20r%E1%BB%95#products", conLai: ["shop", "co", "khong"] }, groupItems: [HARDEN] });
  const agent = model(["{\"reply\":\"Dạ bên em có giày bóng rổ Harden Volume 9 ạ\"}"]);
  const { brain, dossier } = await brainWith(l.fetch, model([analysis("ask_product_confirmation", { productName: "giày bóng rổ" })]), agent);
  const result = await brain.handleInbound(MESSAGE(said));
  assert.notEqual((result as { hanhDong?: string }).hanhDong, "ask_back", JSON.stringify(result));
  assert.equal(agent.seen.length, 1, "agent chạy");
  const system = agent.seen[0]![0]!.content;
  assert.match(system, /KHACH HOI THANG MON "Bóng rổ" — shop CO ban mon nay/);
  assert.match(system, /nhom="Giày Bóng rổ"/);
  assert.match(system, /HARDEN VOLUME 9 \(BB1\)/);
  // Mọi lần tra kho mang theo từ đời thường của ngành ("đá banh" → bóng đá).
  const probe = l.finds().find((f) => f["chi_nhom"] === true)!;
  assert.equal((probe["biDanhNhom"] as Record<string, string>)["đá banh"], "bóng đá");
  assert.equal(probe["ten"], said);
  assert.equal(dossier.last()!.suThat?.chuaChac ?? "", "");
});

test("phiếu 30/09: 'có giầy đá bóng ko em' — nhóm còn hàng hết size khách hỏi → không hỏi lại; nhóm trống → 'đang hết' + link nhóm, không 'không bán'", async () => {
  const said = "có giầy đá bóng ko em";
  const l = landing({ said, byName: "KHONG tim thay", group: { loai: "Giày", mon: "Bóng đá", link: "https://shop.vn/?type=Gi%C3%A0y&sport=B%C3%B3ng%20%C4%91%C3%A1#products", conLai: ["co", "ko"] }, groupItems: [] });
  const agent = model(["{\"reply\":\"Dạ giày bóng đá nhà em hiện đang hết hàng ạ\"}"]);
  const { brain } = await brainWith(l.fetch, model([analysis("product_advice", {})]), agent);
  await brain.handleInbound(MESSAGE(said));
  const system = agent.seen[0]![0]!.content;
  assert.match(system, /KHACH HOI LOAI HANG \(Giày Bóng đá\)/);
  assert.match(system, /\?type=Gi%C3%A0y&sport=B%C3%B3ng%20%C4%91%C3%A1#products/);
  assert.match(system, /nha em hien dang het hang/);
});

test("phiếu 09/09: 'có quần dài thể thao ko shop' đang bám một đôi giày → bỏ mẫu bám, agent trả lời theo nhóm; landing cũ (không nhomKhop) → link ?type= cho agent, mô hình chết thì câu link là lưới", async () => {
  const said = "Mình có quần dài thể thao ko shop";
  const state = { tenant: "shopgia", conversationId: "facebook:k1", turns: [], focusItemCode: "RN2" };
  const ai = () => model([analysis("product_advice", { productName: "quần dài thể thao", productType: "quần dài" })]);
  // Landing mới: đọc ra nhóm Quần áo.
  const fresh = landing({ said, byName: [EVO], group: { loai: "Quần áo", mon: "", link: "https://shop.vn/?type=Qu%E1%BA%A7n%20%C3%A1o#products", conLai: ["minh", "co", "ko", "shop"] }, groupItems: [PANT], state });
  const agent = model(["{\"reply\":\"Dạ bên em có quần dài Essentials Pant ạ\"}"]);
  const { brain } = await brainWith(fresh.fetch, ai(), agent);
  const r1 = await brain.handleInbound(MESSAGE(said));
  assert.notEqual((r1 as { hanhDong?: string }).hanhDong, "ask_back");
  const system = agent.seen[0]![0]!.content;
  assert.match(system, /KHACH HOI NHOM HANG "Quần áo"/);
  assert.doesNotMatch(system, /MẪU ĐANG NÓI TỚI[^\n]*RN2/, "không bám đôi giày cũ");
  assert.doesNotMatch(system, /TON THUC TE cua ADIZERO EVO/);
  // Landing cũ: không có nhomKhop → cổng loại hàng bỏ mẫu bám, agent vẫn chạy với link ?type=.
  const old = landing({ said, byName: [EVO], group: null, state });
  const agent2 = model(["{\"reply\":\"Dạ bên em có quần dài ạ\"}"]);
  const { brain: brain2 } = await brainWith(old.fetch, ai(), agent2);
  await brain2.handleInbound(MESSAGE(said));
  assert.equal(agent2.seen.length, 1, "agent vẫn được chạy (Desk: không bỏ qua agent cấp 2)");
  assert.match(agent2.seen[0]![0]!.content, /\?type=Qu%E1%BA%A7n%20%C3%A1o#products/);
  // Không mô hình nào trả lời được → câu link loại hàng soạn sẵn là lưới.
  const net = landing({ said, byName: [EVO], group: null, state });
  const { brain: brain3 } = await brainWith(net.fetch, ai(), model([]), null);
  await brain3.handleInbound(MESSAGE(said));
  assert.match(net.sent()[0] ?? "", /\?type=Qu%E1%BA%A7n%20%C3%A1o#products/, JSON.stringify(net.sent()));
  assert.doesNotMatch(net.sent()[0] ?? "", /ảnh hoặc tên/);
});

test("phiếu 07/09: 'áo gió chạy sz M' — tên giày có chữ M không được coi là đã tìm thấy; chữ 'gió' không phải tên nhóm → hỏi lại một lần", async () => {
  const said = "áo gió chạy sz M";
  const l = landing({ said, byName: [EVO], group: { loai: "Quần áo", mon: "", link: "https://shop.vn/?type=Qu%E1%BA%A7n%20%C3%A1o#products", conLai: ["gio"] }, groupItems: [JACKET] });
  const agent = model(["{\"reply\":\"Dạ đôi Adizero Evo SL Woven M còn size M ạ\"}"]);
  const { brain, dossier } = await brainWith(l.fetch, model([analysis("ask_size", { productName: "áo gió chạy", productType: "áo", size: "M" })]), agent);
  const result = await brain.handleInbound(MESSAGE(said));
  assert.equal((result as { hanhDong?: string }).hanhDong, "ask_back", JSON.stringify(result));
  assert.match(l.sent()[0] ?? "", /ảnh hoặc tên mẫu/);
  assert.doesNotMatch(l.sent()[0] ?? "", /EVO/i);
  assert.equal(agent.seen.length, 0);
  assert.equal(dossier.last()!.suThat?.chuaChac, "uncertain_product_ask_back:no_product");
});
