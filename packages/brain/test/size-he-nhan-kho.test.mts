/**
 * Phiếu Desk 26/09/2026 (kho ghi size theo hệ riêng từng hãng) + 01/09/2026 (size quần áo theo nhãn kho),
 * phần bộ não:
 *   - đọc size khách nói KÈM HỆ ("US 9", "9us", "US nữ 7", "UK 7.5") để tra kho quy theo bảng hãng;
 *   - dòng kho khớp QUA QUY ĐỔI (`quy_doi`, landing ghi) là đúng size khách hỏi — không phải "gần đúng";
 *   - size áo / quần đọc ở luồng chính theo nhãn kho ("A/L" = L, "size A 92", "quần ... size 88").
 * Tầng 1 thử bằng ngành giả (cấu hình tự dựng); tầng 2 nạp gói `giay-chay` thật.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { runningShoesPack } from "./fixtures.mts";
import { cfg, item, size } from "./stage3-fixtures.mts";

const real = B.loadEntityConfig("giay-chay");
const lexicon = B.entityLexiconOf(runningShoesPack.lexicon, B.loadDialogueConfig("giay-chay"));
const shoes = new B.EntityExtractor(real, lexicon);

test("tầng 1: mẫu size có hệ của NGÀNH (nhóm he / so / gioi) cho ra nhãn 'HỆ số' — ngành giả", () => {
  const fake: B.EntityConfig = { ...real, sizePatterns: [], sizeTagPatterns: [], sizeBarePatterns: [], apparelSizePatterns: [], sizeSystemPatterns: ["\\b(?<he>us)\\s*(?<nu>w)?\\s*(?<so>\\d{1,2})\\b"] };
  const ex = new B.EntityExtractor(fake, lexicon);
  assert.equal(ex.extract("dress us 6 con khong").size, "US 6");
  assert.equal(ex.extract("dress us w 6").size, "US W 6");
  assert.equal(ex.extract("con hang khong").size, "");
  // Không khai mẫu nào = không đọc hệ nào.
  assert.equal(new B.EntityExtractor({ ...fake, sizeSystemPatterns: [] }, lexicon).extract("dress us 6").size, "");
});

test("tầng 2 (giày): size khách nói kèm hệ US / UK, cả viết dính và nam / nữ", () => {
  assert.equal(shoes.extract("puma size US 9 còn không").size, "US 9");
  assert.equal(shoes.extract("size 9us").size, "US 9");
  assert.equal(shoes.extract("9 US nha shop").size, "US 9");
  assert.equal(shoes.extract("mình đi US nữ 7").size, "US W 7");
  assert.equal(shoes.extract("uk 7.5 còn ko").size, "UK 7.5");
  assert.equal(shoes.extract("size uk 8,5").size, "UK 8.5");
  // Không đụng size EU, số trần, số tiền.
  assert.equal(shoes.extract("Giày chạy size 41").size, "41");
  assert.equal(shoes.extract("size 9").size, "");
  assert.equal(shoes.extract("giá 9 trăm us thôi").size, "");
});

test("phiếu 01/09: size áo / quần đọc ở luồng chính theo nhãn kho", () => {
  const a88 = shoes.extract("Mình có quần short gol adidas size A88 ko shop");
  assert.equal(a88.size, "A/88");
  assert.equal(a88.productCode, "");
  assert.equal(shoes.looksLikeAddress("Mình có quần short gol adidas size A88 ko shop"), false);
  assert.equal(shoes.extract("shop có quần golf size A/88 không").size, "A/88");
  assert.equal(shoes.extract("quần này size 88 còn ko").size, "A/88");
  assert.equal(shoes.extract("áo này có size A/L ko").size, "L");
  assert.equal(shoes.extract("mua áo size L").size, "L");
  assert.equal(shoes.extract("cho mình 88 cái").size, "");
  const ke = shoes.extract("KE9530 size A 92");
  assert.equal(ke.size, "A/92");
  assert.equal(ke.productCode, "KE9530");
  assert.equal(shoes.looksLikeAddress("gửi quần áo về Quận 1, số 88 ngõ 30 Láng Hạ"), true);
  assert.equal(shoes.extract("gửi quần áo về số 88 ngõ 30").size, "");
  assert.equal(shoes.extract("nặng 75 kg mặc size a 75 kg vừa không").size, "", "'a 75 kg' là cân nặng");
});

test("dòng kho khớp qua quy đổi (`quy_doi`) là đúng size khách hỏi, không phải nấc gần", () => {
  const m = new B.SizeMatcher(cfg.sizes);
  const uk = { ...size("UK 7.5"), quy_doi: "41" };
  assert.equal(m.matches([uk, size("UK 8")], "41").length, 1);
  assert.equal(m.nearest([uk], "41")?.approximate, false);
  assert.equal(m.matches([size("UK 7.5")], "41").length, 0, "không có dấu quy đổi thì không tự đoán");
  const puma = item("PU1", "PUMA VELOCITY NITRO 3", [uk]);
  const facts = B.buildStockFacts([puma], { code: "PU1", requestedSize: "41" }, cfg);
  assert.equal(facts?.stock?.size, "UK 7.5");
  assert.equal(facts?.stock?.approximate, false);
  const us = { ...size("UK 8"), quy_doi: "US 9" };
  assert.equal(B.buildStockFacts([item("PU2", "PUMA DEVIATE", [us])], { code: "PU2", requestedSize: "US 9" }, cfg)?.stock?.size, "UK 8");
});

// ---- cổng soát (g0): nhãn size câu bot nêu phải đến từ kết quả tra kho hoặc lời khách -------------

const gateSources = (over: Partial<B.GateSources> = {}): B.GateSources => ({
  shopSaid: "", customerSaid: "", policy: "", hoSo: null, found: [], stockFacts: null,
  lookups: { orderLooked: false }, links: {}, pronoun: "anh", uncertainProduct: false, site: "shop.example", tenShop: "Shop", ...over
});

test("tầng 1: nhãn biến thể câu bot nêu mà kho không trả, khách không nói → cắt câu (ngành giả, mẫu nhãn tự khai)", () => {
  const fake = { ...B.loadReplyGateConfig("giay-chay"), stockLabel: { label: "(?<![a-z0-9])v-([0-9]{2})(?![0-9])", note: "Dạ em kiểm lại rồi báo {khach} ạ." } };
  const gate = new B.ReplyGate(fake);
  const found = [item("X1", "DONG PHUC", [size("V-12")])];
  const ok = gate.run("Dạ mẫu này còn V-12 ạ.", gateSources({ found, customerSaid: "còn V-12 không" }));
  assert.equal(ok.reply, "Dạ mẫu này còn V-12 ạ.");
  const cut = gate.run("Dạ mẫu này còn V-12 ạ. Mẫu kia chỉ có đến V-08 thôi ạ.", gateSources({ found }));
  assert.equal(cut.reply, "Dạ mẫu này còn V-12 ạ.");
  assert.ok(cut.trace.includes("stock_label_not_looked_up"));
  assert.equal(gate.run("Chỉ có V-08 ạ.", gateSources({ found })).reply, "Dạ em kiểm lại rồi báo anh ạ.");
  // Kho trả bằng lời (hết size … size đang còn …) cũng là nguồn.
  assert.equal(gate.run("Dạ còn V-08 ạ.", gateSources({ toolText: "HET SIZE V-12: ... Size dang con: DONG PHUC (X1): V-08" })).reply, "Dạ còn V-08 ạ.");
});

test("phiếu 01/09 (gói giày): kho trả A/88, bot bịa 'chỉ có đến A82-A85' → cổng cắt câu đó", () => {
  const gate = new B.ReplyGate(B.loadReplyGateConfig("giay-chay"));
  const found = [item("Q1", "GOLF SHORT", [size("A/88")])];
  const r = gate.run("Dạ quần golf còn size A/88 ạ. Mẫu short kia chỉ có đến A82-A85 thôi ạ.", gateSources({ found, customerSaid: "Mình có quần short gol adidas size A88 ko shop" }));
  assert.doesNotMatch(r.reply, /A82|A85/);
  assert.ok(r.trace.includes("stock_label_not_looked_up"));
  assert.match(r.reply, /A\/88/);
  // Nhãn khách tự nêu thì được nhắc lại.
  assert.match(gate.run("Dạ size A90 bên em hết rồi ạ.", gateSources({ found, customerSaid: "có A90 không" })).reply, /A90/);
});
