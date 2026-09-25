/**
 * The dialogue frame: a terse customer message is the answer to what the page just said.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import "./fixtures.mts";

const builder = new B.DialogueFrameBuilder(B.loadDialogueConfig("giay-chay"));
const AT = "2026-09-24T09:00:00.000Z";
const BOSTON = { code: "JP9252", name: "Adizero Boston 13" };
const lexicon: B.FrameLexicon = { products: [BOSTON], siteHosts: ["toprun.site"], lines: [{ id: "boston", name: "Adizero Boston", aliases: ["boston"] }] };

const history = (...pageTexts: string[]): B.Turn[] => [
  { role: "customer", text: "boston 13 con khong shop", at: AT },
  ...pageTexts.map((text): B.Turn => ({ role: "shop", text, at: AT }))
];

test("page asked the size → '42' is a size answer", () => {
  const f = builder.build({ message: "42", turns: history("Dạ còn ạ, bác đi size bao nhiêu ạ?"), lexicon });
  assert.ok(f);
  assert.equal(f.kind, "asked_size");
  assert.equal(f.answer, "size");
  assert.equal(f.size, "42");
  assert.match(f.text, /^page vừa HỎI SIZE: ".*" → khách ĐANG TRẢ LỜI SIZE\.$/);
});

test("page gave the bank account → 'ok' is an agreement, 'thoi' a refusal", () => {
  const turns = history("Bác chuyển khoản vào STK 19036789012 Techcombank giúp em nhé");
  const f = builder.build({ message: "ok", turns, lexicon });
  assert.equal(f?.kind, "gave_bank");
  assert.equal(f?.answer, "agree");
  assert.equal(builder.build({ message: "thôi em ạ", turns, lexicon })?.answer, "decline");
  assert.equal(builder.build({ message: "màu này", turns, lexicon })?.answer, "refers_to_page_item");
});

test("fractional sizes: '44 2/3' and '41-1/3' are sizes in one spelling", () => {
  const turns = history("bác đi size bao nhiêu ạ?");
  assert.equal(builder.build({ message: "44 2/3", turns, lexicon })?.size, "44 2/3");
  assert.equal(builder.build({ message: "41-1/3", turns, lexicon })?.size, "41 1/3");
  assert.equal(builder.build({ message: "42 rưỡi", turns, lexicon })?.size, "42.5");
  assert.equal(builder.build({ message: "42 và 43", turns, lexicon })?.answer, "size");
  // Not a bare size: a short sentence about a size is "short", a long one "other".
  assert.equal(builder.build({ message: "42 co con khong", turns, lexicon })?.answer, "short");
  assert.equal(builder.build({ message: "cho em hoi size 42 ben shop con hang de giao trong tuan nay khong a", turns, lexicon })?.answer, "other");
});

test("a ?p= link the operator sent names the product", () => {
  const text = "Bác xem mẫu này nhé https://toprun.site/?p=JP9252";
  const hit = builder.productFromPageTurn(text, lexicon);
  assert.equal(hit?.code, "JP9252");
  const f = builder.build({ message: "đôi này còn 42 không", turns: history(text), lexicon });
  assert.equal(f?.kind, "sent_link");
  assert.equal(f?.productCode, "JP9252");
  assert.equal(f?.answer, "refers_to_page_item");
  assert.match(f?.text ?? "", /về mẫu Adizero Boston 13 JP9252/);
  assert.equal(builder.productFromPageTurn("https://toprun.site/product/JP9252", lexicon)?.code, "JP9252");
  assert.equal(builder.productFromPageTurn("mã JP9252 còn size 42 ạ", lexicon)?.code, "JP9252", "a bare code");
  assert.equal(builder.productFromPageTurn("https://toprun.site/?p=ZZZZ9999", lexicon), null, "a code not in the catalog");
});

test("a page that only names the line keeps the version it wrote", () => {
  const hit = builder.productFromPageTurn("Bác xem boston13 nhé, đang có size 42", lexicon);
  assert.equal(hit?.lineOnly, true);
  assert.equal(hit?.name, "Adizero Boston 13");
  assert.equal(hit?.code, "");
});

test("the page's last cluster: images only, confirm question, statement", () => {
  const turns: B.Turn[] = [
    { role: "shop", text: "[page gửi ảnh]", at: AT },
    { role: "shop", text: "", at: AT, imageCount: 2 }
  ];
  const f = builder.build({ message: "đôi bên trái", turns, lexicon });
  assert.equal(f?.kind, "sent_images");
  assert.equal(f?.pageImages, 3);
  assert.equal(builder.build({ message: "vâng", turns: history("Bác lấy đôi này nhé?"), lexicon })?.kind, "asked_confirm");
  assert.equal(builder.build({ message: "vâng", turns: history("Bác chờ em kiểm tra kho."), lexicon })?.kind, "statement");
  assert.equal(builder.build({ message: "ok", turns: [{ role: "customer", text: "alo", at: AT }], lexicon }), null, "the page never spoke");
});

test("the frame falls back to the focused product when the page names none", () => {
  const f = builder.build({ message: "42", turns: history("bác đi size bao nhiêu ạ?"), lexicon, focusedProduct: BOSTON });
  assert.equal(f?.productCode, "JP9252");
});
