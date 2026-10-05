/**
 * 05/10/2026 — BỎ Ô "CÓ HÀNG ORDER" (banHang.coHangOrder) KHỎI HỒ SƠ SHOP.
 *
 * Nguyên tắc: có bán hàng order hay không là SỰ THẬT của dữ liệu kho (loại kho + tồn), không phải ô
 * khai tay trong hồ sơ shop; bot chỉ đọc loại kho và chính sách của kho dự kiến xuất. Ca thật: một shop
 * khai "không bán order" trong khi mọi kho của shop là kho order → bot báo "hết hàng" sai.
 *
 * Tầng 1 thử bằng ngành NHÀ THUỐC + shop giả (cơ chế không phụ thuộc giày). Tầng 3: hồ sơ đã khai điều
 * kiện chung lẫn hồ sơ trống.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import {
  BrainService, LicenseLedger, LicenseService, MemoryLogger, SalesAgent, generateSigningKey, readShopProfileBundle,
  type ChatModelPort, type FetchLike
} from "@sp/xeon";
import type { PackAgent, ToolPort } from "@sp/brain";

const T0 = Date.parse("2026-10-05T09:00:00.000Z");
const clock = { now: () => new Date(T0) };
const ago = (minutes: number): string => new Date(T0 - minutes * 60_000).toISOString();
const noSleep = async (): Promise<void> => undefined;

/** An old profile still carrying the retired switch, set to "no", plus general order terms. */
const OLD_PROFILE = {
  xungHo: { khach: "cô", shop: "em" },
  banHang: { coHangOrder: "khong", thoiGianOrder: "về sau vài hôm", tiLeCoc: 30, codHangSan: "co" },
  nguon: { "xungHo.khach": "shop", "banHang.coHangOrder": "shop", "banHang.thoiGianOrder": "shop", "banHang.tiLeCoc": "shop" }
};
/** Every warehouse of the shop is an order warehouse, and the item found is order goods. */
const ORDER_KHO = [{ ma: "kho-dat", ten: "Kho đặt", loai: "order", uuTien: 1, chinhSach: "" }];
const ORDER_ITEM = [{ ma: "SP01", ten: "SAN PHAM GIA A", loai: "HANG ORDER", cac_size: [{ size: "hop 10", gia: 120000, dieu_kien: "hàng order: đặt theo đơn" }], anh: "", link: "https://shop-gia.vn/p/sp01" }];

interface Call { path: string; body: Record<string, unknown> | null }

function fakeLanding(hoSo: Record<string, unknown>) {
  const calls: Call[] = [];
  const tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "storefront.link", "catalog.find", "conversation.recent", "shop.profile"];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, body });
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && init.method === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (tool === "conversation.recent") return reply({ ok: true, data: { tin: [{ chieu: "den", boi: "khach", chu: QUESTION, soAnh: 0, luc: ago(0.5) }], hoiThoai: { daChaoAi: true, dienThoaiDaCho: false, theDaGui: [] } } });
      if (tool === "shop.profile") return reply({ ok: true, data: { hoSo, chinhSach: { doiTra: "", ship: "", baoHanh: "" }, kho: ORDER_KHO } });
      if (tool === "catalog.find") return reply({ ok: true, data: { ketQua: ORDER_ITEM } });
      if (tool === "policy.get") return reply({ ok: true, data: { found: false, text: "", updatedAt: "" } });
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 50 } });
      return reply({ ok: true, data: { items: [], rows: [], truncated: false, asOf: "" } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) return reply({ ok: true, trangThai: null });
    if (u.pathname === "/api/hop-thu/gui") return reply({ ok: true, guiNgay: true });
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  return {
    fetch,
    finds: () => calls.filter((c) => c.path === "/api/bo-nao/cong-cu" && c.body?.["ten"] === "catalog.find").map((c) => (c.body!["input"] ?? {}) as Record<string, unknown>)
  };
}

function scriptedModel(answers: string[]): ChatModelPort & { seen: { role: string; content: string }[][] } {
  const seen: { role: string; content: string }[][] = [];
  return {
    seen, ready: () => true,
    complete: async (messages: { role: string; content: string }[]) => {
      seen.push(messages);
      const next = answers.shift();
      return next === undefined ? { ok: false, viSao: "het", transient: true } : { ok: true, text: next, model: "gia" };
    }
  } as never;
}

async function brainFor(landing: { fetch: FetchLike }, agent: ChatModelPort) {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "shop-gia", tenShop: "Shop Giả", nganh: "nha-thuoc", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop-gia.vn" });
  const logger = new MemoryLogger();
  return new BrainService({ license, fetch: landing.fetch, logger, clock, sleep: noSleep, agent: new SalesAgent({ model: agent, logger, clock, sleep: noSleep }) });
}

const QUESTION = "còn san pham gia A không ạ";
const MESSAGE = { tenant: "shop-gia", kenh: "facebook", nguoi: "k1", chu: QUESTION, maHoiThoai: "facebook:k1", luc: ago(0.5) };

