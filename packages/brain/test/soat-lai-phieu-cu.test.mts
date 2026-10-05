/**
 * SOÁT LẠI 05/10/2026 — bảng "Ca kiểm" của các phiếu Desk đã đánh `da-xu-ly` từ 30/09 chỉ bằng soát nhanh.
 *
 * Đêm 04→05/10 có nhiều lượt sửa lớn (cổng soát, định tuyến, ảnh, size, tra kho theo nhóm, đơn đang chạy…),
 * nên từng hàng Ca kiểm của các phiếu cũ được chạy lại ở đây khi chưa có test nào giữ đúng hàng đó.
 * Mỗi khối ghi tên phiếu. Tầng 1 chạy cả gói ngành GIẢ (nhà thuốc); tầng 2 nạp gói giày thật.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { emptyShopProfile, type ShopProfile } from "@sp/contract";
import { runningShoesPack } from "./fixtures.mts";
import { BOSTON13, BOSTON13_DEN, cfg as matching, hoiLaiFiller, item, lines, pack, scorer, size } from "./stage3-fixtures.mts";

const AT = "2026-09-24T09:00:00.000Z";
const has = (trace: string[], name: string): boolean => trace.some((t) => t === name || t.startsWith(`${name}:`));
const sources = (over: Partial<B.GateSources> = {}): B.GateSources => ({
  shopSaid: "", customerSaid: "", policy: "", hoSo: null, found: [], stockFacts: null,
  lookups: { orderLooked: false }, links: {}, pronoun: "bác", uncertainProduct: false,
  site: "shop.example", tenShop: "Shop Mẫu", ...over
});

// =====================================================================================================
// Phiếu 2026-08-31-cau-chinh-sach-doi-size-khong-xin-size
// =====================================================================================================

for (const id of ["giay-chay", "nha-thuoc"]) {
  const router = B.ruleRouterFor(id);
  const p = emptyShopProfile();
  p.xungHo = { khach: "bác", shop: "em" };
  const shop = { profile: p, site: "shop.example", tenShop: "Shop Mẫu" };

  // "đổi size" is the shoe pack's word (tier 2); every industry has "đổi trả" / "hoàn tiền" (tier 1).
  const said = id === "giay-chay" ? ["neu lech thi cho doi size k", "shop cho doi size khong a", "shop cho đổi trả không ạ"] : ["shop cho đổi trả không ạ", "mua rồi có được hoàn tiền không shop"];
  test(`${id}: câu hỏi CHÍNH SÁCH đổi size/đổi trả → agent (công cụ chính sách), không kịch bản xin mã/size`, () => {
    for (const s of said) {
      const out = router.route({ message: s, ...shop });
      assert.equal(out.decision.kind, "agent_draft", `${s} → ${out.decision.kind}/${out.decision.reason}`);
      // The router may keep LLM#1's "ask_size" but the DECISION is the policy one (Desk `policy_question_over_script`).
      assert.match(out.decision.reason, /^policy_question/, `${s} → ${out.intent.intent}/${out.decision.reason}`);
    }
  });
}

test("giay-chay: 'mình đi size 42 còn không' vẫn là hỏi tồn, không bị nuốt vào chính sách", () => {
  const router = B.ruleRouterFor("giay-chay");
  const p = emptyShopProfile();
  p.xungHo = { khach: "bác", shop: "em" };
  const out = router.route({ message: "mình đi size 42 còn không", profile: p, site: "shop.example", tenShop: "Shop Mẫu" });
  assert.notEqual(out.intent.intent, "policy_question");
  assert.notEqual(out.intent.intent, "return_exchange");
  assert.notEqual(out.decision.reason, "policy_question");
});

// =====================================================================================================
// Phiếu 2026-08-31-hua-doi-size-khi-chua-co-chinh-sach (lượt 10 đêm 05/10: hàng SẴN cũng cần chính sách)
// =====================================================================================================

const facts = (stockType: "san" | "order"): B.StockFacts => ({ stockType, requestedSize: "42", stock: { size: "42", qty: 1, approximate: false }, price: 0, productCode: "X1", productName: "X", otherKho: [], variantsAvailable: [] } as unknown as B.StockFacts);

for (const id of ["giay-chay", "nha-thuoc"]) {
  const gate = new B.ReplyGate(B.loadReplyGateConfig(id));
  const PROMISE = "Dạ bên em có hỗ trợ đổi size nếu không vừa ạ.";

  test(`${id}: hứa đổi size — hàng order → cắt + câu hàng order, không chuyển người`, () => {
    const r = gate.run(PROMISE, sources({ stockFacts: facts("order") }));
    assert.ok(has(r.trace, "exchange_promise_order_item"), r.trace.join(","));
    assert.match(r.reply, /hàng order/);
    assert.equal(r.needsHuman, false);
  });

  test(`${id}: hứa đổi size — chính sách rỗng, không rõ loại hàng → cắt, "kiểm tra chính sách", gọi người`, () => {
    const r = gate.run(PROMISE, sources());
    assert.ok(has(r.trace, "exchange_promise_no_policy"), r.trace.join(","));
    assert.match(r.reply, /kiểm tra chính sách/);
    assert.equal(r.needsHuman, true);
  });

  test(`${id}: hứa đổi size — hàng SẴN + chính sách có mục đổi size → giữ nguyên; hàng sẵn mà chính sách trống → cắt (lượt 10)`, () => {
    assert.equal(gate.run(PROMISE, sources({ stockFacts: facts("san"), policy: "Đổi size trong vòng 7 ngày nếu còn nguyên tem." })).reply, PROMISE);
    // The shop profile is a source too (tier 3): its own exchange line keeps the promise.
    const hoSo: ShopProfile = { ...emptyShopProfile() };
    assert.ok(has(gate.run(PROMISE, sources({ stockFacts: facts("san"), hoSo })).trace, "exchange_promise_no_policy"), "empty profile + empty policy = cut");
  });

  test(`${id}: "vẫn đổi size được" khi tra đơn trả exchange.allowed = true → giữ nguyên`, () => {
    const said = "Dạ mình vẫn đổi size được ạ.";
    assert.equal(gate.run(said, sources({ lookups: { orderLooked: true, exchange: { allowed: true } } })).reply, said);
    const promise = "Dạ bên em có hỗ trợ đổi size cho đơn này ạ.";
    assert.equal(gate.run(promise, sources({ lookups: { orderLooked: true, exchange: { allowed: true } } })).reply, promise, "the open window is the source of a promise");
    assert.ok(gate.run(promise, sources({ lookups: { orderLooked: true, exchange: { allowed: false } } })).trace.some((t) => t.startsWith("exchange_promise")), "a closed window is no source");
  });

  test(`${id}: "em đã đổi sang size 40 2/3 cho bác rồi" → cắt, báo người phụ trách đổi`, () => {
    const r = gate.run("Dạ em đã đổi sang size 40 2/3 cho bác rồi ạ.", sources());
    assert.ok(has(r.trace, "exchange_claimed_done"), r.trace.join(","));
    assert.match(r.reply, /báo người phụ trách đổi/);
    assert.doesNotMatch(r.reply, /đã đổi sang/);
  });

  test(`${id}: "Dạ đúng rồi ạ" khi lời hứa chỉ nằm trong tin cũ của PAGE (bot) → vẫn cắt, tin page không là nguồn`, () => {
    const r = gate.run("Dạ đúng rồi ạ.", sources({
      customerSaid: "vậy là shop cho đổi size đúng không", customerMessage: "vậy là shop cho đổi size đúng không",
      pageSaid: "Dạ bên em có hỗ trợ đổi size nếu không vừa ạ."
    }));
    assert.ok(has(r.trace, "exchange_promise_no_policy"), r.trace.join(","));
    assert.doesNotMatch(r.reply, /đúng rồi/i);
  });

  // Bổ sung 05/10/2026: cách nói KHẲNG ĐỊNH "đổi <cái gì> được" (cơ chế tầng 1, `exchange.affirmed`); thứ đổi được
  // chung mọi ngành ở tầng 1 ("trả", "hàng", "loại khác"…), "size" là từ ngành ở tầng 2 (`affirmedObjects`).
  test(`${id}: "Dạ đổi loại khác được ạ" khi chưa có chính sách → cắt + gọi người; hỏi lại / phủ định thì không`, () => {
    const r = gate.run("Dạ đổi loại khác được ạ. Bác cần thêm gì cứ nhắn em nhé.", sources());
    assert.ok(has(r.trace, "exchange_promise_no_policy"), r.trace.join(","));
    assert.doesNotMatch(r.reply, /đổi loại khác được/);
    assert.equal(r.needsHuman, true);
    for (const said of ["Dạ bác hỏi đổi trả được không thì em kiểm tra rồi báo bác ngay ạ.", "Dạ hàng này không đổi trả được ạ."]) {
      assert.ok(!gate.run(said, sources()).trace.some((t) => t.startsWith("exchange_promise")), said);
    }
  });
}

test(`giay-chay: "Dạ đổi size được ạ" / "đổi sang size 43 được nhé" → cắt khi chưa có chính sách, giữ khi chính sách có mục đổi size`, () => {
  const gate = new B.ReplyGate(B.loadReplyGateConfig("giay-chay"));
  for (const said of ["Dạ đổi size được ạ.", "Dạ bên em đổi sang size 43 được nhé bác."]) {
    const r = gate.run(said, sources());
    assert.ok(has(r.trace, "exchange_promise_no_policy"), `${said} → ${r.trace.join(",")}`);
    assert.equal(r.needsHuman, true);
    assert.equal(gate.run(said, sources({ stockFacts: facts("san"), policy: "Đổi size trong vòng 7 ngày nếu còn nguyên tem." })).reply, said);
  }
  assert.ok(!gate.run("Dạ bác muốn đổi size được không ạ, để em xem đơn.", sources()).trace.some((t) => t.startsWith("exchange_promise")));
  // The tier split: "size" is the shoe industry's word, not tier 1's.
  assert.ok(B.loadReplyGateConfig("giay-chay").exchange.affirmedObjects.includes("size"));
  assert.ok(!B.loadReplyGateConfig("nha-thuoc").exchange.affirmedObjects.includes("size"));
});

// =====================================================================================================
// Phiếu 2026-09-01-agent-va-cong-soat-thieu-nguon-that (phần cổng soát: số ngày phải có nguồn)
// =====================================================================================================

for (const id of ["giay-chay", "nha-thuoc"]) {
  test(`${id}: khách gửi ảnh BIÊN LAI → câu trung tính + báo người, agent không được phán "không phải tài khoản của shop"`, () => {
    const p = emptyShopProfile();
    p.xungHo = { khach: "bác", shop: "em" };
    const turns: B.RouterTurn[] = [{ role: "shop", text: "Bác chuyển vào STK 19036789012 giúp em nhé", at: AT }];
    const out = B.ruleRouterFor(id).route({ message: "", attachments: 1, attachmentKinds: ["bien_lai"], turns, profile: p, site: "shop.example", tenShop: "Shop Mẫu" });
    assert.equal(out.decision.kind, "human_handoff", JSON.stringify(out.decision));
    const reply = out.decision.kind === "human_handoff" ? out.decision.reply : "";
    assert.match(reply, /nhận được ảnh|đã nhận/);
    assert.match(reply, /người phụ trách đối chiếu/);
    assert.doesNotMatch(reply, /không phải|sai tài khoản|nhầm tài khoản/);
  });
}

// =====================================================================================================
// =====================================================================================================

for (const id of ["giay-chay", "nha-thuoc"]) {
  const gate = new B.ReplyGate(B.loadReplyGateConfig(id));
  const POLICY = "Hàng order về sau 3-7 ngày kể từ khi cọc.";

  test(`${id}: hàng order, agent nói "3-7 ngày" đúng chính sách → cổng không cắt; "5-9 ngày" không có nguồn → cắt`, () => {
    const ok = gate.run("Dạ mẫu này hàng order, về sau 3-7 ngày ạ.", sources({ policy: POLICY, stockFacts: facts("order") }));
    assert.ok(!has(ok.trace, "eta_no_source"), ok.trace.join(","));
    assert.match(ok.reply, /3-7 ngày/);
    const bad = gate.run("Dạ mẫu này hàng order, về sau 5-9 ngày ạ.", sources({ policy: POLICY, stockFacts: facts("order") }));
    assert.ok(has(bad.trace, "eta_no_source"), bad.trace.join(","));
    assert.doesNotMatch(bad.reply, /5-9 ngày/);
  });
}

// =====================================================================================================
// Phiếu 2026-09-01-bot-xin-anh-khi-khach-vua-gui-anh (cổng sản phẩm chưa rõ + máy luật)
// =====================================================================================================

{
  const gate = new B.UncertainProductGate(scorer, lines);
  const NOW = "2026-09-25T09:00:00.000Z";
  const at = (minutesAgo: number): string => new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString();
  const state = (minutesAgo: number | null): B.ConversationState => ({
    tenant: "t", conversationId: "c", turns: minutesAgo === null ? [] : [{ role: "customer", text: "", at: at(minutesAgo), imageCount: 1 }]
  } as unknown as B.ConversationState);
  const input = (evidence: boolean, over: Partial<B.UncertainInput> = {}): B.UncertainInput => ({
    message: "Shop có hoka slide 3 nữ size 36 hoặc 36,5 ko shop", intent: "ask_size",
    entities: { productCode: "", productName: "", brand: "" }, resolution: null, hasImage: false, hasFocus: false,
    state: { hasRecentImageEvidence: evidence }, now: NOW, lexicon: pack.lexicon, hoiLai: hoiLaiFiller({}), ...over
  });

  test("ảnh ở tin trước 5 phút → bằng chứng ảnh còn; 20 phút → hết cửa sổ (15 phút)", () => {
    assert.equal(B.hasRecentImageEvidence(state(5), new Date(NOW)), true);
    assert.equal(B.hasRecentImageEvidence(state(20), new Date(NOW)), false);
    assert.equal(B.hasRecentImageEvidence(state(null), new Date(NOW)), false);
  });

  test("ảnh 5 phút trước + câu hỏi mẫu không rõ → câu nói ĐÃ nhận ảnh, xin tên/tem, không xin ảnh chung chung", () => {
    // The exact sentence names a line the catalogue does not know: the gate stays quiet and the agent answers
    // (its photo net: xeon soat-lai-phieu-cu + anh-phien). A sentence that only points ("mẫu này") is the gate's.
    const named = gate.apply(input(true));
    assert.ok(named === null || (named.action === "ask_clarification" && !/xin ảnh hoặc tên/.test(named.reply)), JSON.stringify(named));
    const out = gate.apply(input(true, { message: "Shop có mẫu này nữ size 36 hoặc 36,5 ko shop" }));
    assert.ok(out !== null && out.action === "ask_clarification", JSON.stringify(out));
    assert.match(out.reply, /nhận được ảnh rồi/);
    assert.match(out.reply, /tên mẫu|tem/);
    assert.doesNotMatch(out.reply, /xin ảnh hoặc tên/);
  });

  test("ảnh 20 phút trước (ngoài cửa sổ) / chưa từng gửi ảnh + 'có mẫu đó không' → được xin ảnh hoặc tên", () => {
    const out = gate.apply(input(false, { message: "có mẫu đó không shop" }));
    assert.ok(out !== null && out.action === "ask_clarification", JSON.stringify(out));
    assert.match(out.reply, /ảnh hoặc tên/);
  });

  test("máy luật: thiếu SỐ ĐIỆN THOẠI ngay sau khi khách gửi ảnh → xin số điện thoại, không đổi sang câu ảnh", async () => {
    const { fakePorts, ask } = await import("./fixtures.mts");
    const f = fakePorts({ orders: [{ orderId: "MAN-1", status: "đang giao", createdAt: new Date().toISOString(), money: { total: 1, paid: 1, remaining: 0, cod: 0 }, lines: [] }] } as never);
    await ask(f.ports, "", { imageCount: 1 });
    const r = await ask(f.ports, "don hang cua em toi dau roi");
    assert.equal(r.action, "ask_back");
    assert.match(r.reply, /số điện thoại/);
    assert.doesNotMatch(r.reply, /xem ảnh rồi|nhận được ảnh/);
  });
}

// =====================================================================================================
// Phiếu 2026-09-01-size-nac-dau-phay-gach-ngang (bộ đọc size, tầng 1 + từ vựng tầng 2)
// =====================================================================================================

{
  const extractor = new B.EntityExtractor(B.loadEntityConfig("giay-chay"), B.entityLexiconOf(runningShoesPack.lexicon, B.loadDialogueConfig("giay-chay")));
  test("size nấc: '42,5' / '42 rưỡi' → 42.5; '41-1/3' (gạch ngang) và '41-1 3' → 41 1/3", () => {
    assert.equal(extractor.extract("size 42,5 còn không").size, "42.5");
    assert.equal(extractor.extract("mình đi size 42 rưỡi").size, "42.5");
    assert.equal(extractor.extract("Ok. Lấy đôi Boston 12 - có 41-1/3 nhé").size, "41 1/3");
    assert.equal(extractor.extract("có 41-1 3 không shop").size, "41 1/3");
  });
  test("tra kho size 42.5 mà kho chỉ có nấc 1/3 → nấc 42 2/3, đánh dấu là nấc gần", () => {
    const f = B.buildStockFacts([BOSTON13], { code: "JS4955", requestedSize: "42.5" }, matching);
    assert.equal(f?.stock?.size, "42 2/3");
    assert.equal(f?.stock?.approximate, true);
  });

  test("nhãn kho hệ khác landing đã quy (quy_doi): đúng size khách hỏi → không phải nấc gần; quy ra NẤC GẦN (42 2/3 cho 42.5) → nấc gần", () => {
    const uk = item("UK1", "MAU UK M", [size("UK 7.5", { quy_doi: "41" } as never), size("UK 8.5", { quy_doi: "42 2/3" } as never)]);
    const exact = B.buildStockFacts([uk], { code: "UK1", requestedSize: "41" }, matching);
    assert.equal(exact?.stock?.size, "UK 7.5");
    assert.equal(exact?.stock?.approximate, false);
    const step = B.buildStockFacts([uk], { code: "UK1", requestedSize: "42.5" }, matching);
    assert.equal(step?.stock?.size, "UK 8.5");
    assert.equal(step?.stock?.approximate, true, "the customer is told it is the nearest step");
  });
}

// =====================================================================================================
// Phiếu 2026-09-05-con-mau-khac-size-nay-liet-ke-ban-cung-mau
// =====================================================================================================

{
  const W = (ma: string, ten: string, sizes: string[]) => item(ma, ten, sizes.map((s) => size(s)));
  const link = (q: { line: string; version: string; size: string; gender: string }) => `https://shop.example/?q=${encodeURIComponent(`${q.line} ${q.version}`)}&size=${q.size}&gender=${q.gender}`;

  test("(đang bàn Boston 13) size 44 còn những đôi nào → liệt kê các màu Boston 13 CÒN size 44 (tên + mã), không phán hết", () => {
    const a = W("JS4955", "ADIZERO BOSTON 13 M", ["42", "44"]);
    const b = W("IF9414", "ADIZERO BOSTON 13 M den", ["44"]);
    const c = W("IF9999", "ADIZERO BOSTON 13 M trang", ["42"]);
    const f = B.buildStockFacts([a, b, c], { code: "JS4955", requestedSize: "44", otherColorsAsked: true }, matching, { lines, filterLink: link });
    assert.deepEqual(f?.variantsAvailable.map((v) => v.code), ["JS4955", "IF9414"]);
    assert.match(f?.filterLink ?? "", /size=44/);
    const note = B.FactNoteComposer.compose({ ...B.turnFactsFromStock(f!), customerPronoun: "bác" }, B.loadNoteTexts("giay-chay"));
    assert.match(note, /IF9414/);
    assert.doesNotMatch(note, /IF9999/);
  });

  test("mẫu gốc là bản NỮ → chỉ bản nữ; không bản nữ nào còn size → mới nới giới tính", () => {
    const wBase = W("W1", "ADIZERO BOSTON 13 W", ["38", "39"]);
    const wOther = W("W2", "ADIZERO BOSTON 13 W hong", ["38"]);
    const man = W("M1", "ADIZERO BOSTON 13 M", ["38", "39"]);
    const women = B.buildStockFacts([wBase, wOther, man], { code: "W1", requestedSize: "38", otherColorsAsked: true }, matching, { lines, filterLink: link });
    assert.deepEqual(women?.variantsAvailable.map((v) => v.code), ["W1", "W2"]);
    const onlyMen = W("W3", "ADIZERO BOSTON 13 W xanh", ["36"]);
    const relaxed = B.buildStockFacts([onlyMen, man], { code: "W3", requestedSize: "39", otherColorsAsked: true }, matching, { lines, filterLink: link });
    assert.deepEqual(relaxed?.variantsAvailable.map((v) => v.code), ["M1"], "no women's colourway has 39: the men's one is offered");
  });

  test("tầng 1 (nhà thuốc giả): hỏi màu / mã / kiểu khác → hỏi biến thể khác; câu thường, 'còn bán gì', 'mà khác gì' thì không", () => {
    const c = B.loadMatchingConfig("nha-thuoc");
    for (const s of ["còn màu khác không", "còn những mã nào", "có kiểu nào khác không shop", "màu nào còn ạ", "có màu gì"]) assert.equal(B.asksOtherVariants(c, s), true, s);
    for (const s of ["còn hàng không", "shop còn bán gì nữa không", "cái này mà khác gì cái kia", "vỉ 10 viên còn không", "còn những đôi nào"]) assert.equal(B.asksOtherVariants(c, s), false, s);
  });

  test("tầng 2 (giày): 'size 44 còn những đôi nào' / 'đôi nào còn' là hỏi biến thể khác (danh từ 'đôi' của ngành)", () => {
    const c = B.loadMatchingConfig("giay-chay");
    for (const s of ["size 44 còn những đôi nào", "đôi nào còn size 44 ạ", "còn màu khác không", "còn đôi nào khác không shop"]) assert.equal(B.asksOtherVariants(c, s), true, s);
    for (const s of ["boston 13 size 44 còn không", "cho em đổi size 44"]) assert.equal(B.asksOtherVariants(c, s), false, s);
  });

  test("không bản nào còn ĐÚNG size → danh sách rỗng, không link, tồn của bản gốc = không có (không bịa)", () => {
    const f = B.buildStockFacts([BOSTON13, BOSTON13_DEN], { code: "JS4955", requestedSize: "46", otherColorsAsked: true }, matching, { lines, filterLink: link });
    assert.deepEqual(f?.variantsAvailable, []);
    assert.equal(f?.filterLink, undefined);
    assert.equal(f?.stock, null);
  });

}

// =====================================================================================================
// Phiếu 2026-09-07-ten-mau-co-so-doi-bi-bo-so (phần bộ não: ghi chú DA_TIM_THAY)
// =====================================================================================================

for (const id of ["giay-chay", "nha-thuoc"]) {
  const texts = B.loadNoteTexts(id);
  const FOUND: B.FoundProduct[] = [{ code: "AB13", name: "Mau A 13", price: 1000000, variants: ["M"] }];
  test(`${id}: lượt KHÔNG ảnh có danh sách tầng 1 → ghi chú agent có DA_TIM_THAY + cấm "chưa có"; lượt có ảnh → không nạp`, () => {
    const note = B.FactNoteComposer.compose({ found: FOUND }, texts);
    assert.match(note, /HE THONG DA TIM THAY TRONG KHO/);
    assert.match(note, /AB13/);
    assert.match(note, /KHONG noi "chua co/);
    assert.doesNotMatch(B.FactNoteComposer.compose({ found: FOUND, hasImage: true }, texts), /DA TIM THAY/);
  });
}

// =====================================================================================================
// Phiếu 2026-09-08-hang-het-kho-bi-noi-la-khong-kinh-doanh (03/10: bỏ khai Hàng hoá, bỏ brand_not_carried)
// =====================================================================================================

{
  const gate = new B.UncertainProductGate(scorer, lines);
  const NOW = "2026-09-25T09:00:00.000Z";
  const base = (over: Partial<B.UncertainInput> = {}): B.UncertainInput => ({
    message: "có giày hoka kawana 2 size 42 không", intent: "ask_size",
    entities: { productCode: "", productName: "hoka kawana 2", brand: "hoka" }, analysis: { productName: "hoka kawana 2", brand: "hoka" },
    resolution: null, hasImage: false, hasFocus: false, state: { hasRecentImageEvidence: false }, now: NOW, lexicon: pack.lexicon, hoiLai: hoiLaiFiller({}), ...over
  });

  test("hãng có trong từ vựng, kho không có mã nào → 'đang hết hàng' + hãng khác ĐANG có; không 'chưa kinh doanh'", () => {
    const out = gate.apply(base({ brandInCatalog: false, carriedBrands: ["adidas"] }));
    assert.ok(out !== null && out.action === "ask_clarification");
    assert.equal(out.why, "brand_out_of_stock");
    assert.match(out.reply, /hiện đang hết hàng/);
    assert.match(out.reply, /adidas/);
    assert.doesNotMatch(out.reply, /chưa kinh doanh|không bán|chưa đặt được/);
  });

  test("bên gọi không xác nhận được kho có hay không → không khẳng định 'hết', hỏi lại như no_product", () => {
    const out = gate.apply(base());
    assert.equal(out?.why, "no_product");
  });

  test("đã gửi ảnh Hoka + 'hoka slide 3 nữ size 36' (kho không có Hoka) → không xin lại ảnh: nói hết hàng hãng đó", () => {
    const out = gate.apply(base({
      message: "Shop có hoka slide 3 nữ size 36 hoặc 36,5 ko shop", entities: { productCode: "", productName: "hoka slide 3", brand: "hoka" },
      analysis: { productName: "hoka slide 3", brand: "hoka" }, brandInCatalog: false, state: { hasRecentImageEvidence: true }
    }));
    // A general "shop có <hãng> <dòng> …" question is the agent's (it must tra_kho, then say "đang hết hàng" —
    // tier-1 block `hang-khong-co`); a pointed one ("đôi hoka này") is the gate's answer. Neither asks for the photo again.
    assert.ok(out === null || (out.action === "ask_clarification" && !/xin ảnh|gửi ảnh/.test(out.reply)), JSON.stringify(out));
    const pointed = gate.apply(base({
      message: "đôi hoka này nữ size 36 còn không shop", entities: { productCode: "", productName: "", brand: "hoka" },
      analysis: { brand: "hoka" }, brandInCatalog: false, state: { hasRecentImageEvidence: true }
    }));
    assert.ok(pointed !== null && pointed.action === "ask_clarification", JSON.stringify(pointed));
    assert.equal(pointed.why, "brand_out_of_stock");
    assert.doesNotMatch(pointed.reply, /xin ảnh|gửi ảnh/);
    assert.match(pointed.reply, /hết hàng/);
  });

  test("hãng lạ ngoài từ vựng đã biết → không dám khẳng định 'hết'; hãng có trong kho → không phải hết hàng", () => {
    const odd = gate.apply(base({ entities: { productCode: "", productName: "zqx runner", brand: "zqx" }, analysis: { productName: "zqx runner", brand: "zqx" }, message: "có giày zqx runner size 42 không", brandInCatalog: false }));
    assert.notEqual(odd?.why, "brand_out_of_stock");
    assert.doesNotMatch(odd?.action === "ask_clarification" ? odd.reply : "", /hết hàng/);
    const inStock = gate.apply(base({ brandInCatalog: true }));
    assert.notEqual(inStock?.why, "brand_out_of_stock");
  });

  test("máy luật và cổng ngành không còn câu 'chưa kinh doanh hãng' (cổng brand_not_carried đã nghỉ)", () => {
    const raw = JSON.stringify(runningShoesPack);
    assert.doesNotMatch(raw, /brand_not_carried_needs_catalog/);
  });
}
