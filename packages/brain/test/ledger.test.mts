/**
 * The conversation ledger ("SO HOI THOAI"): one entry per product, accumulated, never downgraded.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import "./fixtures.mts";

const texts = B.loadLedgerTexts();
const ledger = new B.ConversationLedger(texts);
const T = (m: number): string => new Date(Date.UTC(2026, 8, 24, 9, m)).toISOString();
const BOSTON = { code: "JP9252", name: "Adizero Boston 13", brand: "adidas" };

test("tier 1 ships the ledger wording", () => {
  assert.match(texts.header, /SO HOI THOAI/);
  assert.equal(texts.statusByIntent["place_order"], "chot");
});

test("upsert by code: the same product asked twice is one line with both sizes", () => {
  let l = ledger.update(undefined, { now: T(0), intentId: "ask_size", size: "42", matched: { item: { ...BOSTON, price: 3190000 }, reliable: true, stock: { requestedSize: "42", inStock: true } } });
  l = ledger.update(l, { now: T(5), intentId: "ask_size", size: "43", matched: { item: { code: "jp9252" }, reliable: true, stock: { requestedSize: "43", inStock: false } } });
  assert.equal(l.products.length, 1);
  const p = l.products[0]!;
  assert.deepEqual(p.askedSizes, ["42", "43"]);
  assert.equal(p.name, "Adizero Boston 13", "the name from the first turn is kept");
  assert.equal(p.quotedPrice, "3.190.000đ");
  assert.equal(p.stockAnswer, "size 43: hết");
  assert.equal(p.status, "het_size");
  assert.equal(p.firstAt, T(0));
  assert.equal(p.lastAt, T(5));
});

test("upsert by name: a product the catalog did not match is remembered once, without price or stock", () => {
  let l = ledger.update(undefined, { now: T(0), mentionedName: "Vaporfly 4", mentionedBrand: "nike" });
  l = ledger.update(l, { now: T(1), mentionedName: "vaporfly 4", size: "42", intentId: "ask_size" });
  assert.equal(l.products.length, 1);
  assert.equal(l.products[0]!.source, "chu_khach");
  assert.equal(l.products[0]!.note, texts.unmatchedNote);
  assert.equal(l.products[0]!.quotedPrice, undefined);
  assert.equal(l.products[0]!.status, "hoi_size");
});

test("'chot' is never downgraded by a later out-of-stock answer", () => {
  let l = ledger.update(undefined, { now: T(0), intentId: "place_order", matched: { item: BOSTON, reliable: true } });
  assert.equal(l.products[0]!.status, "chot");
  l = ledger.update(l, { now: T(3), intentId: "ask_size", size: "44", matched: { item: BOSTON, reliable: true, stock: { requestedSize: "44", inStock: false } } });
  assert.equal(l.products[0]!.status, "chot", "an out-of-stock size undid the customer's decision");
  l = ledger.update(l, { now: T(4), orderPlaced: true });
  assert.equal(l.products[0]!.status, "da_dat");
  assert.match(ledger.render(l), /khách ĐÃ CHỐT|đã lên đơn/);
});

test("'dung roi', 'ok anh', an address are not products", () => {
  for (const said of ["dung roi", "ok anh", "vang a", "cam on shop", "so 12 phuong 5 quan 3", "1234"]) {
    const l = ledger.update(undefined, { now: T(0), mentionedName: said });
    assert.equal(l.products.length, 0, `"${said}" became a product`);
  }
});

test("an external product keeps its source and gets the closing note when closed", () => {
  let l = ledger.update(undefined, { now: T(0), intentId: "place_order", externalProduct: { name: "Vaporfly xach tay", price: 4500000 } });
  assert.equal(l.products[0]!.source, "sp_ngoai");
  assert.equal(l.products[0]!.quotedPrice, "4.500.000đ");
  // A later image that names the same product must not turn it into a catalog item.
  l = ledger.update(l, { now: T(2), imageProducts: [{ name: "Vaporfly xach tay" }] });
  assert.equal(l.products.length, 1);
  assert.equal(l.products[0]!.source, "sp_ngoai");
  const text = ledger.render(l);
  assert.match(text, /SP NGOÀI HỆ THỐNG/);
  assert.match(text, /MON NGOAI HE THONG DANG CHOT/);
});

test("a photo upgrades the source, and the ledger is cut at 12 products keeping the newest", () => {
  let l = ledger.update(undefined, { now: T(0), mentionedName: "Adizero Boston 13" });
  l = ledger.update(l, { now: T(1), imageProducts: [{ name: "Adizero Boston 13" }] });
  assert.equal(l.products[0]!.source, "anh_khach_gui");
  for (let i = 0; i < 14; i += 1) {
    l = ledger.update(l, { now: T(2 + i), matched: { item: { code: `C${i}`, name: `Mau ${i}` }, reliable: true } });
  }
  assert.equal(l.products.length, B.LEDGER_PRODUCT_LIMIT);
  assert.equal(l.products[l.products.length - 1]!.code, "C13");
  assert.ok(!l.products.some((p) => p.code === "C0"), "the oldest entry should have been dropped");
});

test("orders, summaries and the render match Desk's wording", () => {
  let l = ledger.update(undefined, {
    now: T(0), intentId: "ask_price", matched: { item: { ...BOSTON, price: 3190000 }, reliable: true, alternative: { code: "JS4955", name: "Adizero Boston 13 den", size: "42", price: 3190000 } },
    orders: [{ id: "ORD-1001", status: "Đang giao", tracking: "SPX123", items: ["JP9252 Adizero Boston 13 42"] }],
    summary: "Khach hoi gia Boston 13", customerGoal: "mua giay chay HM", customerMessage: "boston 13 gia bao nhieu"
  });
  l = ledger.update(l, { now: T(1), summary: "Khach hoi gia Boston 13" });
  assert.equal(l.aiSummaries.length, 1, "an identical summary is not repeated");
  const text = ledger.render(l);
  assert.match(text, /^SO HOI THOAI — SAN PHAM DA NHAC/);
  assert.match(text, /1\) JP9252 Adizero Boston 13 \(adidas\) \| nguon: khách nhắc bằng chữ \| gia da bao: 3\.190\.000đ \| trang thai: đã hỏi giá/);
  assert.match(text, /2\) JS4955 Adizero Boston 13 den .*ton da tra loi: size 42: còn .*\(shop chào thay thế\)/);
  assert.match(text, /DON HANG DA TRA CUU: ORD-1001 — Đang giao — van don SPX123 — JP9252 Adizero Boston 13 42/);
  assert.match(text, /DIEN BIEN HOI THOAI/);
  assert.match(text, /MUC TIEU KHACH \(moi nhat\): mua giay chay HM/);
  assert.match(text, /CHU DE DANG DO: Khach hoi gia Boston 13/);
});

test("image labels: product, receipt (by content only), shortlist, OCR, unknown", () => {
  assert.equal(ledger.imageLabel({ kind: "product", code: "JP9252", name: "Adizero Boston 13" }), "[ảnh: JP9252 Adizero Boston 13]");
  const receipt = ledger.recognizeImage({ visibleTexts: ["Chuyển tiền thành công 3.190.000 VND cho đơn ORD-1001"] });
  assert.deepEqual(receipt, { kind: "receipt", amount: "3.190.000", order: "ORD-1001" });
  assert.equal(ledger.imageLabel(receipt!), "[ảnh: biên lai chuyển khoản 3.190.000đ đơn ORD-1001]");
  // A sticker in a payment conversation is NOT a receipt: nothing in its content says so.
  assert.equal(ledger.recognizeImage({ visibleTexts: [], visionOk: false }), null);
  const choices = ledger.recognizeImage({ match: { action: "ask_choose", selected: [{ code: "A1", name: "Mau A" }, { code: "B2", name: "Mau B" }] } });
  assert.equal(ledger.imageLabel(choices!), "[ảnh: gần với A1 Mau A / B2 Mau B — chưa xác nhận mẫu nào]");
  const ocr = ledger.recognizeImage({ ocr: { brand: "adidas", name: "Boston 13", code: "JP9252" } });
  assert.equal(ledger.imageLabel(ocr!), "[ảnh: đọc được adidas Boston 13 JP9252 — chưa khớp kho]");
  assert.equal(ledger.imageLabel({ kind: "unknown" }), "[ảnh: không đọc được tên/mã sản phẩm]");
  const confident = ledger.recognizeImage({ match: { action: "auto_match", primary: { code: "JP9252", name: "Adizero Boston 13" } } });
  assert.equal(confident?.kind, "product");
});
