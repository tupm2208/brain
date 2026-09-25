/**
 * LLM#1 context analysis (Sales Desk `analyzeConversationContext`, moved to Xeon 24/09/2026): the
 * prompt is data from two tiers, the call is temperature 0 in JSON mode, the answer is checked and
 * a broken one is `null` so the router still runs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ContextAnalyzer, MemoryLogger, readContextAnalysis, renderLabelledHistory,
  type ChatCallOptions, type ChatMessage, type ChatModelPort, type ContextAnalysisInput, type HistoryLine
} from "@sp/xeon";
import { loadContextAnalysisText, loadHumanExamples, loadDraftText } from "@sp/brain";
import "./industries.mts";

/** A model that answers from a script, recording what it was shown and how it was called. */
function scriptedModel(answers: (string | Error)[]): ChatModelPort & { seen: ChatMessage[][]; options: ChatCallOptions[] } {
  const seen: ChatMessage[][] = [];
  const options: ChatCallOptions[] = [];
  return {
    seen, options,
    ready: () => true,
    complete: async (messages, opts) => {
      seen.push(messages.map((m) => ({ ...m })));
      options.push(opts ?? {});
      const next = answers.shift();
      if (next === undefined || next instanceof Error) return { ok: false, viSao: next?.message ?? "het kich ban", transient: true };
      return { ok: true, text: next, model: "gia" };
    }
  };
}

const TEXT = loadContextAnalysisText("giay-chay");

const HISTORY: HistoryLine[] = [
  { who: "khach", text: "shop còn Boston 13 không", images: 0, at: "2026-09-24T10:00:00.000Z" },
  { who: "nguoi", text: "Dạ còn size 44 bác nhé, giá 3.290.000đ", images: 0, at: "2026-09-24T10:01:00.000Z" },
  { who: "bot", text: "Dạ bên em hỗ trợ đổi size thoải mái ạ", images: 0, at: "2026-09-24T10:02:00.000Z" },
  { who: "khach", text: "đổi sang 44 2/3 nhé", images: 0, at: "2026-09-24T10:03:00.000Z" }
];

function input(model: ChatModelPort, extra: Partial<ContextAnalysisInput> = {}): ContextAnalysisInput {
  void model;
  return {
    turn: { history: HISTORY, burstText: "đổi sang 44 2/3 nhé", replyNote: "", focusedProduct: { code: "JP9252", name: "ADIZERO BOSTON 13 M", by: "human_page" } },
    memoryText: "KHACH: size 44 (da xac nhan 10:01)",
    text: TEXT,
    site: "https://shop.vn",
    shopName: "Shop Giay",
    usage: { shop: "shop-giay", channel: "facebook", conversationId: "hoi-thoai-1" },
    nowIso: "2026-09-24T10:03:30.000Z",
    ...extra
  };
}

const GOOD = JSON.stringify({
  intent: "ask_size", confidence: 0.9,
  entities: { brand: "adidas", productLine: "Adizero Boston", modelVersion: "13", productType: "giay", size: "44 2/3", color: "" },
  needProfile: { buyerType: "perf", experience: "unknown", insistOnProduct: false },
  needBrief: { sport: "running", knownSize: "44 2/3", readyToBuy: false, missingCritical: [] },
  focus: { product: "JP9252", products: ["JP9252"], changed: false, reason: "khach van hoi Boston 13", roles: [{ product: "JP9252", role: "shop_goi_y" }] },
  contextSummary: "Khach doi size Boston 13 sang 44 2/3", episodeSummary: "Hoi Boston 13, nguoi truc bao con 44, khach doi 44 2/3",
  customerGoal: "mua Boston 13 size 44 2/3", referencesPreviousMessage: true, missingInformation: [],
  lookupCommands: [{ command: "resolve_stock", args: { productCode: "JP9252", size: "44 2/3" } }, { command: "khong_co_lenh_nay", args: {} }],
  riskFlags: []
});

