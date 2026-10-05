/**
 * 05/10/2026 — bốn phiếu Desk nhóm "bot tự khẳng định / cổng soát cắt sai" (bước 7 agent + 10 cổng soát):
 *   - 2026-09-01 khẳng định "đúng là mẫu … bên em" từ ảnh khách gửi;
 *   - 2026-09-13 bot tự xác nhận "đúng màu" thay khách (phần cổng; phần phản bác ở bộ định tuyến, test riêng);
 *   - 2026-09-15 cổng đè cả câu đúng của agent bằng câu "còn hàng" của mẫu khác;
 *   - 2026-09-16 cổng chống thúc ép chốt cắt oan câu trả lời đúng.
 * Bảng Ca kiểm của từng phiếu, chạy trên gói giày thật (tầng 2) và gói nhà thuốc (chỉ có phần chung — tầng 1).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { emptyShopProfile, type ShopProfile } from "@sp/contract";
import { cfg as matching, item, size } from "./stage3-fixtures.mts";

const base = (over: Partial<B.GateSources> = {}): B.GateSources => ({
  shopSaid: "", customerSaid: "", policy: "", hoSo: null, found: [], stockFacts: null,
  lookups: { orderLooked: false }, links: {}, pronoun: "bác", uncertainProduct: false,
  site: "shop.example", tenShop: "Shop Mẫu", ...over
});
const has = (trace: string[], name: string): boolean => trace.some((t) => t === name || t.startsWith(`${name}:`));
const profile = (over: Partial<ShopProfile["banHang"]> = {}): ShopProfile => {
  const p = emptyShopProfile();
  return { ...p, banHang: { ...p.banHang, ...over } };
};

// ------------------------------------------------------------ phiếu 2026-09-01 + 2026-09-13 (cổng)

for (const pack of ["giay-chay", "nha-thuoc"]) {
  const gate = new B.ReplyGate(B.loadReplyGateConfig(pack));
  const photo = (over: Partial<B.GateSources> = {}): B.GateSources => base({ photoContext: true, hasImages: true, customerSaid: "[ảnh]", ...over });

  test(`${pack}: ảnh khách + "Đúng là mẫu … bên em" → "nhìn giống mẫu …" + xin khách xác nhận`, () => {
    const r = gate.run("Dạ đúng là mẫu Boston 13 bên em ạ.", photo());
    assert.ok(has(r.trace, "image_match_needs_confirm"), r.trace.join(","));
    assert.doesNotMatch(r.reply, /đúng là/i);
    assert.match(r.reply, /nhìn giống mẫu Boston 13/);
    assert.match(r.reply, /xác nhận|xem giúp/);
  });

  test(`${pack}: ảnh khách + "Chính là mẫu này em đang có" → như trên`, () => {
    const r = gate.run("Chính là mẫu này em đang có ạ.", photo());
    assert.ok(has(r.trace, "image_match_needs_confirm"));
    assert.doesNotMatch(r.reply, /[Cc]hính là/);
    assert.match(r.reply, /^Nhìn giống mẫu này/);
  });

  test(`${pack}: câu đã "em thấy GIỐNG mẫu X, xác nhận giúp em" → giữ nguyên`, () => {
    const draft = "Dạ em thấy GIỐNG mẫu Boston 13, bác xem ảnh mẫu xác nhận giúp em nhé.";
    const r = gate.run(draft, photo());
    assert.equal(r.reply, draft);
    assert.equal(r.trace.length, 0);
  });

  test(`${pack}: KHÔNG có ảnh trong cuộc, khách gõ mã → không sửa`, () => {
    const draft = "Dạ đúng là mẫu JS4955 bên em ạ.";
    assert.equal(gate.run(draft, base({ customerSaid: "JS4955 còn không shop" })).reply, draft);
  });

  test(`${pack}: ảnh có MÃ IN đọc được / khách tự gõ mã → câu xác nhận mã không bị sửa oan`, () => {
    const draft = "Dạ đúng là mẫu JS4955 bên em ạ.";
    assert.equal(gate.run(draft, photo({ photoCodesRead: ["JS4955"] })).reply, draft);
    assert.equal(gate.run(draft, photo({ customerSaid: "[ảnh]\nmã JS4955 nhé" })).reply, draft);
    // Ảnh chỉ KHỚP ẢNH catalog (vân tay / so ảnh) chưa phải bằng chứng màu: vẫn sửa.
    assert.ok(has(gate.run(draft, photo({ photoCodes: ["JS4955"] })).trace, "image_match_needs_confirm"));
  });

  test(`${pack}: "Dạ đúng màu xanh lá đậm như ảnh bác gửi ạ" → cắt câu khẳng định màu, xin khách tự so`, () => {
    const r = gate.run("Dạ đúng màu xanh lá đậm như ảnh bác gửi ạ.", photo());
    assert.ok(has(r.trace, "image_match_needs_confirm"));
    assert.doesNotMatch(r.reply, /đúng màu|xanh lá/);
    assert.match(r.reply, /xác nhận|xem giúp/);
  });

  test(`${pack}: câu phần đúng giữ lại, chỉ mệnh đề khẳng định bị sửa ("đúng chuẩn", "giống hệt")`, () => {
    const r = gate.run("Dạ mẫu này đúng chuẩn ạ. Bên em giao toàn quốc ạ.", photo());
    assert.doesNotMatch(r.reply, /đúng chuẩn/);
    assert.match(r.reply, /giao toàn quốc/);
    assert.doesNotMatch(gate.run("Dạ giống hệt ảnh bác gửi ạ.", photo()).reply, /giống hệt/);
  });

  test(`${pack}: câu HỎI / câu rào đón không phải khẳng định → giữ`, () => {
    for (const draft of ["Bác xem có đúng màu bác cần không ạ?", "Dạ em chưa chắc đúng màu như ảnh, bác xác nhận giúp em ạ.", "Dạ ảnh bác gửi không đúng màu bên em có ạ."]) {
      assert.equal(gate.run(draft, photo()).reply, draft, draft);
    }
  });

  test(`${pack}: người trực đã nói "đúng mẫu này bên em" → bot nhắc lại không bị sửa`, () => {
    const draft = "Dạ đúng là mẫu này bên em ạ.";
    assert.equal(gate.run(draft, photo({ shopSaid: "đúng là mẫu này bên em nhé" })).reply, draft);
  });
}

test("giay-chay: 'đúng đôi này' / 'chính là đôi này' (từ ngành) cũng là khẳng định", () => {
  const gate = new B.ReplyGate(B.loadReplyGateConfig("giay-chay"));
  const r = gate.run("Dạ chính là đôi này bên em ạ.", base({ photoContext: true }));
  assert.ok(has(r.trace, "image_match_needs_confirm"));
  assert.match(r.reply, /nhìn giống đôi này/);
  assert.match(r.reply, /đúng đôi bác thích/);
});

// ------------------------------------------------------------ phiếu 2026-09-15 (cổng thay cả câu bằng tồn mẫu khác)

const RUNFALCON = item("ID2286", "RUNFALCON 3.0", [size("40", { gia: 1290000 }), size("41", { gia: 1290000 })], { hang: "adidas" });
const PUMA = item("JQ3037", "VELOCITY NITRO 4", [size("41", { gia: 2990000 })], { hang: "puma" });

{
  const gate = new B.ReplyGate(B.loadReplyGateConfig("giay-chay"));
  const brands = B.loadPack("giay-chay").lexicon.brands;
  const facts = B.buildStockFacts([RUNFALCON], { code: "ID2286", requestedSize: "40" }, matching);
  const src = (over: Partial<B.GateSources> = {}): B.GateSources => base({ found: [RUNFALCON], stockFacts: facts, brandWords: brands, customerSaid: "Đôi này em còn 40 ko", ...over });

  test("stockFacts RUNFALCON còn 40; agent nói 'Puma này bên em chưa đặt được' / 'là hàng order' / 'size 40 hết' → GIỮ", () => {
    for (const draft of ["Dạ Puma này bên em chưa đặt được ạ.", "Dạ Puma này là hàng order ạ.", "Dạ Puma này size 40 bên em hết hàng rồi ạ."]) {
      const r = gate.run(draft, src({ hasImages: true }));
      assert.equal(r.reply, draft, `${draft} → ${r.reply} (${r.trace.join(",")})`);
    }
  });

  test("mã khác stockFacts ('mẫu JQ3037 … chưa đặt được') → giữ", () => {
    const draft = "Dạ mẫu JQ3037 size 40 bên em chưa đặt được ạ.";
    assert.equal(gate.run(draft, src({ found: [RUNFALCON, PUMA] })).reply, draft);
  });

  test("đúng mẫu stockFacts ('Runfalcon 3.0 size 40 … chưa đặt được') → vẫn sửa thành câu còn hàng", () => {
    const r = gate.run("Dạ Runfalcon 3.0 size 40 bên em chưa đặt được ạ.", src());
    assert.ok(has(r.trace, "contradicts_stock_in"));
    assert.match(r.reply, /RUNFALCON 3\.0 \(ID2286\) size 40 bên em còn 2 đôi/);
  });

  test("'size 40 hết rồi ạ' không nhắc mẫu: không ảnh → sửa; có ảnh chưa nhận ra → giữ; ảnh nhận ra đúng mẫu → sửa", () => {
    const draft = "Dạ size 40 hết rồi ạ.";
    assert.ok(has(gate.run(draft, src()).trace, "contradicts_stock_in"));
    assert.equal(gate.run(draft, src({ hasImages: true })).reply, draft);
    assert.ok(has(gate.run(draft, src({ hasImages: true, photoCodes: ["ID2286"] })).trace, "contradicts_stock_in"));
  });

  test("danh sách xuống dòng, dòng báo hết là dòng Puma → giữ", () => {
    const draft = "Dạ bên em có:\nRunfalcon 3.0 size 40 còn ạ\nPuma Velocity Nitro 4 size 40 hết hàng";
    assert.equal(gate.run(draft, src({ found: [RUNFALCON, PUMA] })).reply, draft);
  });

  test("danh sách xuống dòng, dòng báo hết là dòng ĐÚNG mẫu → chỉ dòng đó bị thay, vẫn là danh sách", () => {
    const r = gate.run("Dạ bên em có:\nPuma Velocity Nitro 4 size 41 còn ạ\nRunfalcon 3.0 size 40 hết hàng", src({ found: [RUNFALCON, PUMA] }));
    assert.ok(has(r.trace, "contradicts_stock_in"));
    assert.equal(r.reply.split("\n").length, 3, r.reply);
    assert.match(r.reply, /^Dạ bên em có:\nPuma Velocity Nitro 4 size 41 còn ạ\nDạ mẫu RUNFALCON 3\.0/);
  });

  test("'Mẫu Puma này, bên em hết size 40 rồi ạ' (dấu phẩy) → giữ", () => {
    const draft = "Dạ mẫu Puma này, bên em hết size 40 rồi ạ.";
    assert.equal(gate.run(draft, src()).reply, draft);
  });

  test("'Runfalcon … nhưng size 40 hết hàng' và 'Runfalcon™ ➡ size 40 hết hàng' → vẫn sửa", () => {
    assert.ok(has(gate.run("Dạ Runfalcon thì đẹp nhưng size 40 hết hàng rồi ạ.", src()).trace, "contradicts_stock_in"));
    assert.ok(has(gate.run("Runfalcon™ ➡ size 40 hết hàng", src()).trace, "contradicts_stock_in"));
  });

  test("sửa HẸP: chỉ câu sai bị thay, câu gợi ý mẫu khác ngay sau nó bỏ, câu khác giữ", () => {
    const r = gate.run("Dạ Runfalcon 3.0 size 40 hết rồi ạ. Bác tham khảo mẫu khác nhé. Bên em giao toàn quốc ạ.", src());
    assert.ok(has(r.trace, "contradicts_stock_in"));
    assert.match(r.reply, /size 40 bên em còn 2 đôi/);
    assert.doesNotMatch(r.reply, /tham khảo mẫu khác|hết rồi/);
    assert.match(r.reply, /giao toàn quốc/);
  });

  test("chiều ngược (kho HẾT, câu nói CÒN) cũng chỉ xét câu nói về đúng mẫu", () => {
    const out = B.buildStockFacts([RUNFALCON], { code: "ID2286", requestedSize: "44" }, matching);
    const s = (over: Partial<B.GateSources> = {}): B.GateSources => src({ stockFacts: out, ...over });
    assert.ok(has(gate.run("Dạ Runfalcon size 44 bên em còn hàng ạ.", s()).trace, "contradicts_stock_out"));
    const other = "Dạ Puma này size 44 bên em còn hàng ạ.";
    assert.equal(gate.run(other, s()).reply, other);
  });
}

test("tầng 1 (nhà thuốc giả, mẫu câu tồn kho của ngành giả): câu hết hàng nhắc hãng khác → giữ; đúng hàng → sửa", () => {
  const cfg0 = B.loadReplyGateConfig("nha-thuoc");
  const cfg: typeof cfg0 = { ...cfg0, evidence: { ...cfg0.evidence, saysOut: ["het[^,.!?]{0,30}{size}", "{size}[^,.!?]{0,30}het"], inStockReply: "Dạ {ten} ({ma}) loại {size} bên em còn {ton} hộp ạ." } };
  const gate = new B.ReplyGate(cfg);
  const para = item("TP1001", "PARACETAMOL 500MG", [size("vi 10", { so_luong: 5, gia: 20000 })], { hang: "traphaco" });
  const facts = B.buildStockFacts([para], { code: "TP1001", requestedSize: "vi 10" }, B.loadMatchingConfig("nha-thuoc"));
  assert.ok(facts !== null && facts.stock !== null, "sự thật tồn của ngành giả");
  const src = base({ found: [para], stockFacts: facts, brandWords: B.loadPack("nha-thuoc").lexicon.brands, customerSaid: "còn vỉ 10 không" });
  const other = "Dạ thuốc Stada này hết vi 10 rồi ạ.";
  assert.equal(gate.run(other, src).reply, other);
  const r = gate.run("Dạ Paracetamol hết vi 10 rồi ạ.", src);
  assert.ok(has(r.trace, "contradicts_stock_in"), r.trace.join(","));
});

// ------------------------------------------------------------ phiếu 2026-09-16 (chống thúc ép chốt)

for (const pack of ["giay-chay", "nha-thuoc"]) {
  const gate = new B.ReplyGate(B.loadReplyGateConfig(pack));
  const hoSo = profile({ thoiGianOrder: "3-7 ngày" });

  test(`${pack}: "bác chốt thì em đặt, khoảng 3-7 ngày" là mệnh đề điều kiện → giữ nguyên, không câu tiễn khách`, () => {
    const draft = "Dạ hàng order bên em đặt riêng theo đơn, bác chốt thì em đặt, khoảng 3-7 ngày là hàng về tới kho rồi bên em gửi đi cho bác ạ.";
    for (const ask of ["Od lâu k ạ", "Mấy ngày có ạ", "màu gì vậy shop"]) {
      const r = gate.run(draft, base({ customerSaid: ask, hoSo }));
      assert.equal(r.reply, draft, `${ask}: ${r.trace.join(",")}`);
      assert.ok(!has(r.trace, "no_push_close"));
    }
  });

  test(`${pack}: khách hỏi chung chung, bot "Bác chốt lấy … không ạ?" → chỉ cắt mệnh đề mời chốt`, () => {
    const r = gate.run("Dạ mẫu này bên em còn hàng ạ. Bác chốt lấy mẫu này không ạ?", base({ customerSaid: "Mẫu này màu gì vậy shop" }));
    assert.ok(has(r.trace, "no_push_close"));
    assert.equal(r.reply, "Dạ mẫu này bên em còn hàng ạ.");
    const c = gate.run("Dạ mẫu này màu xám ạ, bác chốt lấy không ạ?", base({ customerSaid: "Mẫu này màu gì vậy shop" }));
    assert.equal(c.reply, "Dạ mẫu này màu xám ạ.");
  });

  test(`${pack}: câu chỉ toàn lời mời chốt (cắt sạch) → GIỮ câu gốc + gọi người, không câu tiễn khách`, () => {
    const draft = "Dạ bác chốt lấy mẫu này không ạ?";
    const r = gate.run(draft, base({ customerSaid: "Mẫu này màu gì vậy shop" }));
    assert.equal(r.reply, draft);
    assert.equal(r.needsHuman, true);
    assert.ok(has(r.trace, "no_push_close_all_cut"));
    assert.doesNotMatch(r.reply, /xem thêm/);
  });

  test(`${pack}: khách đã có dấu hiệu mua (hỏi bao lâu / mô hình đọc ra ý mua) → không cắt "em lên đơn nhé"`, () => {
    const draft = "Dạ khoảng 3-7 ngày ạ, em lên đơn cho bác nhé.";
    assert.equal(gate.run(draft, base({ customerSaid: "Đặt bao lâu thì có vậy em", hoSo })).reply, draft);
    assert.equal(gate.run(draft, base({ customerSaid: "ừ", hoSo, buyingSignals: true })).reply, draft);
  });
}

test("giay-chay: 'Order bao lâu vậy em' / 'Đôi này màu gì' (từ của ngành: order, đôi)", () => {
  const gate = new B.ReplyGate(B.loadReplyGateConfig("giay-chay"));
  const hoSo = profile({ thoiGianOrder: "3-7 ngày" });
  const keep = "Dạ khoảng 3-7 ngày ạ, em lên đơn nhé.";
  assert.equal(gate.run(keep, base({ customerSaid: "Order bao lâu vậy em", hoSo })).reply, keep);
  const r = gate.run("Dạ mẫu này bên em còn size 42 ạ. Bác chốt lấy đôi này không ạ?", base({ customerSaid: "Đôi này màu gì vậy shop" }));
  assert.equal(r.reply, "Dạ mẫu này bên em còn size 42 ạ.");
});
