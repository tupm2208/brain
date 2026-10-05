/**
 * Câu hỏi DANH MỤC / NHÓM HÀNG và cổng "chưa chắc mẫu" (05/10/2026, phiếu Desk 09/09 + 07/09).
 *
 * Nguyên tắc: khách hỏi một nhóm hàng ("có quần dài không", "có giày đá banh size 42 không") thì
 * không hỏi lại "mẫu nào", và mẫu đang bám khác loại bị bỏ; khách hỏi / chốt MỘT món chưa rõ ("áo
 * gió size M", "lấy cái áo gió sz M") thì vẫn hỏi lại một lần. Gói ngành giày thật (tầng 2).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { BOSTON13, hoiLaiFiller, lines, pack, query, scorer } from "./stage3-fixtures.mts";

const gate = new B.UncertainProductGate(scorer, lines);
const resolver = new B.CatalogResolver(scorer);
const NOW = "2026-10-05T09:00:00.000Z";
const anchored = resolver.resolve({ query: query({ productName: "boston 13" }), found: [BOSTON13] });

const base = (over: Partial<B.UncertainInput> = {}): B.UncertainInput => ({
  message: "", intent: "product_advice",
  entities: { productCode: "", productName: "", brand: "", productType: "" },
  resolution: null, hasImage: false, hasFocus: false,
  state: { hasRecentImageEvidence: false }, now: NOW, lexicon: pack.lexicon, hoiLai: hoiLaiFiller({}),
  ...over
});

test("phiếu 09/09: 'có quần dài thể thao ko shop' đang neo giày — AI tách loại, AI để trống loại, hay AI gán hỏi xác nhận: đều bỏ mẫu neo, không hỏi lại", () => {
  const message = "Mình có quần dài thể thao ko shop";
  for (const over of [
    { analysis: { productType: "quần dài" } },
    { analysis: {} },
    { analysis: {}, intent: "ask_product_confirmation" }
  ] as Partial<B.UncertainInput>[]) {
    const out = gate.apply(base({ message, resolution: anchored, hasFocus: true, ...over }));
    assert.ok(out !== null && (out.action === "drop_anchor" || out.action === "script_reply"), JSON.stringify(out));
    assert.equal(out.why, "type_mismatch_category");
    assert.deepEqual(out.dropped, ["JS4955"]);
  }
});

test("phiếu 09/09: câu danh mục không neo → không hỏi lại; chốt / hỏi size một món → vẫn hỏi lại", () => {
  assert.equal(gate.apply(base({ message: "Bên mình có bán tất chạy bộ không", intent: "ask_product_confirmation" })), null);
  for (const [message, intent] of [["Mình lấy cái áo gió chạy sz M nhé b", "place_order"], ["chốt xl shop ơi", "place_order"], ["áo gió còn size M ko shop", "ask_size"]] as const) {
    const out = gate.apply(base({ message, intent }));
    assert.ok(out !== null && out.action === "ask_clarification", `${message}: ${JSON.stringify(out)}`);
  }
});

test("phiếu 09/09: tin địa chỉ 'Quận Sơn Trà' / 'tôi quan tâm' không bị đọc thành loại 'quần'", () => {
  for (const message of ["Quận Sơn Trà Đà Nẵng nhé shop", "tôi quan tâm mẫu này"]) {
    const out = gate.apply(base({ message, resolution: anchored, hasFocus: true, analysis: {} }));
    assert.ok(out === null || (out.why !== "type_mismatch_category" && out.why !== "type_mismatch"), `${message}: ${JSON.stringify(out)}`);
  }
});

test("05/10: câu hỏi NHÓM HÀNG (landing đọc ra nhóm của catalog) không bị hỏi 'mẫu nào'; chốt đơn thì vẫn hỏi", () => {
  const message = "còn giày đá banh size 42 ko em";
  // LLM#1 hay gán "hỏi xác nhận sản phẩm" cho câu này: trước đây là "mẫu nào ạ?".
  const before = gate.apply(base({ message, intent: "ask_product_confirmation" }));
  assert.ok(before !== null && before.action === "ask_clarification", "không biết là nhóm → như cũ");
  assert.equal(gate.apply(base({ message, intent: "ask_product_confirmation", groupQuestion: true })), null);
  assert.equal(gate.apply(base({ message, intent: "ask_size", groupQuestion: true })), null);
  const order = gate.apply(base({ message: "chốt giày đá banh 42", intent: "place_order", groupQuestion: true }));
  assert.ok(order !== null && order.action === "ask_clarification", "chốt một món chưa rõ vẫn hỏi lại");
});

test("phiếu 07/09: 'áo gió chạy sz M' không có mẫu nào cùng loại → hỏi lại một lần (câu xin ảnh/tên của ngành), không đoán mẫu", () => {
  const out = gate.apply(base({ message: "áo gió chạy sz M", intent: "ask_size", analysis: { productName: "áo gió chạy", productType: "áo" } }));
  assert.ok(out !== null && out.action === "ask_clarification", JSON.stringify(out));
  assert.equal(out.why, "no_product");
  assert.match(out.reply, /ảnh hoặc tên mẫu/);
});