test("tep JSON hai tang nap duoc: khoi tang 1 truoc, khoi nganh sau, schema gop khoa cua ca hai", () => {
  assert.ok(TEXT.khoi.some((b) => b.id === "tac-gia-tin-page"), "tier 1 block");
  assert.ok(TEXT.khoi.some((b) => b.id === "chan-dung-nhu-cau"), "industry block");
  assert.ok(TEXT.khoi.findIndex((b) => b.id === "tac-gia-tin-page") < TEXT.khoi.findIndex((b) => b.id === "chan-dung-nhu-cau"));
  assert.equal(TEXT.schema.entities["size"], "", "tier 1 key");
  assert.equal(TEXT.schema.entities["productLine"], "", "industry key");
  assert.equal(TEXT.schema.needBrief["pace"], "", "industry need brief");
  assert.ok(TEXT.yDinh.includes("payment_confirmation"));
  assert.ok(Object.keys(TEXT.lenhTraCuu).includes("resolve_stock"));
  // The draft text and the examples load from the same folder (used by draft-writer.test.mts).
  assert.ok(loadDraftText("giay-chay").luat.length > 20);
  assert.ok((loadHumanExamples("giay-chay")["hoi_size_ton"] ?? []).length >= 8);
});

test("khong ten rieng cua TopRun trong JSON prompt: site/ten shop/coc/so ngay la cho trong", () => {
  const all = JSON.stringify([TEXT, loadDraftText("giay-chay"), loadHumanExamples("giay-chay")]);
  for (const forbidden of ["toprun", "anh Dung", "anh Dũng", "3-7 ngày", "3-7 ngay", "20%", "50%"]) {
    assert.ok(!all.toLowerCase().includes(forbidden.toLowerCase()), `khong duoc chua "${forbidden}"`);
  }
  assert.match(all, /\{banHang\.tiLeCoc\}/);
  assert.match(all, /\{banHang\.thoiGianOrder\}/);
});

