/**
 * THE PROMISE OF 21/09/2026: opening a new industry is a FOLDER OF JSON, nothing else.
 *
 * No TypeScript file, no line in a registry, no rebuild, no redeploy, no edit to the admin page.
 * The test proves it the only honest way: it writes a folder for an industry nobody has ever
 * mentioned in this repo (cosmetics), points the platform at it, and sells with it.
 *
 * The rest of the file guards the two ways that promise is usually broken in practice:
 *   - a hand-edited file fails SILENTLY, so the bot goes quiet at eleven at night instead of
 *     failing at start-up with the field named;
 *   - a new industry secretly inherits the shoe knowledge, and a pharmacy starts recommending
 *     carbon plates.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DiskPackSource, INDUSTRY_DIRECTORY, KnowledgePackRegistry, classifyByRules, industryIds, installIndustryPacks
} from "@sp/xeon";
import { PackRegistry, detectIntent, extractAxis, loadPack, packIds, usePackSource } from "@sp/brain";

// ------------------------------------------------------------------ an industry nobody coded for

/** A cosmetics shop: one axis (volume in ml), one intent, the three compulsory gates. */
const COSMETICS_RULES = {
  id: "my-pham",
  name: "Mỹ phẩm",
  identity: {
    customerPronoun: "chị",
    selfPronoun: "shop",
    tone: ["Nói ngắn, không hứa hiệu quả."],
    neverSay: ["trắng da cấp tốc"]
  },
  lexicon: {
    brands: ["cocoon", "la roche posay"],
    knownBrandsNotCarried: [],
    categories: ["son", "kem chong nang"],
    aliases: { "kem chong nag": "kem chong nang" },
    genericTerms: ["do", "loai"],
    fillerWords: ["thi", "sao"]
  },
  itemShape: {
    axes: [{
      id: "dungtich",
      label: "dung tích",
      pattern: "(?:^|[^0-9])(\\d+\\s*ml)(?:[^0-9]|$)",
      canonical: [{ pattern: "^(\\d+)\\s*ml$", replace: "$1ml" }],
      examples: [
        { text: "co loai 50 ml khong", expect: "50 ml" },
        { text: "cai nay bao nhieu tien", expect: null }
      ],
      requiredForStock: true
    }]
  },
  intents: [{
    id: "hoi_ton_kho",
    name: "Hỏi còn hàng",
    keywords: ["con", "het", "size"],
    requiredSlots: ["item"],
    tools: ["stock.lookup"],
    template: "Còn {ton} {bienthe} giá {gia} ạ",
    askBackTemplate: "{khach} cho {shop} xin tên sản phẩm ạ"
  }],
  intentWhenItemNamed: "hoi_ton_kho",
  allowedTools: ["stock.lookup"],
  gates: [
    { kind: "no_unsourced_numbers" },
    { kind: "forbidden_phrases" },
    { kind: "no_facts_when_offline" }
  ],
  templates: {
    greeting: "Dạ {shop} nghe {khach} ạ",
    ask_item: "{khach} cho {shop} xin tên sản phẩm ạ",
    ask_slot: "{khach} cho {shop} xin {truc} ạ",
    handoff: "{shop} nhờ người trực trả lời {khach} ngay ạ",
    offline: "{shop} kiểm lại rồi nhắn {khach} ngay ạ",
    in_stock: "Còn {ton} {bienthe} giá {gia} ạ",
    out_of_stock: "Hết {bienthe} này rồi ạ"
  }
};

/** The agent profile, with its rules written as LINES — a playbook must stay readable. */
const COSMETICS_AGENT = {
  systemPrompt: [
    "Ban la nhan vien tu van cua {tenShop}.",
    "KHONG hua hieu qua duong da."
  ],
  fallbackPolicy: "Shop chưa khai chính sách.",
  mustHumanPattern: "khieu nai|hoan tien",
  handoffReplyPattern: "nguoi truc"
};

/** The knowledge pack: two classification rules and the Fit Finder questions of this trade. */
const COSMETICS_KNOWLEDGE = {
  id: "my-pham",
  name: "Mỹ phẩm",
  tradeWords: "mỹ phẩm",
  families: [{ id: "skincare", label: "Skincare" }],
  referenceRules: [
    { keywords: ["kem chong nang"], category: "sunscreen", useCases: ["hang_ngay"], scores: { daily: 5 } },
    { keywords: ["son"], category: "lipstick", useCases: ["trang_diem"], scores: { daily: 3 } }
  ],
  fitFinder: { customerInputs: ["Loại da"], lineProfileFields: ["Kết cấu"] },
  kit: { versionedModels: [], brandPrefixes: ["cocoon"], defaultCategory: "my_pham", familyPatterns: [], researchPrompts: {}, evaluationRows: {} }
};

/** Writes an industry folder and hands back its parent, the way an operator would with a file manager. */
function industryFolder(files: Record<string, unknown>, id = "my-pham"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nganh-"));
  fs.mkdirSync(path.join(root, id));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, id, name), typeof body === "string" ? body : JSON.stringify(body, null, 2), "utf8");
  }
  return root;
}

/** Puts the shipped folder back, so one test's temporary industry cannot leak into the next. */
function restoreShippedIndustries(): void {
  installIndustryPacks();
}

