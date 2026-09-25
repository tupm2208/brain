/**
 * LLM#3 fallback draft (Sales Desk `draftAIFallback` / lean prompt, moved to Xeon 24/09/2026): the
 * core rules are always in, the situation rules only when the turn is in that situation, the
 * examples follow the intent, and a broken answer becomes the hand-over sentence from the JSON.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DraftWriter, MemoryLogger,
  type ChatCallOptions, type ChatMessage, type ChatModelPort, type DraftInput, type HistoryLine
} from "@sp/xeon";
import { loadDraftText, loadHumanExamples } from "@sp/brain";
import { emptyShopProfile } from "@sp/contract";
import "./industries.mts";

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

const TEXT = loadDraftText("giay-chay");
const EXAMPLES = loadHumanExamples("giay-chay");

const HISTORY: HistoryLine[] = [
  { who: "khach", text: "shop còn Boston 13 size 42 không", images: 0, at: "2026-09-24T10:00:00.000Z" },
  { who: "bot", text: "Dạ để em kiểm tra ạ", images: 0, at: "2026-09-24T10:00:10.000Z" },
  { who: "khach", text: "size 42 nhé", images: 0, at: "2026-09-24T10:01:00.000Z" }
];

function input(extra: Partial<DraftInput> = {}): DraftInput {
  const hoSo = emptyShopProfile();
  hoSo.xungHo = { khach: "bác", shop: "em" };
  hoSo.banHang.coHangOrder = "co";
  hoSo.banHang.tiLeCoc = 30;
  hoSo.banHang.thoiGianOrder = "5–9 ngày";
  hoSo.nguon = { "xungHo.khach": "shop", "banHang.coHangOrder": "shop", "banHang.tiLeCoc": "shop", "banHang.thoiGianOrder": "shop" };
  return {
    turn: { history: HISTORY, burstText: "size 42 nhé", replyNote: "", focusedProduct: { code: "JP9252", name: "ADIZERO BOSTON 13 M", by: "human_page" } },
    intent: "ask_size",
    facts: { catalog: [{ code: "JP9252", name: "ADIZERO BOSTON 13 M", brand: "adidas", price: 3290000, sizes: ["42"] }] },
    text: TEXT,
    examples: EXAMPLES,
    site: "https://shop.vn",
    shopName: "Shop Giay",
    hoSo,
    usage: { shop: "shop-giay", channel: "facebook", conversationId: "hoi-thoai-1" },
    nowIso: "2026-09-24T10:01:30.000Z",
    ...extra
  };
}

/** The ids of the rules in the prompt's rule section (before the schema line; the guardrails number their own lines). */
const ruleIds = (user: string): Set<string> => new Set([...user.slice(0, user.indexOf("Tra ve JSON hop le theo schema")).matchAll(/^([0-9]+[a-z]?)\. /gm)].map((m) => m[1]!));

