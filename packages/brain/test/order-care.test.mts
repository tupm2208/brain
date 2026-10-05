/**
 * 05/10/2026 — phiếu Desk "khách đã có đơn đang chạy mà bot vẫn bán lại món đã đặt". Bảng Ca kiểm của
 * phiếu, phần bộ não thuần (không mô hình): luật đại từ "anh" ≠ "ảnh" (tầng 1 lời chung, thử cả ngành
 * khác giày), câu "ok" sau tin báo đơn ở bộ định tuyến, lưới "đã đặt trong đơn" ở cổng soát theo MÃ,
 * và khối "ĐƠN ĐANG CHẠY" cho mô hình.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { emptyShopProfile, type LinkedOrderBrief } from "@sp/contract";
import "./fixtures.mts";

const AT = "2026-10-02T09:00:00.000Z";
const profile = (): ReturnType<typeof emptyShopProfile> => {
  const p = emptyShopProfile();
  p.xungHo = { khach: "bác", shop: "em" };
  return p;
};
const shop = { profile: profile(), site: "shop.example", tenShop: "Shop Mẫu" };

/** A running order: JQ7704 size 41 1/3, deposit paid, parcel on its way with a link. */
const ORDER: LinkedOrderBrief = {
  maDon: "MAN-260922-574", giaiDoan: "dang_giao", vanDonDong: false, taoLuc: "2026-09-22T03:00:00.000Z",
  mon: [{ ma: "JQ7704", ten: "Mẫu Thử Đen", size: "41 1/3", sl: 1 }],
  tien: { tong: 2500000, daTra: 240000, conLai: 2260000 },
  vanDon: { ma: "SPXVN0123456789", hang: "spx", link: "https://spx.vn/track?SPXVN0123456789" }
};
const DONE: LinkedOrderBrief = { ...ORDER, maDon: "ORD-CU-1", giaiDoan: "da_ket_thuc", ketThuc: "da_giao", vanDon: undefined };

// ------------------------------------------------------------------ the pronoun (tier 1, language)

test("đại từ 'anh': tin gõ có dấu hay không dấu, 'anh' là đại từ trừ khi chữ quanh nó chắc về ảnh (giày + nhà thuốc)", () => {
  for (const pack of ["giay-chay", "nha-thuoc"]) {
    const cfg = B.loadReplyGateConfig(pack);
    const asks = new RegExp(cfg.photos.asks);
    const reads = (s: string): boolean => asks.test(B.gateNormalize(B.maskPronoun(s, cfg.daiTu)));
    for (const s of ["Cho anh hỏi hàng có sẵn hay hàng đặt vậy?", "cho anh 42", "gui anh ve dia chi cu", "Anh thật thích đôi này"]) {
      assert.equal(reads(s), false, `${pack}: "${s}" không phải xin ảnh`);
    }
    for (const s of ["cho xin anh that mau nay", "Gửi anh ảnh với", "cho em xin ảnh thật", "cho chi xin them hinh"]) {
      assert.equal(reads(s), true, `${pack}: "${s}" vẫn là xin ảnh`);
    }
  }
  // Tier 2 adds the industry's own words: "đôi" is a shoe word.
  const shoes = B.loadReplyGateConfig("giay-chay");
  assert.equal(new RegExp(shoes.photos.asks).test(B.gateNormalize(B.maskPronoun("xin anh doi nay", shoes.daiTu))), true);
  assert.equal(new RegExp(shoes.photos.asks).test(B.gateNormalize(B.maskPronoun("cho xin anh that doi nay", shoes.daiTu))), true);
});

test("cổng soát: 'Cho anh hỏi…' không bị chèn link xem ảnh; 'Gửi anh ảnh với' vẫn được link", () => {
  const gate = new B.ReplyGate(B.loadReplyGateConfig("giay-chay"));
  const found = [{ ma: "JQ7704", ten: "Mẫu Thử Đen", cac_size: [{ size: "42", gia: 2500000 }], anh: "", link: "https://shop.example/product/jq7704" }];
  const base = { shopSaid: "", customerSaid: "", policy: "", hoSo: null, found, stockFacts: null, lookups: { orderLooked: false }, links: {}, pronoun: "bác", uncertainProduct: false, site: "shop.example", tenShop: "Shop" };
  const q = gate.run("Dạ mẫu này là hàng đặt riêng theo đơn ạ.", { ...base, customerMessage: "Cho anh hỏi hàng có sẵn hay hàng đặt vậy?" });
  assert.ok(!q.trace.some((t) => t.startsWith("photo_request")), q.trace.join(","));
  assert.doesNotMatch(q.reply, /góc ảnh/);
  const p = gate.run("Dạ vâng ạ.", { ...base, customerMessage: "Gửi anh ảnh với" });
  assert.ok(p.trace.some((t) => t.startsWith("photo_request_send_link")), p.trace.join(","));
});