test("mot nganh moi = mot thu muc JSON: khong sua ma, khong dich lai", () => {
  const root = industryFolder({
    "bo-luat.json": COSMETICS_RULES,
    "agent.json": COSMETICS_AGENT,
    "kien-thuc.json": COSMETICS_KNOWLEDGE
  });
  try {
    usePackSource(new DiskPackSource(root));
    assert.deepEqual(packIds(), ["my-pham"], "thư mục là nguồn duy nhất của danh sách ngành");

    const pack = loadPack("my-pham");
    assert.equal(pack.name, "Mỹ phẩm");
    assert.equal(pack.itemShape.axes[0]?.id, "dungtich");
    // The engine reads this industry's axis exactly as it reads a shoe size.
    assert.equal(extractAxis(pack.itemShape.axes[0]!, "cho em chai 50 ml"), "50 ml");
    assert.equal(detectIntent(pack, "con hang khong shop")?.id, "hoi_ton_kho");

    // The playbook came back as one text, joined from its lines.
    // A legacy single `systemPrompt` is read as ONE block, so an older folder keeps working.
    assert.equal(pack.agent?.khoi[0]?.loiDan, "Ban la nhan vien tu van cua {tenShop}.\nKHONG hua hieu qua duong da.");

    // And Xeon's industry knowledge follows the same folder.
    const knowledge = new KnowledgePackRegistry(root);
    assert.equal(knowledge.get("my-pham").tradeWords, "mỹ phẩm");
    assert.deepEqual(knowledge.get("my-pham").fitFinder.customerInputs, ["Loại da"]);
    assert.equal(classifyByRules(knowledge.get("my-pham").referenceRules, { ten: "Kem chong nang Cocoon" }).category, "sunscreen");
  } finally {
    restoreShippedIndustries();
  }
});

test("khong co agent.json thi may luat tra loi mot minh — khong phai loi", () => {
  const root = industryFolder({ "bo-luat.json": COSMETICS_RULES });
  try {
    usePackSource(new DiskPackSource(root));
    assert.equal(loadPack("my-pham").agent, undefined);
  } finally {
    restoreShippedIndustries();
  }
});

test("mot truong go sai bao NGAY, va goi ten truong do", () => {
  const broken = structuredClone(COSMETICS_RULES) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the test breaks the shape on purpose
  broken["identity"].tone = "Nói ngắn";           // a text where a list belongs
  broken["intents"][0].tools = ["kho.tra-cuu"]; // a tool that does not exist
  const root = industryFolder({ "bo-luat.json": broken });
  try {
    const registry = new PackRegistry(new DiskPackSource(root));
    assert.throws(() => registry.load("my-pham"), (error: Error) => {
      assert.match(error.message, /identity\.tone/, "phải chỉ đúng tên trường sai");
      assert.match(error.message, /kho\.tra-cuu/, "công cụ lạ phải bị chặn lúc nạp, không phải lúc khách hỏi");
      return true;
    });
  } finally {
    restoreShippedIndustries();
  }
});

test("JSON hong thi bao ten TEP, khong phai mot dong loi cua trinh doc", () => {
  const root = industryFolder({ "bo-luat.json": "{ \"id\": \"my-pham\", }" });
  try {
    const registry = new PackRegistry(new DiskPackSource(root));
    assert.throws(() => registry.load("my-pham"), /bo-luat\.json/);
  } finally {
    restoreShippedIndustries();
  }
});

test("ten thu muc va `id` lech nhau la loi — neu khong license tro vao khoang khong", () => {
  const root = industryFolder({ "bo-luat.json": { ...COSMETICS_RULES, id: "my-pham-2" } });
  try {
    const registry = new PackRegistry(new DiskPackSource(root));
    assert.throws(() => registry.load("my-pham"), /my-pham-2/);
  } finally {
    restoreShippedIndustries();
  }
});

test("nganh la nao khong bao gio muon duoc kien thuc cua nganh khac", () => {
  const knowledge = new KnowledgePackRegistry();
  const unknown = knowledge.get("spa-lam-dep");
  assert.equal(unknown.lines.size(), 0);
  assert.deepEqual(unknown.referenceRules, []);
  assert.equal(unknown.tradeWords, "hàng", "không có gói thì nói 'hàng', không mượn chữ của ngành khác");
});

test("thu muc `nganh/` dang ship doc duoc va dung — bai nay gay khi ai do sua JSON sai", () => {
  const shipped = industryIds(INDUSTRY_DIRECTORY);
  assert.ok(shipped.includes("giay-chay") && shipped.includes("nha-thuoc"), `mới thấy: ${shipped.join(", ")}`);
  const registry = new PackRegistry(new DiskPackSource());
  assert.doesNotThrow(() => registry.selfCheck());
  assert.equal(registry.load("giay-chay").agent?.tools?.length, 4, "giày chạy có đủ bộ công cụ của agent");
  assert.ok((registry.load("giay-chay").agent?.khoi.length ?? 0) >= 8, "sổ tay giày chạy chia theo khối");
  assert.ok(registry.common().khoi.length >= 5, "tầng 1 (loi-chung) đọc được");
  assert.equal(registry.load("nha-thuoc").itemShape.axes.length, 2, "nhà thuốc có hai trục: hàm lượng và quy cách");
});
