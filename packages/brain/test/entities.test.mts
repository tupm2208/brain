/**
 * The entity extractor: sizes in every spelling customers use, tag readings, phone, code, brand, budget.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { runningShoesPack } from "./fixtures.mts";

const cfg = B.loadEntityConfig("giay-chay");
const extractor = new B.EntityExtractor(cfg, B.entityLexiconOf(runningShoesPack.lexicon, B.loadDialogueConfig("giay-chay")));
const AT = "2026-09-24T09:00:00.000Z";

test("the tag → size chart came over with its numbers", () => {
  assert.equal(cfg.sizeChart.length, 16);
  assert.equal(extractor.chart.fromTag(26.5)?.size, "42");
  assert.equal(extractor.chart.fromTag("265")?.size, "42", "millimetres on the tag");
  assert.equal(extractor.chart.fromTag(28)?.size, "44");
  assert.equal(extractor.chart.fromTag(28.5)?.size, "44 2/3");
  assert.equal(extractor.chart.fromTag(28)?.daiChanCm, 26.5);
  assert.equal(extractor.chart.fromTag(31), null, "no such tag");
});

test("sizes: '42 rưỡi', '41-1/3', '44 2/3', '42,5', letters", () => {
  assert.equal(extractor.extract("mình đi size 42 rưỡi").size, "42.5");
  assert.equal(extractor.extract("có 41-1/3 không shop").size, "41 1/3");
  assert.equal(extractor.extract("chốt 44 2/3 nhé").size, "44 2/3");
  assert.equal(extractor.extract("size 42,5 còn không").size, "42.5");
  assert.equal(extractor.extract("size 42").sizeSource, "explicit");
  const letter = extractor.extract("cho e dat 1 ao L");
  assert.equal(letter.size, "L");
  assert.equal(letter.sizeSource, "letter");
  assert.equal(extractor.extract("quan short size a88").size, "A/88");
});

test("tag readings: 'size 265' / 'size 26,5' convert through the chart", () => {
  const mm = extractor.extract("size 265 còn không");
  assert.equal(mm.size, "42");
  assert.equal(mm.sizeSource, "tag");
  assert.match(mm.sizeNote, /tem 26.5cm/);
  assert.equal(extractor.extract("mình đi size 26,5").size, "42");
});

test("'size 28' bare from an adult-shoe customer is 28cm on the tag = size 44", () => {
  const e = extractor.extract("size 28 còn không shop");
  assert.equal(e.size, "44");
  assert.equal(e.sizeSource, "bare_tag");
  // With a candidate whose labels are adult sizes it still converts; a kids' shoe with label "28" does not.
  const adult: B.SizeCandidate = { code: "JP9252", name: "Adizero Boston 13", sizes: ["41 1/3", "42", "44"] };
  assert.equal(extractor.extract("size 28 còn không shop", { candidates: [adult] }).size, "44");
  const kids: B.SizeCandidate = { code: "K1", name: "Tensaur Run K", sizes: ["28", "29", "30"] };
  assert.equal(extractor.extract("size 28 còn không shop", { candidates: [kids] }).size, "28");
  // Guards: apparel, kids in the text, a unit after the number, a foot measurement, a date.
  assert.equal(extractor.extract("áo size 28 còn không").size, "28");
  assert.equal(extractor.extract("mua cho cháu size 28").size, "28");
  assert.equal(extractor.extract("size 28cm").sizeSource, "", "cm after the number is a foot measurement, not a size");
  assert.equal(extractor.extract("chân 28 thì size nào", { turns: [] }).size, "");
});

test("size recovered from a recent customer message, skipping negated ones", () => {
  const turns: B.Turn[] = [
    { role: "customer", text: "khong lay 36 nua, lay 37 1/3 va 38", at: AT },
    { role: "shop", text: "dạ vâng ạ", at: AT }
  ];
  assert.equal(extractor.recoverSizeFromRecentCustomer(turns), "37 1/3 va 38");
  assert.equal(extractor.recoverSizeFromRecentCustomer([{ role: "customer", text: "size 42,5 nhe", at: AT }]), "42.5");
});

test("phone, product code, brand, need, foot form, gender, closing signals", () => {
  const e = extractor.extract("chốt JP9252 size 42 cho mình, sđt 0905 123 456, chân bè, chạy marathon, hãng adidas nhé");
  assert.equal(e.phone, "0905123456");
  assert.equal(e.productCode, "JP9252");
  assert.equal(e.brand, "adidas");
  assert.equal(e.footForm, "wide");
  assert.match(e.need, /marathon/);
  assert.deepEqual(e.closingSignals, ["chot"]);
  assert.equal(extractor.extract("có adidat samba không").brand, "adidas", "an alias of the pack");
  assert.equal(extractor.extract("mã ie0000 còn không").productCode, "IE0000", "the industry's code shape, any case");
  assert.equal(extractor.extract("COD được không").productCode, "", "COD is ignored");
  assert.equal(extractor.extract("size A88 có không").productCode, "", "an apparel size is not a code");
  assert.equal(extractor.extract("giày cho nữ").gender, "Nữ");
});

test("budget: 'tầm 1tr2', 'dưới 2 triệu', 'từ 1tr đến 2tr', 'trên 1 triệu'", () => {
  assert.deepEqual([extractor.extract("tầm 1tr2").budgetMin, extractor.extract("tầm 1tr2").budgetMax], [0, 1200000]);
  assert.equal(extractor.extract("dưới 2 triệu").budgetMax, 2000000);
  const range = extractor.extract("từ 1tr đến 2tr");
  assert.deepEqual([range.budgetMin, range.budgetMax], [1000000, 2000000]);
  assert.deepEqual([extractor.extract("trên 1 triệu có gì").budgetMin, extractor.extract("trên 1 triệu có gì").budgetMax], [1000000, 0]);
  assert.equal(extractor.extract("size 42").budgetMax, 0);
});

test("address: after a marker, after a phone, and a whole address block", () => {
  assert.equal(extractor.extract("địa chỉ: 12 Lê Lợi, Đà Nẵng").address, "12 Lê Lợi, Đà Nẵng");
  assert.equal(extractor.extract("0905123456, 12 Le Loi Da Nang").address, "12 Le Loi Da Nang");
  assert.equal(extractor.looksLikeAddress("145b/4 ấp Bạch Lâm xã Gia Tân huyện Thống Nhất"), true);
  assert.equal(extractor.looksLikeAddress("Minh co quan short gol adidas size A88 ko shop"), false, "'quan short' is trousers, not a district");
  assert.equal(extractor.extract("145b/4 ấp Bạch Lâm xã Gia Tân").size, "", "a house number is not a size");
});

test("an attachment placeholder is not a word, and an order question names no product (25/09/2026)", () => {
  // "[1 tệp đính kèm]" once became the product name "tep dinh kem" and sent the finder after it.
  for (const text of ["[1 tệp đính kèm]", "[khách gửi ảnh]", "[2 tep dinh kem] còn size 42 không"]) {
    const e = extractor.extract(text);
    assert.doesNotMatch(e.productName, /tep|dinh|kem|khach|gui|anh/, text);
  }
  assert.equal(extractor.extract("[2 tep dinh kem] còn size 42 không").size, "42", "the words around the placeholder are still read");
  // "đơn của tôi đổi sang size 43" is about an order: no product-name hint, or the cascade looks for "don cua toi".
  assert.equal(extractor.extract("đơn của tôi đổi sang size 43 được không").productName, "");
  assert.equal(extractor.extract("đơn của tôi đổi sang size 43 được không").size, "43");
  assert.equal(extractor.extract("boston 13 còn size 42 không").productName, "boston", "a real product name still comes through");
  // kb2-19 / kb2-07 (25/09/2026): a fraction, or stop words only, is no product name.
  assert.equal(extractor.extract("size 41 1/3 nhé").productName, "");
  assert.equal(extractor.extract("size 41 1/3 nhé").size, "41 1/3");
  // kb2-12: a sock size is a RANGE label; it stays as the warehouse writes it.
  assert.equal(extractor.extract("tất size 43-46 còn không").size, "43-46");
  assert.equal(extractor.extract("tất 43–46 còn ko").size, "43-46");
  assert.equal(extractor.extract("cho mình đổi sang size 43 được không, mình đặt hôm qua").productName, "");
  assert.equal(extractor.extract("chạy HM pace 4:30, size 42, cần đôi đua, 3-4 triệu").productName, "");
});
