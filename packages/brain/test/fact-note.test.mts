/**
 * The system note for the level-2 agent: tracking first, cut at 4000 without splitting a link,
 * no "found in stock" list on a turn with an image.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import "./fixtures.mts";

const texts = B.loadNoteTexts("giay-chay");
const TRACK = "https://spx.vn/track/SPXVN0123456789";
const FOUND: B.FoundProduct[] = [
  { code: "JS4955", name: "Adizero Boston 13", price: 3190000, variants: ["41", "42", "42 2/3"] },
  { code: "JP9252", name: "Adizero Boston 13 den", price: 3190000, variants: ["40"] },
  { code: "jp9252", name: "trung ma", price: 1 }
];

test("VAN_DON goes first, whatever else the turn proved", () => {
  const note = B.FactNoteComposer.compose({
    site: "toprun.site", customerPronoun: "bác",
    conversationSummary: "SO HOI THOAI — abc",
    found: FOUND,
    tracking: { orderId: "ORD-1001", statusLabel: "Đang giao", trackingCode: "SPXVN0123456789", trackingUrl: TRACK }
  }, texts);
  assert.match(note, /^VAN DON CUA KHACH — don ORD-1001 \(Đang giao\), ma van don SPXVN0123456789\. LINK TRA CUU DUNG \(dan NGUYEN VAN, day la thu khach can\): https:\/\/spx\.vn\/track\/SPXVN0123456789 /);
  assert.match(note, /toprun\.site\/product\/\.\.\./);
  assert.ok(note.indexOf("VAN DON") < note.indexOf("SO HOI THOAI"));
  assert.ok(note.indexOf("SO HOI THOAI") < note.indexOf("HE THONG DA TIM THAY"));
});

test("DA_TIM_THAY lists each code once with price and sizes, in the industry's words", () => {
  const note = B.FactNoteComposer.compose({ found: FOUND }, texts);
  assert.match(note, /HE THONG DA TIM THAY TRONG KHO theo ten khach nhac/);
  assert.match(note, /• Adizero Boston 13 \(JS4955\) — 3\.190\.000đ — size con: 41, 42, 42 2\/3/);
  assert.equal(note.match(/JP9252/g)?.length, 1, "a code listed twice");
  assert.match(note, /Can size cu the thi goi tra_kho theo MA/);
  assert.match(note, /TUYET DOI KHONG noi "chua co/);
});

test("DA_TIM_THAY is withheld on a turn with an image", () => {
  const note = B.FactNoteComposer.compose({ found: FOUND, hasImage: true, conversationSummary: "x" }, texts);
  assert.doesNotMatch(note, /HE THONG DA TIM THAY/);
  assert.equal(note, "x");
});

test("cut at 4000 from the end, never inside a link", () => {
  const link = "https://toprun.site/collections/quan-dai-the-thao-nam-nu-chay-bo-tap-gym-di-choi-mua-he-2026";
  const facts: B.TurnFacts = {
    site: "toprun.site", customerPronoun: "bác",
    conversationSummary: "tu ".repeat(1400),
    found: Array.from({ length: 6 }, (_, i) => ({ code: `MA${i}`, name: `Mau so ${i} ten rat dai de chiem cho`, price: 2190000, variants: Array.from({ length: 16 }, (_, k) => String(36 + k)) })),
    productType: { type: "quần dài", link, variant: "L" },
    tracking: { orderId: "ORD-1", trackingCode: "SPX1", trackingUrl: TRACK }
  };
  const note = B.FactNoteComposer.compose(facts, texts);
  assert.ok(note.length <= B.NOTE_LIMIT);
  assert.ok(note.length > 3500, "the fixture should be long enough to force a cut");
  for (const m of note.matchAll(/https?:\/\/\S+/g)) {
    assert.ok([link, TRACK].includes(m[0]) || m[0].startsWith("toprun.site"), `a link was cut: ${m[0]}`);
  }
  assert.ok(!/\S+$/.test(note) || !note.endsWith("-"), "the note ends mid-token");
  const summary = B.FactNoteComposer.compose({ conversationSummary: "a".repeat(3000) }, texts);
  assert.equal(summary.length, B.SUMMARY_LIMIT);
});

test("DON_DOI_SIZE, SIZE_TEM, MAU_KHAC, MON, LOAI_HANG and PHO_THONG carry the industry wording", () => {
  const note = B.FactNoteComposer.compose({
    site: "toprun.site", customerPronoun: "bác",
    orderExchange: { orderId: "ORD-7", allowed: true, note: "Kho order chua di mua." },
    variantHint: { variant: "44", bareJp: true, raw: "28", tem: "28.0" },
    otherVariants: { productName: "Adizero Boston 13", productCode: "JS4955", requestedVariant: "42", items: [{ code: "JP9252", name: "Boston 13 den", price: 3190000, variants: ["42"], partner: true }], filterLink: "https://toprun.site/?line=boston" },
    sport: { label: "Bóng rổ", purpose: "bong_ro", count: 12, variant: "42" },
    productType: { type: "quần dài", link: "https://toprun.site/?type=quan" },
    everyday: { purpose: "di_hoc_di_choi_da_nang", variant: "39", gender: "nu", groupLinks: "• Nhóm A | https://toprun.site/?g=a" }
  }, texts);
  assert.match(note, /DON CUA KHACH \(ORD-7\) — DOI SIZE: CON DOI DUOC\. Kho order chua di mua\./);
  assert.match(note, /^SIZE CUA KHACH .*: size 44\. Khach go "size 28" khong kem cm = so cm TEM he Nhat.* Goi tra_kho voi size="44"\. Khi nhac lai phai ghi dung cap theo bang: size 44 \(tem 28,0cm\);/m);
  assert.match(note, /KHACH HOI MAU\/SIZE KHAC cua Adizero Boston 13 \(JS4955\) size 42\./);
  assert.match(note, /• Boston 13 den \(JP9252\) — 3\.190\.000đ — hàng đối tác, order thêm ngày — size con: 42/);
  assert.match(note, /"Bác xem đủ các màu\/size còn hàng tại: https:\/\/toprun\.site\/\?line=boston"/);
  assert.match(note, /KHACH HOI THANG MON "Bóng rổ" — shop CO ban mon nay \(12 mau con hang\)\. Goi tra_kho voi muc_dich="bong_ro" \(ten de rong\), size="42"/);
  assert.match(note, /KHACH HOI LOAI HANG \(quần dài\) — shop CO ban tren web toprun\.site/);
  assert.match(note, /NHU CAU PHO THONG .*muc_dich="di_hoc_di_choi_da_nang", size="39", gioi_tinh="nu"/);
  assert.match(note, /Goi khach la "bác", KHONG goi "minh"\. Tra loi THEO NHOM/);
  // Desk's real order: tracking, then the size hint, before everything else.
  assert.ok(note.indexOf("SIZE CUA KHACH") < note.indexOf("KHACH HOI MAU/SIZE KHAC"));
});

test("an industry without its own file uses tier 1's generic wording", () => {
  const pharmacy = B.loadNoteTexts("nha-thuoc");
  const note = B.FactNoteComposer.compose({ found: [{ code: "PARA500", name: "Paracetamol", variants: ["500mg"] }] }, pharmacy);
  assert.match(note, /• Paracetamol \(PARA500\) — con: 500mg/);
  assert.match(note, /Can bien the cu the thi goi cong cu tra kho theo MA/);
  assert.doesNotMatch(note, /tra_kho|size/);
  assert.equal(B.FactNoteComposer.compose({}, pharmacy), "");
});