/** A tool port that opens nothing: `policyText` then reads the profile bundle only. */
const NO_TOOLS = { available: () => [], call: async () => ({ ok: false, error: { code: "khong_mo", message: "" } }) } as unknown as ToolPort;
const bindingOf = (tools: ToolPort) => ({ gateway: { tools } }) as never;

test("tầng 1 (ngành giả, shop giả): hồ sơ cũ ghi 'không bán order' + mọi kho là kho order → lời dặn KHÔNG cấm order, agent KHÔNG bị ép chỉ hàng sẵn", async () => {
  // A made-up industry (not shoes): one block, one stock tool. The mechanism must not depend on any industry.
  const agentPack: PackAgent = {
    khoi: [{ id: "tu-van", tieuDe: "Tu van", shopSua: true, loiDan: "- Tra kho truoc khi bao con hay het." }],
    mauHoSo: { goiY: {}, chinhSach: { doiTra: "", ship: "", baoHanh: "" } },
    mustHumanPattern: "", handoffReplyPattern: "",
    tools: [{ name: "tra_kho", handler: "landing", landingMethod: "findStock", moTa: "{\"tool\":\"tra_kho\",\"args\":{\"ten\":\"...\",\"chi_hang_san\":true|false}} — tim hang trong kho." }]
  };
  const bundle = readShopProfileBundle({ hoSo: OLD_PROFILE, chinhSach: { doiTra: "", ship: "", baoHanh: "" }, kho: ORDER_KHO });
  const model = scriptedModel(["{\"tool\":\"tra_kho\",\"args\":{\"ten\":\"san pham gia A\"}}", "{\"reply\":\"Dạ mẫu này bên em đang đặt được ạ\"}"]);
  const finds: Record<string, unknown>[] = [];
  const tools = { findStock: async (args: Record<string, unknown>) => { finds.push(args); return ORDER_ITEM; }, policy: async () => "", bankAccount: async () => null };
  const outcome = await new SalesAgent({ model, logger: new MemoryLogger(), clock, sleep: noSleep }).run({
    agent: agentPack, site: "https://shop-gia.vn", history: [{ who: "khach", text: QUESTION, images: 0 }], tools: tools as never, hoSo: bundle.hoSo, chinhSach: bundle.chinhSach
  } as never);
  assert.ok(model.seen.length > 0, JSON.stringify(outcome));
  const system = model.seen[0]![0]!.content;
  assert.doesNotMatch(system, /KHONG ban hang order/i);
  assert.doesNotMatch(system, /chi tu van hang co san/i, "no profile switch hides the stock's order goods");
  assert.match(system, /HANG ORDER: hang san hay hang order la theo KET QUA tra_kho/);
  assert.match(system, /dieu kien chung cua shop: thoi gian: về sau vài hôm; coc truoc toi thieu 30%/, "the general order terms still reach the bot, without the switch");
  assert.ok(finds.length > 0, "the agent looked the stock up");
  for (const input of finds) assert.notEqual(input["chi_hang_san"], true, `no ready-only lookup forced: ${JSON.stringify(input)}`);
});

test("tầng 1: policyText không còn dòng 'Shop khong ban hang order'; điều kiện chung order nói khi có giá trị, không phụ thuộc ô cũ", async () => {
  const brain = await brainFor(fakeLanding(OLD_PROFILE), scriptedModel([]));
  const policy = await brain.policyText(bindingOf(NO_TOOLS), readShopProfileBundle({ hoSo: OLD_PROFILE, chinhSach: { doiTra: "", ship: "", baoHanh: "" }, kho: ORDER_KHO }));
  assert.doesNotMatch(policy, /khong ban hang order/i);
  assert.match(policy, /Hang order \(dieu kien chung, khi kho order khong khai chinh sach rieng\): thoi gian về sau vài hôm; coc toi thieu 30%\./);
  // An old profile saying "yes" with nothing else: no invented order terms.
  const yesOnly = await brain.policyText(bindingOf(NO_TOOLS), readShopProfileBundle({ hoSo: { banHang: { coHangOrder: "co" } } }));
  assert.doesNotMatch(yesOnly, /Hang order/);
  assert.match(yesOnly, /SHOP CHUA KHAI CHINH SACH/);
});

test("tầng 3: hồ sơ trống → không dòng điều kiện chung order, không ghi 'hàng order' vào CHUA KHAI; hồ sơ cũ đọc lên rơi ô coHangOrder (cả dấu nguồn)", async () => {
  const empty = readShopProfileBundle({ hoSo: {} });
  const brain = await brainFor(fakeLanding({}), scriptedModel([]));
  assert.doesNotMatch(await brain.policyText(bindingOf(NO_TOOLS), empty), /Hang order/);
  const old = readShopProfileBundle({ hoSo: OLD_PROFILE });
  assert.ok(!("coHangOrder" in old.hoSo.banHang));
  assert.equal(old.hoSo.nguon["banHang.coHangOrder"], undefined);
  assert.equal(old.hoSo.nguon["banHang.tiLeCoc"], "shop");
  assert.equal(old.hoSo.banHang.tiLeCoc, 30);
});