test("luat loi (LEAN_CORE) luon co mat; luat tinh huong chi khi dung ca; guardrails loc theo muc va co tieu de", () => {
  const plain = DraftWriter.composePrompt(input())[1]!.content;
  const ids = ruleIds(plain);
  for (const core of ["1a", "1b", "1c", "1d", "1f", "1g", "7", "8", "9", "20", "21", "25", "34", "39", "41", "42", "45"]) assert.ok(ids.has(core), `luat loi ${core}`);
  assert.ok(ids.has("49"), "chua chot → cam thuc ep");
  assert.ok(!ids.has("5") && !ids.has("27") && !ids.has("30") && !ids.has("48"), "situation rules stay out");
  assert.match(plain, /## Nguyen tac dieu phoi/);
  assert.match(plain, /## Quy tac doc ten san pham va size/, "industry guardrail always on");
  assert.doesNotMatch(plain, /## Tennis \/ Pickleball/);
  assert.match(plain, /XUNG HO BAT BUOC: goi khach la "bác", shop xung "em"/);
  assert.match(plain, /PAGE \(bot\): Dạ để em kiểm tra ạ/);
  assert.match(plain, /Catalog ung vien: \[\{"code":"JP9252"/);

  // Closing on order stock with a cascade, a tennis need and a greeting: the matching rules come in.
  const closing = DraftWriter.composePrompt(input({
    intent: "place_order", stage: "chot",
    analysis: { intent: "place_order", confidence: 1, entities: {}, needProfile: { buyerType: "", experience: "", insistOnProduct: false }, needBrief: { sport: "tennis", readyToBuy: true }, focus: { product: "JP9252", products: [], changed: false, reason: "", roles: [] }, contextSummary: "Khach chot Boston 13 size 42", episodeSummary: "", customerGoal: "mua Boston 13", referencesPreviousMessage: false, missingInformation: [], lookupCommands: [], riskFlags: [] },
    facts: { catalog: [], stockFacts: { requestedSize: "42", stock: null, stockType: "order", variantsAvailable: [{ code: "JP9253" }] }, stockCascade: { resolvedLevel: "same_line_same_version" } }
  }))[1]!.content;
  const closingIds = ruleIds(closing);
  for (const id of ["5", "13", "23", "43", "27", "48", "6", "15", "26", "1e", "10"]) assert.ok(closingIds.has(id), `luat tinh huong ${id}`);
  assert.ok(!closingIds.has("49"), "dang chot → khong nap luat cam thuc ep");
  assert.match(closing, /## Tennis \/ Pickleball/);
  // Rule 48 speaks the shop's numbers through the profile, never its own.
  assert.match(closing, /thoi gian: 5–9 ngày/);
  assert.match(closing, /toi thieu 30% gia tri don/);
  assert.match(closing, /BOI CANH DA HIEU .* Khach chot Boston 13 size 42/);
  assert.match(closing, /BAC THANG TON KHO .*same_line_same_version/);
  assert.match(closing, /KIEM TRA TON THUC TE \(nguon DUY NHAT duoc phep dung khi noi ve ton bien the 42\)/);
});

test("vi du nguoi truc: dung nhom cua y dinh, 8 cau; het hang them 4 cau het_hang; chu 'ck' keo sang nhom thanh toan", () => {
  const size = DraftWriter.pickExamples(EXAMPLES, TEXT, "ask_size", "size 42 nhé", false);
  assert.equal(size.length, 8);
  assert.deepEqual(size, EXAMPLES["hoi_size_ton"]!.slice(0, 8));
  const out = DraftWriter.pickExamples(EXAMPLES, TEXT, "ask_size", "size 42 nhé", true);
  assert.equal(out.length, 12);
  assert.deepEqual(out.slice(8), EXAMPLES["het_hang"]!.slice(0, 4));
  const pay = DraftWriter.pickExamples(EXAMPLES, TEXT, "ask_size", "em ck rồi nhé", false);
  assert.deepEqual(pay, EXAMPLES["thanh_toan"]!.slice(0, 8));
  const greet = DraftWriter.pickExamples(EXAMPLES, TEXT, "greeting", "alo", false);
  assert.deepEqual(greet, EXAMPLES["chao_hoi"]!.slice(0, 8));
  const unknown = DraftWriter.pickExamples(EXAMPLES, TEXT, "unknown", "giá bao nhiêu", false);
  assert.deepEqual(unknown, EXAMPLES["hoi_gia"]!.slice(0, 8));

  const user = DraftWriter.composePrompt(input({ intent: "shipping" }))[1]!.content;
  assert.match(user, /VI DU CAU NGUOI TRUC THAT/);
  assert.match(user, /Khach: ship code em nhé → Nguoi truc: ok a ạ/);
  // Placeholders inside the examples are filled from the profile; none reaches the model raw.
  const order = DraftWriter.composePrompt(input({ examples: { hoi_size_ton: [{ k: "size 42", n: "dạ đặt khoảng {banHang.thoiGianOrder} a nhận ạ" }] } }))[1]!.content;
  assert.match(order, /khoảng 5–9 ngày a nhận ạ/);
  assert.doesNotMatch(DraftWriter.composePrompt(input({ intent: "return_exchange" }))[1]!.content, /\{banHang\./);
});

test("mo hinh tra JSON dung → ok + reply; temperature 0.2, json:true, timeout theo ngan sach", async () => {
  const model = scriptedModel(["{\"reply\":\"Dạ Boston 13 size 42 còn bác nhé\",\"needsHuman\":false,\"reason\":\"ton co nguon\"}"]);
  const out = await new DraftWriter({ model, logger: new MemoryLogger() }).draft(input(), 7000);
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.reply, "Dạ Boston 13 size 42 còn bác nhé");
  assert.equal(out.ok && out.needsHuman, false);
  assert.equal(out.ok && out.reason, "ton co nguon");
  assert.deepEqual(model.options[0], { temperature: 0.2, json: true, timeoutMs: 7000 });
  assert.match(model.seen[0]![0]!.content, /tro ly ban hang cua Shop Giay/);
});

test("JSON hong hoac mo hinh loi → ok:false voi cau chuyen nguoi tu JSON, {khach} da dien", async () => {
  const broken = scriptedModel(["Dạ để em xem lại ạ"]);
  const logger = new MemoryLogger();
  const out = await new DraftWriter({ model: broken, logger }).draft(input());
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.viSao, "khong_doc_duoc_json");
  assert.equal(!out.ok && out.handoffReply, "Dạ bác chờ em một chút, em nhờ người phụ trách vào kiểm tra và trả lời bác ngay ạ.");
  assert.ok(logger.warnings.some((w) => /khong co reply/.test(w)));

  const dead = scriptedModel([new Error("gateway 524")]);
  const failed = await new DraftWriter({ model: dead, logger: new MemoryLogger() }).draft(input());
  assert.equal(failed.ok, false);
  assert.match(!failed.ok ? failed.viSao : "", /524/);
  assert.match(!failed.ok ? failed.handoffReply : "", /chờ em một chút/);

  // A shop with no pronoun declared: the sentence still reads.
  assert.match(DraftWriter.handoffReply({ text: TEXT, site: "https://shop.vn" }), /Dạ khách chờ em một chút/);
});

test("situationTags: doc dung dau hieu cua luot", () => {
  const tags = DraftWriter.situationTags(input({
    intent: "payment_confirmation",
    turn: { history: [{ who: "khach", text: "em ck rồi, không lấy đôi kia nữa", images: 1 }], burstText: "em ck rồi, không lấy đôi kia nữa", replyNote: "", focusedProduct: null },
    askedSize: "M", humanReview: true, frameText: "page vừa gửi STK", extraTags: ["mac_ca"],
    facts: { catalog: [], recommendationLink: "https://shop.vn/?q=boston", lookupResults: [{ command: "check_order", found: true }], externalProduct: { ten: "Ao" }, multiItems: [{}, {}] }
  }));
  for (const t of ["luon", "y:payment_confirmation", "thanh_toan", "co_anh", "huy", "nguoi_duyet", "size_chu", "khung", "mac_ca", "khong_catalog", "co_link", "van_chuyen", "sp_ngoai", "nhieu_mau", "chua_chot"]) assert.ok(tags.has(t), t);
  assert.ok(!tags.has("chot"));
});