test("bộ định tuyến: 'cho anh 42' / 'gui anh ve dia chi cu' không thành khách xin ảnh", () => {
  const router = B.ruleRouterFor("giay-chay");
  for (const s of ["cho anh 42", "gui anh ve dia chi cu", "Cho anh hỏi hàng có sẵn hay hàng đặt vậy?"]) {
    const out = router.route({ message: s, aiIntent: { intent: "unknown", confidence: 0.5, matched: [] }, ...shop });
    assert.ok(!out.pipeline.includes("customer_requests_photos"), `${s}: ${out.pipeline.join(",")}`);
  }
  const photo = router.route({ message: "Gửi anh ảnh với", aiIntent: { intent: "unknown", confidence: 0.5, matched: [] }, ...shop });
  assert.ok(photo.pipeline.includes("customer_requests_photos"), photo.pipeline.join(","));
});

// ------------------------------------------------------------------ "ok" after the page's order notice

const notice = { role: "shop" as const, text: "Dạ đơn MAN-260922-574 của bác đã gửi đi, mã vận đơn SPXVN0123456789, bác theo dõi tại https://spx.vn/track?SPXVN0123456789 ạ", at: AT };

test("có đơn đang chạy, page vừa gửi mã vận đơn + link, khách 'Ok shop' (kể cả mô hình đoán hỏi size) → câu ngắn cố định", () => {
  for (const pack of ["giay-chay", "nha-thuoc"]) {
    const router = B.ruleRouterFor(pack);
    const out = router.route({ message: "Ok shop", turns: [notice], aiIntent: { intent: "ask_size", confidence: 0.8, matched: [] }, orders: [ORDER], ...shop });
    assert.equal(out.decision.kind, "script_reply", `${pack}: ${out.pipeline.join(",")}`);
    assert.equal(out.decision.reason, "order_notice_ack");
    assert.equal(out.decision.kind === "script_reply" ? out.decision.reply : "", "Dạ vâng ạ, có gì bác cứ nhắn em nhé.");
    assert.doesNotMatch(out.decision.kind === "script_reply" ? out.decision.reply : "", /size|\?/);
    // "ok" once more after that sentence: nothing to add.
    const again = router.route({ message: "ok", turns: [notice, { role: "customer", text: "Ok shop", at: AT }, { role: "shop", text: "Dạ vâng ạ, có gì bác cứ nhắn em nhé.", at: AT }], orders: [ORDER], ...shop });
    assert.equal(again.decision.kind, "silent");
  }
});

test("không phải câu kết thúc: page đang hỏi, page chào món thứ hai, hoặc khách không có đơn đang chạy", () => {
  const router = B.ruleRouterFor("giay-chay");
  const asked = router.route({ message: "ok", turns: [notice, { role: "shop", text: "Dạ bác muốn đổi sang size 42 trong đơn này ạ?", at: AT }], orders: [ORDER], ...shop });
  assert.notEqual(asked.decision.reason, "order_notice_ack");
  const second = router.route({ message: "ok", turns: [notice, { role: "customer", text: "còn đôi trắng không em", at: AT }, { role: "shop", text: "Dạ còn ạ, bác chốt thì em lên đơn luôn nhé", at: AT }], orders: [ORDER], ...shop });
  assert.notEqual(second.decision.reason, "order_notice_ack");
  const noOrder = router.route({ message: "Ok shop", turns: [notice], orders: [DONE], ...shop });
  assert.notEqual(noOrder.decision.reason, "order_notice_ack");
  const none = router.route({ message: "Ok shop", turns: [notice], ...shop });
  assert.notEqual(none.decision.reason, "order_notice_ack");
});

// ------------------------------------------------------------------ the "already in your order" net