test("JSON dung → du truong; lenh la bi bo, toi da 3 lenh; tin moi nhat thang size ho so", async () => {
  const model = scriptedModel([GOOD]);
  const analyzer = new ContextAnalyzer({ model, logger: new MemoryLogger() });
  const out = await analyzer.analyze(input(model), 5000);
  assert.ok(out !== null);
  assert.equal(out.intent, "ask_size");
  assert.equal(out.confidence, 0.9);
  assert.equal(out.entities["size"], "44 2/3", "the size of the NEWEST message, not the ledger's 44");
  assert.equal(out.entities["productLine"], "Adizero Boston");
  assert.equal(out.needProfile.buyerType, "perf");
  assert.equal(out.needBrief["sport"], "running");
  assert.deepEqual(out.focus.products, ["JP9252"]);
  assert.equal(out.focus.roles[0]?.role, "shop_goi_y");
  assert.deepEqual(out.lookupCommands, [{ command: "resolve_stock", args: { productCode: "JP9252", size: "44 2/3" } }], "unknown command dropped");
  assert.equal(out.referencesPreviousMessage, true);

  // The prompt told the model so, and showed it the ledger's old size beside the new message.
  const user = model.seen[0]![1]!.content;
  assert.match(user, /entities\.size PHAI theo tin moi nhat/);
  assert.match(user, /size 44 \(da xac nhan/);
  assert.match(user, /Tin moi: "đổi sang 44 2\/3 nhé"/);
});

test("JSON hong → null (router van chay); mo hinh loi → null; khong intent → null", async () => {
  const broken = scriptedModel(["em nghĩ là khách muốn đổi size"]);
  assert.equal(await new ContextAnalyzer({ model: broken, logger: new MemoryLogger() }).analyze(input(broken)), null);
  const dead = scriptedModel([new Error("gateway 524")]);
  const logger = new MemoryLogger();
  assert.equal(await new ContextAnalyzer({ model: dead, logger }).analyze(input(dead)), null);
  assert.ok(logger.warnings.some((w) => /524/.test(w)));
  assert.equal(readContextAnalysis({ confidence: 1 }, TEXT.yDinh, []), null);
  // An intent outside the list is read as unknown, not thrown away.
  assert.equal(readContextAnalysis({ intent: "bay_len_troi" }, TEXT.yDinh, [])?.intent, "unknown");
});

test("prompt: nhan PAGE (bot) / PAGE (nguoi truc) / KHACH, loi nguoi truc tach loi bot, khung + SP ngoai + chan dung + DNA co mat", () => {
  const model = scriptedModel([]);
  const messages = ContextAnalyzer.composePrompt(input(model, {
    frameText: "page vừa HỎI SIZE (về mẫu Boston 13) → khách ĐANG TRẢ LỜI SIZE",
    externalProduct: { ten: "Ao CLB", gia: 350000 },
    customerPortrait: "lastOrder: Pegasus 41 size 43 (thang truoc)",
    lineDna: "Adizero Boston: super trainer, thanh Energy Rods"
  }));
  assert.equal(messages[0]!.role, "system");
  assert.match(messages[0]!.content, /Chi tra JSON/);
  const user = messages[1]!.content;
  assert.match(user, /\[24\/09 \d\d:00\] KHACH: shop còn Boston 13 không/);
  assert.match(user, /PAGE \(nguoi truc\): Dạ còn size 44 bác nhé/);
  assert.match(user, /PAGE \(bot\): Dạ bên em hỗ trợ đổi size/);
  // What the page said, split by author: the person's line under the "truth" label, the bot's under "not truth".
  const humanAt = user.indexOf("LOI NGUOI TRUC (NGUOI THAT) DA NOI TRUOC DO");
  const botAt = user.indexOf("CAU PAGE DA GUI TRUOC DO, CHUA CHAC DO NGUOI THAT GO");
  assert.ok(humanAt > 0 && botAt > humanAt);
  assert.ok(user.slice(humanAt, botAt).includes("Dạ còn size 44 bác nhé"));
  assert.ok(user.slice(botAt).includes("hỗ trợ đổi size"));
  assert.match(user, /KHUNG HOI THOAI .*page vừa HỎI SIZE/);
  assert.match(user, /SP NGOAI HE THONG khach DA CHOT .*"Ao CLB"/);
  assert.match(user, /CHAN DUNG KHACH TU DON CU .*Pegasus 41/);
  assert.match(user, /DNA DONG GIAY .*\nAdizero Boston: super trainer/);
  assert.match(user, /"productLine":""/, "the schema carries the industry's keys");
  assert.match(user, /Chi trich xuat yeu cau de Shop Giay tra cuu/, "{tenShop} filled");
  assert.match(user, /San pham dang tap trung: \{"code":"JP9252"/);
});

test("goi mo hinh: temperature 0, json:true, timeout theo ngan sach nhung khong qua tran (15s, hoac XEON_AI_PHAN_TICH_MS); withUsage khong lam hong", async () => {
  const model = scriptedModel([GOOD, GOOD]);
  const analyzer = new ContextAnalyzer({ model, logger: new MemoryLogger() });
  await analyzer.analyze(input(model), 4000);
  await analyzer.analyze(input(model), 60_000);
  assert.deepEqual(model.options[0], { temperature: 0, json: true, timeoutMs: 4000 });
  assert.deepEqual(model.options[1], { temperature: 0, json: true, timeoutMs: 15_000 });
  // The ceiling is the operator's (`XEON_AI_PHAN_TICH_MS`): 12 s timed out four turns in twenty on the real gateway.
  const strict = scriptedModel([GOOD]);
  await new ContextAnalyzer({ model: strict, logger: new MemoryLogger(), timeoutMs: 9000 }).analyze(input(strict), 60_000);
  assert.equal(strict.options[0]!.timeoutMs, 9000);
});

test("renderLabelledHistory: moc PHIEN MOI sau 6 gio, anh cu danh dau CU, ghi chu reply gan vao dong", () => {
  const text = renderLabelledHistory([
    { who: "khach", text: "[khách gửi ảnh]", images: 1, at: "2026-09-23T08:00:00.000Z" },
    { who: "khong_ro", text: "Dạ mẫu này 2tr ạ", images: 0, at: "2026-09-23T08:01:00.000Z" },
    { who: "khach", text: "còn không", images: 0, at: "2026-09-24T10:00:00.000Z", note: "KHÁCH ĐANG TRẢ LỜI (reply) VÀO TIN CỦA PAGE" }
  ], "2026-09-24T10:00:30.000Z");
  assert.match(text, /KHACH: \[khách gửi ảnh\] \[khach gui 1 anh CU\]/);
  assert.match(text, /PAGE \(khong ro bot hay nguoi\): Dạ mẫu này 2tr ạ/);
  assert.match(text, /--- PHIEN MOI \(cach 26 gio\) ---/);
  assert.match(text, /còn không \[GHI CHU HE THONG: KHÁCH ĐANG TRẢ LỜI/);
});
