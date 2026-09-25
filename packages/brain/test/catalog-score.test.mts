/**
 * Catalog scoring (Desk `scoreProduct` / `retrieveCatalog`): the gates that once dropped the right shoe
 * or kept the wrong one, each with the conversation that taught it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { ADIOS9, ADIOS_PRO4, ALL, BOSTON12, BOSTON13, EKIDEN, NO_BRAND, item, query, scorer, size } from "./stage3-fixtures.mts";

test("'boston 13' brings Boston 13, never Boston 12 (another version is another shoe)", () => {
  const out = scorer.retrieve(ALL, query({ productName: "boston 13", intent: "ask_size" }));
  assert.ok(out.length >= 1);
  assert.equal(out[0]!.code, "JS4955");
  assert.ok(!out.some((c) => c.code === "IH5748"), "Boston 12 came back for a Boston 13 question");
  assert.ok(out[0]!.reasons.includes("version_match"));
  // The version was read after the line alias, never from a size: "boston size 42" asks for no version.
  assert.equal(scorer.requestedVersion(query({ productName: "boston 13" }), ALL), "13");
  assert.equal(scorer.requestedVersion(query({ productName: "boston size 42" }), ALL), "");
});

test("a size-like version (35–52) only demotes: 'boston 42' is a size, Boston 13 stays", () => {
  const out = scorer.retrieve([BOSTON13, BOSTON12], query({ productName: "boston", modelVersion: "42" }));
  assert.ok(out.length > 0, "every Boston was dropped for a version that is really a size");
});

test("'Saucony pro 4' does not bring Adios Pro 4: a stated brand drops a product of a KNOWN other brand", () => {
  const out = scorer.retrieve(ALL, query({ productName: "saucony pro 4", brand: "saucony", intent: "ask_size" }));
  assert.ok(!out.some((c) => c.code === "IG8054"), "Adios Pro 4 came back for a Saucony question");
  assert.equal(scorer.brandOf(ADIOS_PRO4), "adidas", "the brand is read off the line name (adizero → adidas)");
});

test("an item with no known brand is NOT dropped by the brand gate (84% of records had an empty brand)", () => {
  const out = scorer.retrieve([NO_BRAND, ADIOS9], query({ productName: "xyz runner", brand: "asics" }));
  assert.ok(out.some((c) => c.code === "XR0001"), "the unknown-brand item was dropped");
  assert.ok(!out[0]!.reasons.includes("brand"), "no brand bonus without a brand");
});

test("an exact code switches every drop gate off (JQ0764 was once +90 for its code and then dropped by the brand gate)", () => {
  const out = scorer.retrieve(ALL, query({ productCode: "JQ0764", brand: "nike", productName: "vaporfly", productType: "áo" }));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.code, "JQ0764");
  assert.ok(out[0]!.reasons.includes("code"));
});

test("a line must match ALL its distinctive words: 'Adizero Boston' does not match the Ekiden shirt", () => {
  const out = scorer.retrieve([EKIDEN, BOSTON13], query({ productLine: "Adizero Boston", intent: "ask_price" }));
  assert.ok(!out.some((c) => c.code === "HZ1234"), "the shirt matched on 'adizero' alone");
  assert.ok(out.some((c) => c.code === "JS4955" && c.reasons.includes("line_match")));
});

test("generic words never count as a name hit; a distinctive word the customer typed must appear", () => {
  const vapor = item("NK0001", "Nike Air Zoom Vapor Pro 3", [size("42")]);
  const out = scorer.retrieve([vapor, BOSTON13], query({ productName: "air jordan 1 low" }));
  assert.equal(out.length, 0, "'air jordan' matched Air Zoom Vapor on 'air'");
});

test("the type gate is inverted: a proven other type is dropped, a silent name passes", () => {
  const out = scorer.retrieve([EKIDEN, BOSTON13, NO_BRAND], query({ productType: "áo", productName: "adizero" }));
  assert.ok(out.some((c) => c.code === "HZ1234"), "the shirt was dropped for a shirt question");
  assert.ok(!out.some((c) => c.code === "JS4955"), "a shoe (numeric sizes) came back for a shirt question");
  assert.equal(scorer.typeOf(BOSTON13), "giay", "two numeric sizes in the shoe range prove a shoe");
  assert.equal(scorer.typeOf(EKIDEN), "ao");
});

test("the list is cut at five, own warehouse first, and the same code from two warehouses is one line", () => {
  const many = Array.from({ length: 7 }, (_, i) => item(`DM000${i}`, `DURAMO SL M ${i}`, [size("42")], { nguon: i % 2 === 0 ? "partner" : "own" }));
  const out = scorer.retrieve(many, query({ productName: "duramo sl" }));
  assert.equal(out.length, 3, "only own-warehouse items when any matched (Desk own_first_then_partner)");
  assert.ok(out.every((c) => c.source === "own"));
  const all = Array.from({ length: 7 }, (_, i) => item(`DM000${i}`, `DURAMO SL M ${i}`, [size("42")]));
  assert.equal(scorer.retrieve(all, query({ productName: "duramo sl" })).length, 5);
  const twice = [BOSTON13, { ...BOSTON13, cac_size: [size("44", { kho: "K3", gia: 2790000 })] }];
  const merged = scorer.retrieve(twice, query({ productCode: "JS4955" }));
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.otherKho.length, 1);
  assert.equal(merged[0]!.otherKho[0]!.kho, "K3");
});

test("size / colour / need bonuses and the requested-size stock", () => {
  const out = scorer.retrieve([BOSTON13, BOSTON12], query({ productName: "boston 13", size: "42.5", intent: "product_advice", need: "tempo", color: "den" }));
  const top = out[0]!;
  assert.equal(top.code, "JS4955");
  assert.ok(top.reasons.includes("size"), "42.5 is the 42 2/3 step: the size bonus applies");
  assert.equal(top.requestedSizeStock?.size, "42 2/3");
  assert.equal(top.requestedSizeStock?.approximate, true);
});

test("compareRecommendationProducts: newer version → campaign → price → sizes → own", () => {
  const sorted = [BOSTON12, BOSTON13, { ...BOSTON12, ma: "IH9999", khuyenMai: true }].sort((a, b) => B.compareRecommendationProducts(a, b));
  assert.deepEqual(sorted.map((p) => p.ma), ["JS4955", "IH9999", "IH5748"]);
});
