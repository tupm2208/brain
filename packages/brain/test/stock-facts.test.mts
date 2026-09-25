/**
 * The stock facts and the cascade plan: price by the warehouse that has the size, other colourways with
 * the size, 42.5 → 42 2/3, and the order of finder calls.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { BOSTON12, BOSTON13, BOSTON13_DEN, cfg, item, lines, size } from "./stage3-fixtures.mts";

const found = [BOSTON13, BOSTON13_DEN, BOSTON12];

test("the size in another warehouse → that warehouse's price, and the others listed (Desk v8)", () => {
  const facts = B.buildStockFacts(found, { code: "JS4955", requestedSize: "42 2/3" }, cfg);
  assert.ok(facts !== null);
  assert.equal(facts.stock?.size, "42 2/3");
  assert.equal(facts.stock?.qty, 3);
  assert.equal(facts.stock?.approximate, false);
  assert.equal(facts.price, 2990000, "the price of the warehouse that HAS the size, not the item's first price");
  assert.equal(facts.kho, "K2");
  assert.equal(facts.stockType, "san");
  assert.deepEqual(facts.otherKho, ["K1: hết size, giá 3.190.000"]);
  // Size 42 sits in K1 at the other price.
  const k1 = B.buildStockFacts(found, { code: "JS4955", requestedSize: "42" }, cfg);
  assert.equal(k1?.price, 3190000);
  assert.equal(k1?.kho, "K1");
  assert.deepEqual(k1?.otherKho, ["K2: hết size, giá 2.990.000"]);
});

test("'còn màu nào khác' → the same model's colourways with the size, plus one filter link", () => {
  const facts = B.buildStockFacts(found, { code: "JS4955", requestedSize: "42", otherColorsAsked: true }, cfg, {
    lines, filterLink: (q) => `https://shop.example/?q=${encodeURIComponent(q.line + (q.version ? " " + q.version : ""))}&size=${q.size}&gender=${q.gender}`
  });
  assert.ok(facts !== null);
  assert.deepEqual(facts.variantsAvailable.map((v) => v.code), ["JS4955", "IF9414"], "Boston 12 is another model, not a colourway");
  assert.deepEqual(facts.variantsAvailable[1]!.sizesInStock, ["42"]);
  assert.match(facts.filterLink ?? "", /q=boston(%20| )13&size=42&gender=M/);
  // The MAU_KHAC block of the system note is fed from it.
  const note = B.FactNoteComposer.compose({ ...B.turnFactsFromStock(facts), customerPronoun: "bác" }, B.loadNoteTexts("giay-chay"));
  assert.match(note, /KHACH HOI MAU\/SIZE KHAC cua ADIZERO BOSTON 13 M \(JS4955\) size 42/);
  assert.match(note, /IF9414/);
  assert.match(note, /shop\.example/);
  // Without the size, every colourway with any stock; with one variant only, no link.
  const one = B.buildStockFacts([BOSTON13], { code: "JS4955", otherColorsAsked: true }, cfg, { lines, filterLink: () => "x" });
  assert.equal(one?.variantsAvailable.length, 1);
  assert.equal(one?.filterLink, undefined);
});

test("42.5 asked → the 42 2/3 step, flagged approximate; a tie goes UP; letters and apparel keys compare as text", () => {
  const facts = B.buildStockFacts([BOSTON13], { code: "JS4955", requestedSize: "42.5" }, cfg);
  assert.equal(facts?.stock?.size, "42 2/3");
  assert.equal(facts?.stock?.approximate, true);
  const m = new B.SizeMatcher(cfg.sizes);
  const tie = m.nearest([size("42 2/3"), size("43 1/3")], "43");
  assert.equal(tie?.size, "43 1/3", "a tight shoe is worse than a loose one: the step UP wins a tie");
  assert.equal(m.nearest([size("41")], "42"), null, "a whole size away is not the same step");
  assert.equal(m.same("XXL", "2XL"), true);
  assert.equal(m.same("A/88", "88"), true);
  assert.equal(m.same("A/L", "L"), true);
  assert.equal(m.nearest([size("A/M"), size("A/L")], "l")?.size, "A/L");
  assert.equal(m.nearest([size("41 1/3")], "M"), null, "a letter never matches a number");
  assert.equal(m.matches([size("42 2/3")], "42,5").length, 1);
});

test("a weak hit (nothing, or a step down) looks for another colourway with the size", () => {
  const den = item("IF9414", "ADIZERO BOSTON 13 M den", [size("43")]);
  const base = item("JS4955", "ADIZERO BOSTON 13 M", [size("42 2/3")]);
  const facts = B.buildStockFacts([base, den], { code: "JS4955", requestedSize: "43" }, cfg, { lines });
  assert.equal(facts?.stock?.size, "42 2/3");
  assert.equal(facts?.colorwayAlternative?.code, "IF9414");
  assert.equal(facts?.colorwayAlternative?.size, "43");
  // No size asked and no colour question: nothing to state.
  assert.equal(B.buildStockFacts([base], { code: "JS4955" }, cfg), null);
  assert.equal(B.buildStockFacts([base], { code: "XX", requestedSize: "42" }, cfg), null);
});

test("planStockCascade: code → same line + version → other versions (size only) → equivalent → beginner lines", () => {
  const plan = B.planStockCascade({ productCode: "JS4955", productName: "boston 13", size: "42" }, lines);
  assert.deepEqual(plan.slice(0, 3).map((s) => s.level), ["exact_code", "same_line_same_version", "same_line_other_version"]);
  assert.deepEqual(plan[0]!.find, { ma: "JS4955", size: "42" });
  assert.equal(plan[1]!.find.ten, "adidas Adizero Boston 13");
  assert.equal(plan[2]!.find.ten, "adidas Adizero Boston");
  const eq = plan.filter((s) => s.level === "equivalent_line").map((s) => s.line?.id);
  assert.ok(eq.includes("adizero-evo-sl") && eq.includes("asics-novablast"), eq.join(","));
  assert.ok(plan.some((s) => s.level === "beginner_line" && s.line?.id === "adidas-supernova"));
  assert.ok(plan.every((s) => (s.level === "equivalent_line" || s.level === "beginner_line") === !s.stopWhenSizeFound));
  // No size: the line's other versions are never opened ("Boston 13 còn không" must not drag Boston 12 in).
  const noSize = B.planStockCascade({ productName: "boston 13" }, lines);
  assert.deepEqual(noSize.map((s) => s.level), ["same_line_same_version"]);
  // A line named only in the message (no name entity) still plans; nothing named plans nothing.
  assert.equal(B.planStockCascade({ message: "Nimbus 28 bên mình có ko", size: "42" }, lines)[0]?.level, "same_line_same_version");
  assert.deepEqual(B.planStockCascade({ size: "42" }, lines), []);
  assert.ok(B.CASCADE_FOUND_LEVELS.includes("equivalent_line"));
});
