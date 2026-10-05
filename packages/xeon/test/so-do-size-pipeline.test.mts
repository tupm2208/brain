/**
 * 05/10/2026 — phiếu Desk nhóm SỐ ĐO qua cả đường đi một lượt (gói `giay-chay` thật, landing giả):
 * bước [5] đọc số đo khách + hỏi bảng size hãng (`variant.brandChart`), bước [6] ghi chú SO_DO cho
 * agent, bước [10] cổng cắt / sửa câu agent viết sai, size LLM#1 tự điền không đi vào tra kho.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import { BrainService, ContextAnalyzer, LicenseLedger, LicenseService, MemoryDossierStore, MemoryLogger, SalesAgent, generateSigningKey, type ChatMessage, type ChatModelPort, type FetchLike } from "@sp/xeon";

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
  intent: "product_advice", confidence: 0.9, entities: {}, needProfile: { buyerType: "", experience: "", insistOnProduct: false }, needBrief: { sport: "running" },
  focus: { product: "", products: [], changed: false, reason: "", roles: [] }, contextSummary: "", episodeSummary: "", customerGoal: "",
  referencesPreviousMessage: false, missingInformation: [], lookupCommands: [], riskFlags: [], ...over
});

const PUMA_CHART = {
  found: true, brand: "puma", womenDiffer: true,
  rows: [["39", 25, "6"], ["40", 25.5, "6.5"], ["40.5", 26, "7"], ["41", 26.5, "7.5"], ["42", 27, "8"], ["42.5", 27.5, "8.5"]].map(([label, link, uk]) => ({ label, link, alt: { uk } }))
};

interface Call { path: string; body: Record<string, unknown> | null }

function landing(o: { said: string; found: unknown[]; chart?: unknown; find?: (input: Record<string, unknown>) => unknown }) {
  const calls: Call[] = [];
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "catalog.find", "conversation.recent", "variant.brandChart"];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: [{ chieu: "den", boi: "khach", chu: o.said, soAnh: 0, luc: AT }], hoiThoai: { daChaoAi: true, dienThoaiDaCho: false, theDaGui: [] } } });
      if (tool === "catalog.find") return reply({ ok: true, data: o.find ? o.find(body!["input"] as Record<string, unknown>) : { ketQua: o.found } });
      if (tool === "variant.brandChart") return reply({ ok: true, data: o.chart ?? { found: false, brand: "", womenDiffer: false, rows: [] } });
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 5000 } });
      return reply({ ok: true, data: { items: [], rows: [], truncated: false, asOf: "" } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: null });
    if (u.pathname === "/api/hop-thu/gui") return reply({ ok: true, guiNgay: true, ...(body?.["anhHuongDan"] !== undefined ? { daGui: { the: [], boQua: [], linkLoc: false, phieuDatHang: false, anhHuongDan: true, chaoAi: false } } : {}) });
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  return {
    fetch, calls,
    sent: () => calls.filter((c) => c.path === "/api/hop-thu/gui").map((c) => c.body ?? {}),
    toolInputs: (name: string) => calls.filter((c) => c.path === "/api/bo-nao/cong-cu" && c.body !== null && c.body["ten"] === name).map((c) => c.body!["input"] as Record<string, unknown>)
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

const ADIZERO = [{ ma: "JH1111", ten: "ADIZERO SL 2 M", hang: "adidas", nhom: "Chạy bộ", loai: "HANG SAN", cac_size: [{ size: "42", gia: 2490000, so_luong: 2 }, { size: "42 2/3", gia: 2490000, so_luong: 1 }], anh: "", link: "https://shop.vn/product/jh1111" }];
const PUMA = [{ ma: "PU3770", ten: "PUMA VELOCITY NITRO 4", hang: "puma", nhom: "Chạy bộ", loai: "HANG SAN", cac_size: [{ size: "40", gia: 2990000, so_luong: 1 }, { size: "41", gia: 2990000, so_luong: 2 }], anh: "", link: "https://shop.vn/product/pu3770" }];

test("phiếu 26/09 qua đường đi: chỉ báo dài chân (giày chạy) → ghi chú cấm nêu size; agent lỡ nêu thì cổng cắt + xin 3 thông số + ảnh hướng dẫn; size LLM#1 tự điền không vào tra kho", async () => {
  const said = "chân dài 25cm, chạy 5-10km, tìm giày chạy adidas adizero";
  const site = landing({ said, found: ADIZERO });
  // LLM#1 "helpfully" fills a size the customer never said (it added half a size for the long runs).
  const analyzer = scriptedModel([analysis({ entities: { brand: "adidas", productName: "adizero", size: "42 2/3" } })]);
  const agent = scriptedModel(["{\"reply\":\"Dạ chân 25cm chạy 5-10km thì anh đi size 42 2/3 (tem 27cm) là vừa ạ. Mẫu Adizero SL 2 bên em còn size 42 và 42 2/3 ạ.\"}"]);
  const { brain, dossier } = await brainWith(site.fetch, analyzer, agent);
  const result = await brain.handleInbound({ tenant: "shopgiay", kenh: "facebook", nguoi: "k1", chu: said, maHoiThoai: "facebook:k1" });
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  const system = agent.seen[0]![0]!.content;
  assert.match(system, /CHUA DU SO DO CHAN/, "the agent is told no size yet");
  for (const input of site.toolInputs("catalog.find")) assert.notEqual(input["size"], "42 2/3", "LLM#1's invented size is not looked up");
  const sent = site.sent()[0]!;
  const text = String(sent["chu"]);
  assert.doesNotMatch(text, /42 2\/3 \(tem/, "the conversion clause is cut");
  assert.match(text, /3 thông số/);
  assert.match(text, /còn size 42 và 42 2\/3/, "the stock sentence stays");
  assert.equal(sent["anhHuongDan"], "do-chan", "the measuring guide rides with the ask");
  assert.ok(dossier.last()!.cong!.dauVet.some((t) => t.startsWith("size_needs_measures")), dossier.last()!.cong!.dauVet.join(","));
});

test("phiếu 01/09 + 26/09 qua đường đi: đủ 3 số đo, mẫu Puma → bảng hãng từ landing; ghi chú size 41 (tem 26,5); cặp sai trong câu agent được sửa", async () => {
  const said = "chân 25cm, rộng 10.3cm, chu vi 24.9cm, puma velocity nitro 4 chạy bộ";
  const site = landing({ said, found: PUMA, chart: PUMA_CHART });
  const analyzer = scriptedModel([analysis({ entities: { brand: "puma", productName: "velocity nitro 4" } })]);
  const agent = scriptedModel(["{\"reply\":\"Dạ chân 25cm thì anh đi size 43 (tem 25.5cm) ạ. Mẫu Velocity Nitro 4 size 40 (UK 6.5) bên em còn ạ.\"}"]);
  const { brain } = await brainWith(site.fetch, analyzer, agent);
  const result = await brain.handleInbound({ tenant: "shopgiay", kenh: "facebook", nguoi: "k1", chu: said, maHoiThoai: "facebook:k1" });
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  assert.deepEqual(site.toolInputs("variant.brandChart")[0], { brand: "puma" });
  assert.match(agent.seen[0]![0]!.content, /size 41 \(tem 26,5cm\)/);
  const text = String(site.sent()[0]!["chu"]);
  assert.match(text, /chân 25cm thì anh đi size 41 \(tem 26,5cm\)/, text);
  assert.match(text, /size 40 \(UK 6\.5\) bên em còn/, "the stock sentence keeps its own (right) pair");
});

// =====================================================================================================
// Bổ sung 05/10/2026 — phiếu 22/09 "size 2x trần là cm tem": số tem đi NGUYÊN ("25cm") xuống công cụ tra kho,
// landing quy theo bảng của HÃNG từng món; bảng ngành chỉ là lưới khi hãng chưa có bảng (nói rõ là quy đổi chung).
// =====================================================================================================

const NIKE_CHART = {
  found: true, brand: "nike", womenDiffer: false,
  rows: [["39", 24.5, "5.5"], ["40", 25, "6"], ["40.5", 25.5, "6.5"], ["41", 26, "7"]].map(([label, link, uk]) => ({ label, link, alt: { uk } }))
};
const item = (ma: string, ten: string, hang: string, sizes: { size: string; quy_doi?: string }[]) => ({
  ma, ten, hang, nhom: "Chạy bộ", loai: "HANG SAN", anh: "", link: `https://shop.vn/product/${ma.toLowerCase()}`,
  cac_size: sizes.map((s) => ({ ...s, gia: 2990000, so_luong: 1 }))
});
const agentSaid = (text: string) => scriptedModel([`{"reply":"${text}"}`]);

async function tagTurn(said: string, brand: string, name: string, find: (input: Record<string, unknown>) => unknown, chart: unknown, reply: string) {
  const site = landing({ said, found: [], chart, find });
  const analyzer = scriptedModel([analysis({ entities: { brand, productName: name } })]);
  const agent = agentSaid(reply);
  const { brain } = await brainWith(site.fetch, analyzer, agent);
  const result = await brain.handleInbound({ tenant: "shopgiay", kenh: "facebook", nguoi: "k1", chu: said, maHoiThoai: "facebook:k1" });
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  const sizes = site.toolInputs("catalog.find").map((i) => String(i["size"] ?? ""));
  return { site, system: agent.seen[0]![0]!.content, sizes, text: String(site.sent()[0]!["chu"]) };
}

test("size 25 trần, mẫu PUMA: tra kho bằng \"25cm\", landing quy theo bảng Puma = 39; ghi chú size 39 (tem 25cm), không có size 40", async () => {
  const r = await tagTurn("puma velocity nitro 4 size 25 nhé", "puma", "velocity nitro 4",
    (i) => ({ ketQua: i["size"] === "25cm" ? [item("PU3770", "PUMA VELOCITY NITRO 4", "puma", [{ size: "39", quy_doi: "25cm" }])] : [] }),
    PUMA_CHART, "Dạ mẫu Velocity Nitro 4 size 39 (tem 25cm) bên em còn ạ.");
  assert.equal(r.sizes[0], "25cm", r.sizes.join("|"));
  assert.ok(!r.sizes.includes("40"), "never looked up by the industry label");
  assert.match(r.system, /SIZE CUA KHACH[^\n]*size 39\b[^\n]*size="39"[^\n]*\(tem 25cm\)/);
  assert.doesNotMatch(r.system, /SIZE CUA KHACH[^\n]*size 40\b/);
  assert.doesNotMatch(r.system, /QUY DOI CHUNG/);
  assert.match(r.text, /size 39 \(tem 25cm\)/);
});

test("size 25 trần, mẫu PUMA HẾT size đó: landing không trả món — bộ não hỏi bảng Puma, vẫn là size 39, không tra lại bằng 40", async () => {
  const r = await tagTurn("puma velocity nitro 4 size 25", "puma", "velocity nitro 4",
    (i) => ({ ketQua: i["size"] === "25cm" ? "HET SIZE 25cm: co 1 mau khop dieu kien khac nhung KHONG mau nao con dung size nay" : [] }),
    PUMA_CHART, "Dạ mẫu này bên em đang hết size 39 (tem 25cm) ạ.");
  assert.equal(r.sizes[0], "25cm");
  assert.ok(!r.sizes.includes("40"), r.sizes.join("|"));
  assert.match(r.system, /SIZE CUA KHACH[^\n]*size 39\b/);
});

test("size 25 trần, mẫu NIKE: bảng Nike = 40", async () => {
  const r = await tagTurn("nike pegasus 41 size 25", "nike", "pegasus 41",
    (i) => ({ ketQua: i["size"] === "25cm" ? [item("FD2722", "NIKE PEGASUS 41", "nike", [{ size: "40", quy_doi: "25cm" }])] : [] }),
    NIKE_CHART, "Dạ Pegasus 41 size 40 (tem 25cm) bên em còn ạ.");
  assert.equal(r.sizes[0], "25cm");
  assert.match(r.system, /SIZE CUA KHACH[^\n]*size 40\b/);
  assert.doesNotMatch(r.system, /QUY DOI CHUNG/);
});

const NO_CHART_FIND = (i: Record<string, unknown>) => ({ ketQua: i["size"] === "25cm" ? "CHUA SO DUOC SIZE 25cm: co 1 mau khop nhung kho ghi size theo HE KHAC va hang chua co bang quy doi size tren he thong"
  : i["size"] === "40" ? [item("HK1127", "HOKA CLIFTON 9", "hoka", [{ size: "40" }])] : [] });
const NO_CHART = { found: false, brand: "", womenDiffer: false, rows: [] };

test("size 25 trần, hãng đã nêu CHƯA có bảng: không tra bằng tem (kho cũng không quy được) → lưới bảng ngành (40), ghi chú nói rõ quy đổi chung", async () => {
  const r = await tagTurn("hoka clifton 9 size 25", "hoka", "clifton 9", NO_CHART_FIND, NO_CHART, "Dạ Clifton 9 size 40 bên em còn ạ.");
  assert.equal(r.sizes[0], "40", r.sizes.join("|"));
  assert.ok(!r.sizes.includes("25cm"));
  assert.match(r.system, /SIZE CUA KHACH[^\n]*size 40\b[^\n]*QUY DOI CHUNG[^\n]*hang hoka/);
  assert.match(r.system, /KHONG khang dinh size/);
});

test("size 25 trần, CHƯA biết hãng (chỉ mã): tra bằng tem, kho báo chưa so được → tra lại bằng nhãn bảng ngành, biết hãng, hãng không có bảng → quy đổi chung", async () => {
  const r = await tagTurn("HK1127 size 25", "", "", NO_CHART_FIND, NO_CHART, "Dạ mẫu này size 40 bên em còn ạ.");
  assert.equal(r.sizes[0], "25cm", r.sizes.join("|"));
  assert.ok(r.sizes.includes("40"), r.sizes.join("|"));
  assert.match(r.system, /SIZE CUA KHACH[^\n]*size 40\b[^\n]*QUY DOI CHUNG/);
});
