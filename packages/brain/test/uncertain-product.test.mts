/**
 * The uncertain-product gate: ask back with the right sentence, once; a category question gets a link;
 * a brand the shop does not carry gets an answer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { ALL, BOSTON13, hoiLaiFiller, lines, pack, query, scorer } from "./stage3-fixtures.mts";

const gate = new B.UncertainProductGate(scorer, lines);
const resolver = new B.CatalogResolver(scorer);
const NOW = "2026-09-25T09:00:00.000Z";
const hoiLai = hoiLaiFiller({ "banHang.cauKhongCo": "bên em chưa kinh doanh hãng này" });

const base = (over: Partial<B.UncertainInput> = {}): B.UncertainInput => ({
  message: "đôi này size 42 còn không",
  intent: "ask_size",
  entities: { productCode: "", productName: "", brand: "" },
  resolution: null,
  hasImage: false,
  hasFocus: false,
  state: { hasRecentImageEvidence: false },
  now: NOW,
  lexicon: pack.lexicon,
  hoiLai,
  ...over
});

test("nothing identifies the item → ask back once, with the generic sentence", () => {
  const out = gate.apply(base());
  assert.ok(out !== null && out.action === "ask_clarification");
  assert.equal(out.why, "no_product");
  assert.match(out.reply, /ảnh hoặc tên mẫu/);
  assert.deepEqual(out.missingData, ["product_identity"]);
});

test("a photo within the look-back → ask for the NAME, never for a photo again (Duong Xuan, 08/09)", () => {
  const out = gate.apply(base({ state: { hasRecentImageEvidence: true } }));
  assert.ok(out !== null && out.action === "ask_clarification");
  assert.equal(out.why, "no_product_have_image");
  assert.match(out.reply, /nhận được ảnh rồi/);
  assert.doesNotMatch(out.reply, /xin ảnh hoặc tên/);
  // The name the model read is quoted when there is one.
  const named = gate.apply(base({ state: { hasRecentImageEvidence: true }, analysis: { productName: "hoka slide 3" } }));
  assert.ok(named !== null && named.action === "ask_clarification");
  assert.match(named.reply, /em tra hoka slide 3/);
  // An image THIS turn: the gate does not fire at all (the image pipeline answers).
  assert.equal(gate.apply(base({ hasImage: true })), null);
});

test("asked back once already and still lost → a person, not a second question (v93c)", () => {
  const out = gate.apply(base({ state: { hasRecentImageEvidence: false, askedBackBefore: true } }));
  assert.ok(out !== null && out.action === "human_handoff");
  assert.equal(out.reason, "uncertain_product_twice:no_product");
  assert.match(out.reply, /nhờ người phụ trách/);
  const counted = gate.apply(base({ state: { hasRecentImageEvidence: false, askBackCount: 1 } }));
  assert.ok(counted !== null && counted.action === "human_handoff");
});

test("a category question about trousers anchored on a shoe → the type link, no ask-back (Vu Pham, 09/09)", () => {
  const resolution = resolver.resolve({ query: query({ productName: "boston 13" }), found: [BOSTON13] });
  const out = gate.apply(base({
    message: "Mình có quần dài thể thao ko shop", intent: "product_advice", resolution, hasFocus: true,
    analysis: { productType: "quần dài" }, typeLinks: { quan: "https://shop.example/?type=Qu%E1%BA%A7n%20%C3%A1o" }
  }));
  assert.ok(out !== null && out.action === "script_reply", JSON.stringify(out));
  assert.equal(out.reason, "type_mismatch_category_link");
  assert.match(out.reply, /quần áo/);
  assert.match(out.reply, /https:\/\/shop\.example\/\?type=/);
  assert.deepEqual(out.dropped, ["JS4955"]);
  // No link known: the anchor is still dropped and the agent answers the category.
  const noLink = gate.apply(base({ message: "Mình có quần dài thể thao ko shop", intent: "product_advice", resolution, hasFocus: true, analysis: { productType: "quần dài" } }));
  assert.ok(noLink !== null && noLink.action === "drop_anchor");
  // A specific trouser question ("quần này size L còn không") with a shoe anchor is a plain mismatch → ask back.
  const specific = gate.apply(base({ message: "quần này size L còn không", intent: "ask_size", resolution, hasFocus: true, analysis: { productType: "quần" } }));
  assert.ok(specific !== null && specific.action === "ask_clarification");
  assert.equal(specific.why, "type_mismatch");
});

test("a brand the shop declares it does not carry → the brand sentence, an answer that never hands off", () => {
  const out = gate.apply(base({
    message: "có giày salomon speedcross size 42 không", entities: { productCode: "", productName: "salomon speedcross", brand: "salomon" },
    analysis: { productName: "salomon speedcross", brand: "salomon" }, state: { hasRecentImageEvidence: false, askedBackBefore: true }
  }));
  assert.ok(out !== null && out.action === "ask_clarification", JSON.stringify(out));
  assert.equal(out.why, "brand_not_carried");
  assert.match(out.reply, /chưa kinh doanh hãng này/, "the shop's own sentence ({banHang.cauKhongCo}) is what is said");
  assert.deepEqual(out.missingData, []);
  // A carried brand with nothing in the catalog → "đang hết", only when the caller SAYS the catalog has none.
  // ("Kawana" is no line of the DNA: a known line would be the cascade's job, not the gate's.)
  const out2 = gate.apply(base({
    message: "có giày hoka kawana 2 size 42 không", entities: { productCode: "", productName: "hoka kawana 2", brand: "hoka" },
    analysis: { productName: "hoka kawana 2", brand: "hoka" }, brandInCatalog: false
  }));
  assert.ok(out2 !== null && out2.action === "ask_clarification");
  assert.equal(out2.why, "brand_out_of_stock");
  assert.match(out2.reply, /hàng hoka bên em hiện đang hết/);
  assert.match(out2.reply, /adidas/, "the pack's other brands are offered instead");
  assert.doesNotMatch(out2.reply, /sẵn hoka/, "the asked brand is not offered as an alternative");
  const unknown = gate.apply(base({ message: "có giày hoka kawana 2 size 42 không", entities: { productCode: "", productName: "hoka kawana 2", brand: "hoka" }, analysis: { productName: "hoka kawana 2", brand: "hoka" } }));
  assert.ok(unknown !== null && unknown.action === "ask_clarification");
  assert.equal(unknown.why, "no_product", "without the catalog's word, 'hết' is never claimed");
});

test("general advice is not 'one item'; a known line, a focus or a found product keep the gate quiet", () => {
  assert.equal(gate.apply(base({ message: "giày chạy nam size 42 có không", analysis: { productName: "giày chạy nam" } })), null);
  assert.equal(gate.apply(base({ message: "boston 13 còn 42 không" })), null, "a named line is the cascade's job");
  assert.equal(gate.apply(base({ hasFocus: true })), null);
  const found = resolver.resolve({ query: query({ productCode: "JS4955" }), found: ALL });
  assert.equal(gate.apply(base({ resolution: found })), null);
});

test("a bare emoji after six quiet hours with no open episode is lost; inside an episode it is not", () => {
  const cold = gate.apply(base({ message: "🙏", intent: "unknown", state: { hasRecentImageEvidence: false, lastPageAt: "2026-09-24T20:00:00.000Z", lastCustomerAt: "2026-09-24T20:05:00.000Z" } }));
  assert.ok(cold !== null && cold.why === "emoji_only_cold");
  const warm = gate.apply(base({ message: "🙏", intent: "unknown", state: { hasRecentImageEvidence: false, lastPageAt: "2026-09-25T08:50:00.000Z", episodeLastAt: "2026-09-25T08:55:00.000Z" } }));
  assert.equal(warm, null);
});
