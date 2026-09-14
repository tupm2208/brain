/**
 * Industry packs: validity, the "new industry without touching the engine" promise, and text helpers.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { PARA, ask, clonePack, fakePorts } from "./fixtures.mts";

test("both built-in packs are valid", () => {
  assert.doesNotThrow(() => B.selfCheckPacks());
  assert.deepEqual(B.validatePack(B.runningShoesPack), []);
  assert.deepEqual(B.validatePack(B.pharmacyPack), []);
});

test("PROMISE: another industry runs unchanged on the same engine", async () => {
  // The pharmacy differs in three ways: TWO axes, an industry gate of its own, and completely
  // different lexicon and templates. If this fails the sales promise is broken.
  const f = fakePorts({
    items: [PARA],
    rows: [{ itemId: "i9", variantId: "vp", variantLabel: "500mg x 30 vien",
             warehouseId: "w1", warehouseName: "Quay 1", qty: 12, price: 25000 } as never]
  });
  const r = await ask(f.ports, "co paracetamol 500mg khong a", {}, "nha-thuoc");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.equal(r.itemCode, "PARA500");
  assert.equal(r.slots["hamluong"], "500mg");
  assert.match(r.reply, /Còn 12 hộp 500mg/);
});

test("PROMISE: two axes are read from one sentence", () => {
  const axes = B.pharmacyPack.itemShape.axes;
  assert.equal(axes.length, 2);
  assert.equal(B.extractAxis(axes[0]!, "hop paracetamol 500mg loai 30 vien"), "500mg");
  assert.equal(B.extractAxis(axes[1]!, "hop paracetamol 500mg loai 30 vien"), "30 vien");
});

test("PROMISE: an industry can declare its own safety gate", async () => {
  const f = fakePorts({ items: [PARA] });
  const r = await ask(f.ports, "thuoc nay uong may vien mot ngay", {}, "nha-thuoc");
  assert.equal(r.action, "handoff", "The bot is giving dosage advice in chat.");
  assert.match(r.reply, /dược sĩ/);
});

test("every axis example in the packs holds", () => {
  for (const pack of [B.runningShoesPack, B.pharmacyPack]) {
    for (const axis of pack.itemShape.axes) {
      for (const ex of axis.examples) {
        assert.equal(B.extractAxis(axis, ex.text), ex.expect, `${pack.id}/${axis.id}: ${ex.text}`);
      }
    }
  }
});

test("every intent example in the packs resolves to its intent", () => {
  for (const pack of [B.runningShoesPack, B.pharmacyPack]) {
    for (const intent of pack.intents) {
      for (const ex of intent.examples ?? []) {
        assert.equal(B.detectIntent(pack, ex)?.id, intent.id, `${pack.id}: ${ex}`);
      }
    }
  }
});

test("the validator catches broken packs", () => {
  const a = clonePack(B.runningShoesPack); a.templates["handoff"] = "Nhan vien goi lai trong 5 phut nhe";
  assert.ok(B.validatePack(a).some((m) => /khong duoc chua con so/.test(m)));

  const b = clonePack(B.runningShoesPack); b.intents[0]!.tools = ["shipment.track"];
  assert.ok(B.validatePack(b).some((m) => /khong nam trong danh sach cho phep/.test(m)));

  const c = clonePack(B.runningShoesPack); c.gates = c.gates.filter((g) => g.kind !== "no_unsourced_numbers");
  assert.ok(B.validatePack(c).some((m) => /thieu cong bat buoc/.test(m)));

  const d = clonePack(B.runningShoesPack); d.intents[0]!.requiredSlots = ["khung_gio"];
  assert.ok(B.validatePack(d).some((m) => /khong ton tai/.test(m)));

  const e = clonePack(B.runningShoesPack); e.templates["in_stock"] = "Con {ton} doi {khunggio} a";
  assert.ok(B.validatePack(e).some((m) => /o thay the la/.test(m)));
});

test("the validator refuses forbidden phrases written without diacritics", () => {
  const bad = clonePack(B.runningShoesPack);
  bad.identity.neverSay = ["bao hanh tron doi"];
  assert.ok(B.validatePack(bad).some((m) => /phai viet co dau/.test(m)));
});

test("the validator refuses a pack calling a tool the engine cannot run", () => {
  const bad = clonePack(B.runningShoesPack);
  bad.allowedTools.push("shipment.track");
  bad.intents[0]!.tools = ["shipment.track"];
  assert.ok(B.validatePack(bad).some((m) => /chua co cach chay no/.test(m)));
});

test("the validator catches templates without diacritics EVEN with placeholders", () => {
  const bad = clonePack(B.runningShoesPack);
  bad.templates["in_stock"] = "Con {ton} doi size {size}, gia {gia} a.";
  const problems = B.validatePack(bad);
  assert.ok(problems.some((m) => /viet khong dau/.test(m)), JSON.stringify(problems));
});

test("the validator inspects templates INSIDE intents too", () => {
  // No diacritics: the shortcut that switches off the industry's own gates.
  const a = clonePack(B.pharmacyPack);
  a.intents = a.intents.map((i) => i.id === "hoi_gia"
    ? { ...i, template: "Lieu dung cua thuoc nay ghi tren vo hop a, {khach} uong theo do a." } : i);
  assert.ok(B.validatePack(a).some((m) => /viet khong dau/.test(m)), JSON.stringify(B.validatePack(a)));

  // A forbidden phrase inside the pack's own template.
  const b = clonePack(B.pharmacyPack);
  b.intents = b.intents.map((i) => i.id === "hoi_gia"
    ? { ...i, template: "Giá {gia} ạ, thuốc này chữa khỏi hoàn toàn ạ." } : i);
  assert.ok(B.validatePack(b).some((m) => /cum bi cam/.test(m)));

  // A hard-coded number: would pass the number gate whenever it coincides with a stock figure.
  const c = clonePack(B.pharmacyPack);
  c.intents = c.intents.map((i) => i.id === "hoi_gia"
    ? { ...i, template: "Giá {gia} ạ, bên nhà thuốc có 3 chi nhánh ạ." } : i);
  assert.ok(B.validatePack(c).some((m) => /so viet cung/.test(m)));

  // An unknown placeholder inside an intent template.
  const d = clonePack(B.pharmacyPack);
  d.intents = d.intents.map((i) => i.id === "hoi_gia"
    ? { ...i, template: "Giá {khongtontai} ạ." } : i);
  assert.ok(B.validatePack(d).some((m) => /o thay the la/.test(m)));
});

test("a pack pointing intentWhenItemNamed at an unknown intent is reported", () => {
  const bad = clonePack(B.runningShoesPack);
  bad.intentWhenItemNamed = "khong_co_y_dinh_nay";
  const problems = B.validatePack(bad);
  assert.ok(problems.some((m) => /intentWhenItemNamed/.test(m)), JSON.stringify(problems));
});

test("an axis without a human label is refused", () => {
  const bad = clonePack(B.runningShoesPack);
  bad.itemShape.axes[0]!.label = "";
  assert.ok(B.validatePack(bad).some((m) => /thieu nhan hien/.test(m)));
});

test("pack-specific placeholders must come with a value", () => {
  const good = clonePack(B.runningShoesPack);
  good.extraValues = { camket: "hàng có sẵn tại kho" };
  good.templates["in_stock"] = "Còn {ton} đôi {truc} {size}, giá {gia} ạ, {camket} ạ.";
  assert.deepEqual(B.validatePack(good), []);

  const bad = clonePack(B.runningShoesPack);
  bad.templates["in_stock"] = "Còn {ton} đôi {truc} {size}, giá {gia} ạ, {camket} ạ.";
  assert.ok(B.validatePack(bad).some((m) => /o thay the la/.test(m)));
});

test("filler words live in the PACK, not in the engine", () => {
  // "cam" is a filler for shoes but "thuoc cam" (cold medicine) at a pharmacy; the engine must not decide.
  assert.ok(B.specificTokens("con cam khong", []).includes("cam"), "The engine swallowed 'cam' without the pack asking.");
  assert.deepEqual(B.specificTokens("con cam khong", [], ["cam"]), []);
  assert.ok(B.pharmacyPack.lexicon.fillerWords !== undefined);
  assert.ok(!B.pharmacyPack.lexicon.fillerWords.includes("cam"), "'cam' is swallowed at the pharmacy.");
});

test("a pack's filler words must not swallow a merchant's item names", () => {
  assert.deepEqual(B.checkFillerWordsAgainstCatalog(B.runningShoesPack, [{ code: "GM1", name: "Giày mọi da bò" }]), []);
  const bad = clonePack(B.runningShoesPack);
  bad.lexicon.fillerWords = [...bad.lexicon.fillerWords!, "moi"];
  assert.deepEqual(B.checkFillerWordsAgainstCatalog(bad, [{ code: "GM1", name: "Giày mọi da bò" }]), ["moi"]);
  // Fillers under 3 letters never pass `specificTokens`, so they swallow nothing and are not reported.
  bad.lexicon.fillerWords = [...bad.lexicon.fillerWords!, "da"];
  assert.deepEqual(B.checkFillerWordsAgainstCatalog(bad, [{ code: "GM1", name: "Giày mọi da bò" }]), ["moi"]);
  assert.ok(B.specificTokens("giay moi con size 42 khong", B.runningShoesPack.lexicon.genericTerms,
    B.runningShoesPack.lexicon.fillerWords).includes("moi"), "'giay moi' could never be sold.");
});

// ===========================================================================
// Text normalisation
// ===========================================================================

test("normalisation handles both Vietnamese Unicode forms", () => {
  const nfc = "đôi này còn 42 không";
  assert.equal(B.normalize(nfc), B.normalize(nfc.normalize("NFD")));
  assert.equal(B.normalize(nfc), "doi nay con 42 khong");
  assert.equal(B.tight("NewBalance"), B.tight("new balance"));
});

test("the diacritic form keeps 'đôi' (pair) apart from 'đổi' (exchange)", () => {
  assert.notEqual(B.soft("còn 7 đôi size 42"), B.soft("cho đổi size"));
  assert.ok(!B.soft("còn 7 đôi size 42").includes("đổi"));
});

test("brand mentions use word boundaries, not substrings", () => {
  // The brand "On" is two letters; a substring test would flag "con hang khong".
  assert.equal(B.mentionsBrand("con hang khong shop", "on"), false);
  assert.equal(B.mentionsBrand("giay on cloudmonster", "on"), true);
  assert.equal(B.mentionsBrand("co newbalance khong", "new balance"), true);
});

test("product-name coverage does not punish talkative customers", () => {
  const short = "adizero boston 13 con 42 khong";
  const long = "cho em hoi doi adizero boston 13 nay con size 42 khong shop oi";
  const target = "IE0000 Adizero Boston 13";
  assert.ok(B.coverage(short, target) >= B.ITEM_MATCH_THRESHOLD);
  assert.ok(B.coverage(long, target) >= B.ITEM_MATCH_THRESHOLD, "A polite long sentence was ignored.");
});

test("'doi' as the counter for shoes is not read as an exchange request", () => {
  assert.notEqual(B.detectIntent(B.runningShoesPack, "doi nay dep qua shop")?.id, "doi_tra");
  assert.equal(B.detectIntent(B.runningShoesPack, "shop cho doi size khong a")?.id, "doi_tra");
});

test("quantities and other units are not read as sizes", () => {
  const axis = B.runningShoesPack.itemShape.axes[0]!;
  for (const text of [
    "shop con 40 doi loai nay khong",
    "em can 50 doi lam qua",
    "em nang 50 kg cao 1m70 nen di size nao",
    "bao hanh 36 thang a",
    "gia 45k ship a"
  ]) {
    assert.equal(B.extractAxis(axis, text), null, text);
  }
});

test("misspelled brands are still recognised through aliases", () => {
  assert.match(B.applyAliases(B.runningShoesPack, "co giay niubalan khong"), /new balance/);
  assert.match(B.applyAliases(B.runningShoesPack, "mau bostom 13"), /boston/);
});

test("warehouse labels written differently still match the customer's value", () => {
  const axis = B.pharmacyPack.itemShape.axes[0]!;
  assert.equal(B.labelMatches(axis, "500mg", "500mg x 30 vien"), true);
  assert.equal(B.labelMatches(axis, "500 mg", "500mg x 30 vien"), true);
  assert.equal(B.labelMatches(axis, "250mg", "500mg x 30 vien"), false);
  for (const label of ["500mg x 30 vien", "500 mg x 30 vien", "500mg, hop 30 vien", "Hop 30 vien 500mg"]) {
    assert.equal(B.labelMatches(axis, "500mg", label), true, label);
  }
});

test("adidas third sizes are not treated as whole sizes", () => {
  const axis = B.runningShoesPack.itemShape.axes[0]!;
  assert.equal(B.labelMatches(axis, "42", "42 2/3"), false, "42 2/3 was treated as 42.");
  assert.equal(B.labelMatches(axis, "42 2/3", "42 2/3"), true);
  assert.equal(B.labelMatches(axis, "42", "42"), true);
});