test("lưới cuối: nháp báo HẾT đúng mã + size trong đơn → 'đã đặt trong đơn', bỏ câu gợi ý mẫu thay thế", () => {
  const gate = new B.ReplyGate(B.loadReplyGateConfig("giay-chay"));
  const stockFacts = { productCode: "JQ7704", productName: "Mẫu Thử Đen", requestedSize: "41 1/3", stock: null, price: 2500000, otherKho: [], variantsAvailable: [] } as B.StockFacts;
  const found = ["JQ7704", "JQ7705"].map((ma) => ({ ma, ten: "Mẫu Thử", cac_size: [{ size: "42", gia: 2500000 }], anh: "", link: "" }));
  const base = {
    shopSaid: "", customerSaid: "26cm 41 1/3", customerMessage: "26cm 41 1/3", policy: "", hoSo: null, found, stockFacts,
    lookups: { orderLooked: true }, links: {}, pronoun: "bác", uncertainProduct: false, site: "shop.example", tenShop: "Shop",
    runningOrders: [{ maDon: ORDER.maDon, giaiDoan: ORDER.giaiDoan, taoLuc: ORDER.taoLuc, mon: ORDER.mon }],
    customerLines: [{ text: "26cm 41 1/3", at: AT }], focusCode: "JQ7704"
  };
  const fixed = gate.run("Dạ mẫu này size 41 1/3 bên em hết rồi, bác tham khảo JQ7705 nhé ạ.", base);
  assert.ok(fixed.trace.includes("ordered_item_out_of_stock_fixed"), fixed.trace.join(","));
  assert.match(fixed.reply, /JQ7704\) size 41 1\/3 bác đã đặt trong đơn MAN-260922-574/);
  assert.match(fixed.reply, /đang giao/);
  assert.doesNotMatch(fixed.reply, /JQ7705|hết/);
  // The alternative in the NEXT sentence goes too.
  const two = gate.run("Dạ JQ7704 size 41 1/3 hết hàng rồi ạ. Bác có thể tham khảo mẫu khác cùng dòng nhé.", base);
  assert.doesNotMatch(two.reply, /tham khảo|hết/);
  // Another code / another size / only a colour (no code, no "this"): left alone.
  for (const reply of ["Dạ JQ7705 size 41 1/3 hết rồi ạ.", "Dạ size 41 hết rồi ạ.", "Dạ màu đen size 41 1/3 hết rồi ạ."]) {
    const r = gate.run(reply, base);
    assert.ok(!r.trace.includes("ordered_item_out_of_stock_fixed"), `${reply}: ${r.trace.join(",")}`);
  }
  // The customer said they buy ONE MORE after the order: "out of stock" is the true answer.
  const more = gate.run("Dạ mẫu này size 41 1/3 bên em hết rồi ạ.", { ...base, customerLines: [{ text: "lấy thêm 1 đôi 41 1/3 nữa", at: AT }] });
  assert.ok(!more.trace.includes("ordered_item_out_of_stock_fixed"));
  // "lấy thêm 200k" is not buying more.
  const money = gate.run("Dạ mẫu này size 41 1/3 bên em hết rồi ạ.", { ...base, customerLines: [{ text: "lấy thêm 200k ship nhé", at: AT }] });
  assert.ok(money.trace.includes("ordered_item_out_of_stock_fixed"));
  // No running order: nothing to do.
  const no = gate.run("Dạ mẫu này size 41 1/3 bên em hết rồi ạ.", { ...base, runningOrders: [] });
  assert.ok(!no.trace.includes("ordered_item_out_of_stock_fixed"));
});

test("lưới cuối là tầng 1: ngành khác (nhà thuốc), mã khác, cũng chỉ khớp theo mã", () => {
  const gate = new B.ReplyGate(B.loadReplyGateConfig("nha-thuoc"));
  const base = {
    shopSaid: "", customerSaid: "", policy: "", hoSo: null, found: [{ ma: "TH1234", ten: "Thuốc Thử", cac_size: [{ size: "Hộp 10 vỉ", gia: 50000 }], anh: "", link: "" }], stockFacts: null, lookups: { orderLooked: true }, links: {}, pronoun: "anh",
    uncertainProduct: false, runningOrders: [{ maDon: "DH-77", giaiDoan: "dang_xu_ly", taoLuc: AT, mon: [{ ma: "TH1234", ten: "Thuốc Thử", size: "Hộp 10 vỉ" }] }]
  };
  const r = gate.run("Dạ TH1234 hộp 10 vỉ bên em hết hàng rồi ạ.", base);
  assert.ok(r.trace.includes("ordered_item_out_of_stock_fixed"), r.trace.join(","));
  assert.match(r.reply, /đã đặt trong đơn DH-77/);
});

// ------------------------------------------------------------------ the block the models read

test("khối ĐƠN ĐANG CHẠY: đơn đang chạy có luật không bán lại + không tự nói đã nhận tiền; đơn cũ chỉ để biết", () => {
  const blocks = B.loadNoteTexts("giay-chay").blocks;
  const note = B.renderOrderNote([ORDER, DONE], blocks);
  assert.match(note, /DON DANG CHAY CUA KHACH/);
  assert.match(note, /MAN-260922-574 — dang giao — mon: Mẫu Thử Đen \(JQ7704\) size 41 1\/3/);
  assert.match(note, /da tra 240\.000đ/);
  assert.match(note, /https:\/\/spx\.vn\/track/);
  assert.match(note, /KHONG ban lai mon da co trong don/);
  assert.match(note, /KHONG BAO GIO tu noi da nhan tien/);
  assert.match(note, /DON CU DA KET THUC[\s\S]*ORD-CU-1/);
  // A cancelled waybill on a running order: no link, never "on its way".
  const closed = B.renderOrderNote([{ ...ORDER, giaiDoan: "dang_xu_ly", vanDonDong: true }], blocks);
  assert.doesNotMatch(closed, /spx\.vn/);
  assert.match(closed, /VAN DON DA DONG/);
  // Only a finished order: no "running" rules at all.
  assert.doesNotMatch(B.renderOrderNote([DONE], blocks), /DON DANG CHAY/);
  assert.equal(B.renderOrderNote([], blocks), "");
  assert.deepEqual([...B.orderedItemKeys([ORDER, DONE])], ["JQ7704"]);
  assert.equal(B.isOrderedItem([ORDER], "jq-7704"), true);
});
