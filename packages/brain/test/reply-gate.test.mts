/**
 * The reply gate (stage 6): one test per Desk trace name. Every regex and sentence comes from
 * `loi-chung/cong-soat-chung.json` ⊕ `nganh/giay-chay/cong-soat.json`, so these tests also pin the data.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { emptyShopProfile, type ShopProfile } from "@sp/contract";
import { ADIOS9, BOSTON13, cfg as matching, item, size } from "./stage3-fixtures.mts";

const cfg = B.loadReplyGateConfig("giay-chay");
const gate = new B.ReplyGate(cfg);

const sources = (over: Partial<B.GateSources> = {}): B.GateSources => ({
  shopSaid: "", customerSaid: "", policy: "", hoSo: null, found: [], stockFacts: null,
  lookups: { orderLooked: false }, links: {}, pronoun: "bác", uncertainProduct: false,
  site: "shop.example", tenShop: "Shop Giày", ...over
});

const profile = (over: Partial<ShopProfile["banHang"]> = {}, extra: Partial<ShopProfile> = {}): ShopProfile => {
  const p = emptyShopProfile();
  return { ...p, ...extra, banHang: { ...p.banHang, ...over } };
};

const has = (trace: string[], name: string): boolean => trace.some((t) => t === name || t.startsWith(`${name}:`));

test("false_human_identity: 'em là người thật' becomes the AI sentence with the shop's name", () => {
  const r = gate.run("Dạ em là người thật ạ, bác cứ hỏi em nhé.", sources());
  assert.ok(has(r.trace, "false_human_identity"));
  assert.match(r.reply, /trợ lý AI của Shop Giày/);
  assert.match(r.reply, /người phụ trách/);
});

test("payment_received_claim: 'Dạ nhận rồi ạ' after 'nhận được tiền chưa' is a claim → neutral sentence, human, reason", () => {
  const r = gate.run("Dạ nhận rồi ạ. Em lên đơn cho bác ngay nhé.", sources({ customerMessage: "shop nhận được tiền chưa?" }));
  assert.ok(has(r.trace, "payment_received_claim"));
  assert.equal(r.reply, "Dạ em đã nhận thông tin, em báo người phụ trách đối chiếu và báo lại bác ngay ạ.");
  assert.equal(r.needsHuman, true);
  assert.equal(r.handoffReason, "bot_khong_duoc_xac_nhan_da_nhan_tien");
  // Without the question, the same short sentence is not a claim; an explicit claim always is.
  assert.equal(gate.run("Dạ nhận rồi ạ.", sources({ customerMessage: "còn size 42 không" })).trace.length, 0);
  assert.ok(has(gate.run("Dạ em đã nhận được 690k của bác rồi ạ.", sources()).trace, "payment_received_claim"));
});

test("closing_contact_request: at closing the form note replaces the request for phone / address", () => {
  const r = gate.run("Dạ bác cho em xin số điện thoại và địa chỉ để em lên đơn ạ.", sources({ closing: true }));
  assert.ok(has(r.trace, "closing_contact_request"));
  assert.match(r.reply, /phiếu đặt hàng/);
  assert.equal(gate.run("Dạ bác cho em xin số điện thoại ạ.", sources({ closing: false })).trace.length, 0);
  // A shop that closes through a person gets the person note instead.
  const p = gate.run("Dạ bác cho em xin số điện thoại ạ.", sources({ closing: true, hoSo: profile({ khiChot: "goi-nguoi" }) }));
  assert.match(p.reply, /người phụ trách chốt đơn/);
});

test("warranty_claim: 'bảo hành trọn đời' without a source is cut, a person's word keeps it", () => {
  const r = gate.run("Dạ hàng chính hãng, bảo hành trọn đời ạ.", sources());
  assert.ok(has(r.trace, "warranty_claim"));
  assert.doesNotMatch(r.reply, /trọn đời/);
  assert.match(r.reply, /chính hãng/);
  assert.equal(gate.run("Dạ hàng chính hãng, bảo hành trọn đời ạ.", sources({ shopSaid: "bên em bảo hành trọn đời nhé" })).trace.length, 0);
});

test("percent_authenticity: '100% chính hãng' loses the percentage unless the profile's commitment says it", () => {
  const r = gate.run("Dạ hàng bên em 100% chính hãng ạ.", sources());
  assert.ok(has(r.trace, "percent_authenticity"));
  assert.doesNotMatch(r.reply, /100/);
  const ok = gate.run("Dạ hàng bên em 100% chính hãng ạ.", sources({ hoSo: profile({}, { camKetHang: "Hàng chính hãng 100%, có hoá đơn" }) }));
  assert.equal(ok.trace.length, 0);
});

test("deposit_amount_no_source: a deposit rate nobody stated is cut and handed over; the profile's rate is a source", () => {
  const r = gate.run("Dạ hàng order bác cọc trước 50% giúp em ạ.", sources());
  assert.ok(has(r.trace, "deposit_amount_no_source"));
  assert.match(r.reply, /mức cọc cụ thể/);
  assert.equal(r.needsHuman, true);
  const ok = gate.run("Dạ hàng order bác cọc trước 50% giúp em ạ.", sources({ hoSo: profile({ tiLeCoc: 50 }) }));
  assert.equal(ok.trace.length, 0);
  // The deposit the pipeline computed for the order form (300k) is a source too.
  const dep = gate.run("Dạ bác cọc 300k giúp em nhé.", sources({ moneyContext: { deposit: 300000 } }));
  assert.ok(!has(dep.trace, "deposit_amount_no_source"));
});

test("money_no_source: an amount above 100k that appears nowhere in the data is cut", () => {
  const r = gate.run("Dạ phí đổi hàng là 1.850.000đ ạ.", sources());
  assert.ok(has(r.trace, "money_no_source"));
  assert.match(r.reply, /kiểm tra lại số chính xác/);
  const ok = gate.run("Dạ phí là 1.850.000đ ạ.", sources({ shopSaid: "phí là 1.850.000đ nhé" }));
  assert.equal(ok.trace.length, 0);
});

const ORDER_ITEM = item("JR1234", "ADIZERO EVO SL M", [size("42", { loai: "HANG ORDER" })], { loai: "HANG ORDER" });

test("exchange_promise_order_item: an exchange promised on an ORDER item is cut and the order note appended", () => {
  const facts = B.buildStockFacts([ORDER_ITEM], { code: "JR1234", requestedSize: "42" }, matching);
  assert.equal(facts?.stockType, "order");
  const r = gate.run("Dạ bên em có hỗ trợ đổi size nếu không vừa ạ.", sources({ found: [ORDER_ITEM], stockFacts: facts }));
  assert.ok(has(r.trace, "exchange_promise_order_item"));
  assert.match(r.reply, /hàng order/);
  assert.equal(r.needsHuman, false);
  // The order's exchange window from the lookup is a source (Desk v92).
  const open = gate.run("Dạ bên em có hỗ trợ đổi size nếu không vừa ạ.", sources({ found: [ORDER_ITEM], stockFacts: facts, lookups: { orderLooked: true, exchange: { allowed: true } } }));
  assert.equal(open.trace.length, 0);
});

test("exchange_promise_no_policy: an exchange promised with no policy is cut and handed over; a policy that mentions it passes", () => {
  const r = gate.run("Dạ bên em có hỗ trợ đổi size nếu không vừa ạ.", sources());
  assert.ok(has(r.trace, "exchange_promise_no_policy"));
  assert.match(r.reply, /kiểm tra chính sách/);
  assert.equal(r.needsHuman, true);
  assert.equal(gate.run("Dạ bên em có hỗ trợ đổi size nếu không vừa ạ.", sources({ policy: "Đổi size trong vòng 7 ngày, giày chưa qua sử dụng." })).trace.length, 0);
});

test("price_range_collapsed: 'từ 2.890.000đ đến 2.890.000đ' is one price; a real range stays", () => {
  const r = gate.run("Dạ mẫu này giá từ 2.890.000đ đến 2.890.000đ ạ.", sources({ found: [item("X1", "MAU X", [size("42", { gia: 2890000 })])] }));
  assert.ok(has(r.trace, "price_range_collapsed"));
  assert.equal(r.reply, "Dạ mẫu này giá 2.890.000đ ạ.");
  assert.equal(gate.run("Price from 3.090.000đ to 3.090.000đ.", sources({ found: [item("X1", "MAU X", [size("42", { gia: 3090000 })])] })).reply, "Price 3.090.000đ.");
  // Two products at two prices: a real range, left alone by this rule.
  const real = gate.run("Dạ giá từ 2.890.000đ đến 3.190.000đ ạ.", sources({ found: [item("X1", "MAU X", [size("42", { gia: 2890000 })]), item("X2", "MAU Y", [size("42", { gia: 3190000 })])] }));
  assert.ok(!has(real.trace, "price_range_collapsed"), real.trace.join(","));
});

test("exchange_claimed_done: 'em đã đổi sang size 42 cho bác rồi' → the person is asked to do it", () => {
  const r = gate.run("Dạ em đã đổi sang size 42 cho bác rồi ạ.", sources());
  assert.ok(has(r.trace, "exchange_claimed_done"));
  assert.match(r.reply, /báo người phụ trách đổi size trên đơn/);
  assert.doesNotMatch(r.reply, /đã đổi sang/);
});

test("photo_request_send_link: 'để em chụp thêm ảnh' becomes the product links", () => {
  const r = gate.run("Dạ để em chụp thêm ảnh chi tiết gửi bác xem ngay ạ.", sources({ found: [BOSTON13], customerMessage: "cho em xin thêm ảnh chi tiết mẫu này" }));
  assert.ok(has(r.trace, "photo_request_send_link"));
  assert.doesNotMatch(r.reply, /chụp thêm/);
  assert.match(r.reply, /https:\/\/shop\.example\/product\/JS4955/);
  assert.match(r.reply, /^Bác bấm vào đây/);
});

test("external_link_removed: a foreign link with a product code is rebuilt on the shop's site", () => {
  const r = gate.run("Bác xem ở đây: https://www.adidas.com.vn/giay-boston-13-JS4955.html nhé.", sources({ found: [BOSTON13] }));
  assert.ok(has(r.trace, "external_link_removed"));
  assert.doesNotMatch(r.reply, /adidas\.com/);
  assert.match(r.reply, /https:\/\/shop\.example\/product\/js4955/);
  // A carrier tracking page is not a foreign link, nor is the shop's own.
  assert.ok(!has(gate.run("Xem tại https://shop.example/product/js4955 nhé.", sources({ found: [BOSTON13] })).trace, "external_link_removed"));
});

test("eta_no_source: '3-5 ngày' is cut unless the profile's lead time says so", () => {
  const r = gate.run("Dạ hàng order khoảng 3-5 ngày về ạ.", sources());
  assert.ok(has(r.trace, "eta_no_source"));
  assert.match(r.reply, /kiểm tra thời gian hàng về/);
  const ok = gate.run("Dạ hàng order khoảng 3-5 ngày về ạ.", sources({ hoSo: profile({ thoiGianOrder: "3-5 ngày hàng về kho" }) }));
  assert.equal(ok.trace.length, 0);
});

const TRACK = { url: "https://spx.vn/track?SPXVN063632957159", code: "SPXVN063632957159", statusLabel: "đang giao" };

test("tracking_link_added: the customer asks where the parcel is and the reply forgot the real link", () => {
  const r = gate.run("Dạ đơn của bác đang được giao ạ.", sources({ customerMessage: "hàng đi đến đâu rồi shop", lookups: { orderLooked: true, tracking: TRACK } }));
  assert.ok(has(r.trace, "tracking_link_added"));
  assert.match(r.reply, /Bác bấm link này để xem hành trình đơn: https:\/\/spx\.vn\/track\?SPXVN063632957159/);
  // In a group chat the order may be someone else's: nothing is added.
  assert.equal(gate.run("Dạ đơn của bác đang được giao ạ.", sources({ customerMessage: "hàng đi đến đâu rồi shop", inGroup: true, lookups: { orderLooked: true, tracking: TRACK } })).trace.length, 0);
});

test("tracking_link_fixed: a product link where the tracking link belongs is swapped", () => {
  const r = gate.run("Dạ bác tra cứu vận đơn tại đây ạ: https://shop.example/product/js4955", sources({ found: [BOSTON13], customerMessage: "cho em xin lại tracking", lookups: { orderLooked: true, tracking: TRACK } }));
  assert.ok(has(r.trace, "tracking_link_fixed"));
  assert.doesNotMatch(r.reply, /product\/js4955/);
  assert.match(r.reply, /spx\.vn\/track/);
  assert.ok(!has(r.trace, "tracking_link_added"));
});

test("outside_advice_candidates: a code outside the filtered candidates is replaced by the top two", () => {
  const DURAMO = item("IE7965", "DURAMO SL M", [size("42")]);
  const r = gate.run("Bác thử Duramo SL (IE7965) nhé, êm lắm.", sources({ found: [DURAMO, ADIOS9], adviceCandidates: [{ code: "JQ0764", name: "ADIZERO ADIOS 9 M", price: 3190000 }] }));
  assert.ok(has(r.trace, "outside_advice_candidates"));
  assert.match(r.reply, /ADIZERO ADIOS 9 M \(JQ0764\) giá 3\.190\.000đ/);
  // The customer named it themselves: allowed.
  assert.ok(!has(gate.run("Bác thử Duramo SL (IE7965) nhé.", sources({ found: [DURAMO], customerSaid: "IE7965 còn không", adviceCandidates: [{ code: "JQ0764", name: "Adios 9" }] })).trace, "outside_advice_candidates"));
});

test("stock_unknown_assert: 'còn hàng' while the item is unknown becomes the ask-for-name sentence, by topic", () => {
  const r = gate.run("Dạ mẫu này bên em còn hàng ạ.", sources({ uncertainProduct: true }));
  assert.ok(has(r.trace, "stock_unknown_assert"));
  assert.match(r.reply, /tên mẫu hoặc mã sản phẩm/);
  const colors = gate.run("Dạ mẫu này còn nhiều màu ạ.", sources({ uncertainProduct: true, customerMessage: "còn màu nào khác không" }));
  assert.match(colors.reply, /các màu còn hàng/);
  const discovery = gate.run("Dạ bên em có sẵn nhiều mẫu ạ.", sources({ uncertainProduct: true, customerMessage: "gợi ý em vài đôi chạy bộ", links: { filterLink: "https://shop.example/?q=daily" } }));
  assert.match(discovery.reply, /https:\/\/shop\.example\/\?q=daily/);
  // A person already said it: kept.
  assert.equal(gate.run("Dạ mẫu này bên em còn hàng ạ.", sources({ uncertainProduct: true, shopSaid: "mẫu này còn hàng nhé" })).trace.length, 0);
});

test("contradicts_stock_in: 'hết rồi' when the warehouse has the size → the stock sentence with count and price", () => {
  const facts = B.buildStockFacts([BOSTON13], { code: "JS4955", requestedSize: "42" }, matching);
  const r = gate.run("Dạ size 42 mẫu này hết rồi ạ.", sources({ found: [BOSTON13], stockFacts: facts }));
  assert.ok(has(r.trace, "contradicts_stock_in"));
  assert.equal(r.reply, "Dạ mẫu ADIZERO BOSTON 13 M (JS4955) size 42 bên em còn 2 đôi, giá 3.190.000đ ạ. Bác lấy đôi này em lên đơn nhé?");
});

test("contradicts_stock_out: 'còn hàng' when the warehouse has no such size → the out-of-stock sentence", () => {
  const facts = B.buildStockFacts([BOSTON13], { code: "JS4955", requestedSize: "44" }, matching);
  assert.equal(facts?.stock, null);
  const r = gate.run("Dạ size 44 bên em còn hàng ạ.", sources({ found: [BOSTON13], stockFacts: facts }));
  assert.ok(has(r.trace, "contradicts_stock_out"));
  assert.match(r.reply, /size 44 bên em hết rồi/);
});

test("approx_size_named_exact: the warehouse has 42 2/3, the reply must not say 'size 42.5'", () => {
  const facts = B.buildStockFacts([BOSTON13], { code: "JS4955", requestedSize: "42.5" }, matching);
  assert.equal(facts?.stock?.approximate, true);
  const r = gate.run("Dạ size 42.5 bên em còn ạ.", sources({ found: [BOSTON13], stockFacts: facts }));
  assert.ok(has(r.trace, "approx_size_named_exact"));
  assert.match(r.reply, /size 42 2\/3/);
});

test("order_claim_no_lookup: an order status nobody looked up → check or ask the phone; a person's word is a source, the bot's old line is not", () => {
  const r = gate.run("Dạ đơn của bác đang được giao ạ.", sources());
  assert.ok(has(r.trace, "order_claim_no_lookup"));
  assert.match(r.reply, /xin số điện thoại/);
  const withPhone = gate.run("Dạ đơn của bác đang được giao ạ.", sources({ customerSaid: "sđt 0912345678\nđơn em sao rồi" }));
  assert.match(withPhone.reply, /kiểm tra đơn/);
  // `shopSaid` carries a PERSON's lines only; the caller never puts the bot's own earlier sentence there.
  assert.equal(gate.run("Dạ đơn của bác đang được giao ạ.", sources({ shopSaid: "đơn của bác shipper đang giao rồi nhé" })).trace.length, 0);
  assert.equal(gate.run("Dạ đơn của bác đang được giao ạ.", sources({ lookups: { orderLooked: true } })).trace.length, 0);
});

test("alien_code: a code nobody returned or mentioned → check sentence, or the stock sentence when facts exist", () => {
  const r = gate.run("Dạ mẫu IH0796 giá 1.390.000đ còn size 42 ạ.", sources({ found: [BOSTON13] }));
  assert.ok(has(r.trace, "alien_code:IH0796"));
  assert.match(r.reply, /kiểm tra lại mẫu chính xác/);
  const facts = B.buildStockFacts([BOSTON13], { code: "JS4955", requestedSize: "42" }, matching);
  const withFacts = gate.run("Dạ mẫu IH0796 giá 1.390.000đ còn size 42 ạ.", sources({ found: [BOSTON13], stockFacts: facts }));
  assert.match(withFacts.reply, /JS4955\) size 42 bên em còn 2 đôi/);
});

test("cascade_price_fix: a wrong price next to a code is replaced by that code's real price", () => {
  const r = gate.run("Dạ Boston 13 (JS4955) giá 2.790.000đ và Adios 9 (JQ0764) giá 3.190.000đ ạ.", sources({ found: [BOSTON13, ADIOS9] }));
  assert.ok(has(r.trace, "cascade_price_fix:JS4955:2790000->2990000"));
  assert.match(r.reply, /JS4955\) giá 2\.990\.000đ/);
  assert.match(r.reply, /JQ0764\) giá 3\.190\.000đ/);
});

test("kho_price_fix: the size sits in another warehouse at another price → that price", () => {
  const TWO_KHO = item("JS4955", "ADIZERO BOSTON 13 M", [size("41", { kho: "K1", gia: 2990000 }), size("42", { kho: "K2", gia: 3290000 })]);
  const facts = B.buildStockFacts([TWO_KHO], { code: "JS4955", requestedSize: "42" }, matching);
  assert.equal(facts?.price, 3290000);
  const r = gate.run("Dạ JS4955 size 42 giá 2.990.000đ ạ.", sources({ found: [TWO_KHO], stockFacts: facts }));
  assert.ok(has(r.trace, "kho_price_fix:2990000->3290000"));
  assert.match(r.reply, /giá 3\.290\.000đ/);
  assert.ok(!has(r.trace, "money_no_source"));
});

test("price_mismatch: a price that is not the anchored item's is swapped for the real one", () => {
  const r = gate.run("Dạ mẫu Boston 13 giá 3.590.000đ ạ.", sources({ found: [BOSTON13] }));
  assert.ok(has(r.trace, "price_mismatch:3590000->2990000"));
  assert.equal(r.reply, "Dạ mẫu Boston 13 giá 2.990.000đ ạ.");
  assert.ok(!has(r.trace, "money_no_source"), "the corrected price is sourced, the money rule must not cut it");
});

test("price_skip_money_context: 'cọc 300k' is a deposit, not a price — left alone (Desk v7)", () => {
  const r = gate.run("Dạ bác cọc 300k, còn lại thanh toán khi nhận hàng ạ.", sources({ found: [BOSTON13], moneyContext: { deposit: 300000 } }));
  assert.ok(has(r.trace, "price_skip_money_context:300000"));
  assert.equal(r.reply, "Dạ bác cọc 300k, còn lại thanh toán khi nhận hàng ạ.");
  assert.equal(r.needsHuman, false);
});

test("payment_defer_agree: the bot agrees to be paid on delivery → the person decides", () => {
  const r = gate.run("Dạ bác nhận hàng rồi thanh toán cũng được ạ.", sources());
  assert.ok(has(r.trace, "payment_defer_agree"));
  assert.match(r.reply, /phần thanh toán để em nhờ người phụ trách/);
  assert.equal(r.needsHuman, true);
  assert.equal(gate.run("Dạ bác nhận hàng rồi thanh toán cũng được ạ.", sources({ shopSaid: "bác nhận hàng rồi thanh toán cũng được" })).trace.length, 0);
});

test("recommends_current_shoe: the customer wants something else, the bot recommends the shoe they wear", () => {
  const r = gate.run("Dạ Pegasus 41 rất hợp với bác ạ, bên em có sẵn.", sources({ currentShoe: "Pegasus 41", customerSaid: "đang đi Pegasus 41, muốn tìm thêm 1 đôi khác để thay đổi" }));
  assert.ok(has(r.trace, "recommends_current_shoe"));
  assert.match(r.reply, /ngoài đôi Pegasus 41 mình đang đi/);
});

test("size_chart_fix: a size converted from the foot length must follow the industry's chart", () => {
  const chart = B.loadEntityConfig("giay-chay").sizeChart;
  const row = chart.find((x) => x.daiChanCm === 26.5);
  assert.ok(row !== undefined, "the shoe chart has a 26.5cm row");
  const r = gate.run("Dạ chân 26.5cm thì bác đi size 40 ạ.", sources({ customerSaid: "chân em dài 26.5cm", sizeChart: chart }));
  assert.ok(has(r.trace, "size_chart_fix"));
  assert.match(r.reply, new RegExp(`size ${row!.size.replace("/", "\\/")}`));
  // The chart's size (or its neighbour) passes; no chart → ask the brand instead.
  assert.equal(gate.run(`Dạ chân 26.5cm thì bác đi size ${row!.size} ạ.`, sources({ customerSaid: "chân em dài 26.5cm", sizeChart: chart })).trace.length, 0);
  const none = gate.run("Dạ chân 26.5cm thì bác đi size 40 ạ.", sources({ customerSaid: "chân em dài 26.5cm" }));
  assert.ok(has(none.trace, "foot_cm_size_no_source"));
  assert.match(none.reply, /hãng nào/);
});

test("append_missing_links: the line links the pipeline prepared are appended when the model forgot them", () => {
  const r = gate.run("Dạ bác chạy hằng ngày thì dòng daily hợp ạ.", sources({ links: { lineLinks: [{ name: "Daily", url: "https://shop.example/?line=daily", count: 5 }] } }));
  assert.ok(has(r.trace, "append_missing_links:line"));
  assert.match(r.reply, /• Daily \(5 mẫu đúng size\): https:\/\/shop\.example\/\?line=daily/);
  const group = gate.run("Dạ bên em có nhiều mẫu dép ạ.", sources({ links: { groupLink: "https://shop.example/?type=dep" } }));
  assert.match(group.reply, /Bác xem các mẫu và chọn giúp em tại: https:\/\/shop\.example\/\?type=dep/);
  assert.equal(gate.run("Xem tại https://shop.example/?type=dep nhé.", sources({ links: { groupLink: "https://shop.example/?type=dep" } })).trace.length, 0);
});

test("the gate keeps a clean reply, never flips needsHuman back, and the config validates", () => {
  const r = gate.run("Dạ em nghe ạ, bác đang tìm mẫu nào để em hỗ trợ ạ?", sources(), { needsHuman: true });
  assert.deepEqual(r.trace, []);
  assert.equal(r.needsHuman, true);
  assert.deepEqual(B.checkReplyGateConfig(cfg, "test"), []);
  const broken = B.mergeReplyGateConfig(cfg, { ...B.emptyReplyGateConfig(), eta: { pattern: "(", fallback: "Ship 3-5 ngày, cọc 50% ạ." } });
  const problems = B.checkReplyGateConfig(broken, "test");
  assert.ok(problems.some((p) => /eta\.pattern/.test(p)), "a broken regex is named");
  assert.ok(problems.some((p) => /eta\.fallback/.test(p) && /rieng mot shop/.test(p)), "a shop's number in a sentence is refused");
});
