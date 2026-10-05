/**
 * 05/10/2026 — phiếu Desk 2026-09-02 "bot bịa lý do đổi giá và cãi giá khách" (bước 10 cổng soát).
 *
 * Nguyên tắc chung: hệ thống không lưu lịch sử giá, nên MỌI câu giải thích vì sao giá đổi là bịa (trừ khi
 * người trực / chính sách nói); khách nêu một con số khi đang đối chiếu giá mà bot định nói con số KHÁC thì
 * không cãi — bỏ câu đó, nói sẽ kiểm tra lại giá, gọi người trực.
 *
 * Tầng 1: chạy trên gói NHÀ THUỐC (chỉ phần chung) và gói giày thật (tầng 2 ghép lên) — bảng Ca kiểm của phiếu.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import "./fixtures.mts";

const base = (over: Partial<B.GateSources> = {}): B.GateSources => ({
  shopSaid: "", customerSaid: "", policy: "", hoSo: null, found: [], stockFacts: null,
  lookups: { orderLooked: false }, links: {}, pronoun: "anh", uncertainProduct: false,
  site: "shop.example", tenShop: "Shop Mẫu", ...over
});
const has = (trace: string[], name: string): boolean => trace.some((t) => t === name || t.startsWith(`${name}:`));
/** One catalogue item at a given price (the price the storefront shows). */
const item = (ma: string, ten: string, gia: number): B.FoundItem => ({
  ma, ten, loai: "", link: `https://shop.example/product/${ma}`,
  cac_size: [{ size: "M", gia, so_luong: 3, con_hang: true }]
} as unknown as B.FoundItem);

for (const pack of ["nha-thuoc", "giay-chay"]) {
  const gate = new B.ReplyGate(B.loadReplyGateConfig(pack));

  test(`${pack}: nháp "giá cũ 1.250k, đợt này vừa cập nhật lại giá 1.350k" → cắt câu bịa, câu kiểm tra giá, gọi người`, () => {
    const r = gate.run("Dạ ảnh web anh chụp là đợt giá cũ 1.250k, đợt này hàng vừa cập nhật lại giá 1.350k ạ :D",
      base({ customerSaid: "Giá 1250 mà", found: [item("AB1234", "Mẫu A", 1350000)] }));
    assert.ok(has(r.trace, "bia_ly_do_doi_gia"), r.trace.join(","));
    assert.doesNotMatch(r.reply, /cập nhật|giá cũ|1\.350/);
    assert.match(r.reply, /kiểm tra lại giá/);
    assert.equal(r.needsHuman, true);
    assert.equal(r.handoffReason, "bia_ly_do_doi_gia");
  });

  test(`${pack}: nháp "web chưa kịp cập nhật giá nên khác ạ" → cắt, gọi người`, () => {
    const r = gate.run("Dạ mẫu này còn ạ. Do web chưa kịp cập nhật giá nên khác ạ.", base({ customerSaid: "sao giá trên web khác vậy" }));
    assert.ok(has(r.trace, "bia_ly_do_doi_gia"), r.trace.join(","));
    assert.doesNotMatch(r.reply, /chưa kịp/);
    assert.match(r.reply, /mẫu này còn/);
    assert.equal(r.needsHuman, true);
  });

  test(`${pack}: các kiểu bịa khác — "giá đợt trước", "vừa tăng giá", "hết chương trình giảm giá" → cắt`, () => {
    for (const draft of [
      "Dạ đó là giá đợt trước rồi ạ.",
      "Dạ bên em vừa tăng giá mẫu này ạ.",
      "Dạ mẫu này hết chương trình giảm giá rồi nên giá lên lại ạ.",
      "Dạ giá trên ảnh là giá cũ rồi anh ạ."
    ]) {
      const r = gate.run(draft, base({ customerSaid: "giá 1250 mà" }));
      assert.ok(has(r.trace, "bia_ly_do_doi_gia"), `${draft} → ${r.trace.join(",")}`);
      assert.equal(r.needsHuman, true, draft);
    }
  });

  test(`${pack}: người trực đã tự nói lý do đổi giá → câu bot nhắc lại có nguồn, không cắt`, () => {
    const draft = "Dạ bên em vừa tăng giá mẫu này từ đầu tháng ạ.";
    const r = gate.run(draft, base({ shopSaid: "Mẫu này bên chị vừa tăng giá từ đầu tháng nhé", customerSaid: "sao giá cao hơn tuần trước" }));
    assert.ok(!has(r.trace, "bia_ly_do_doi_gia"), r.trace.join(","));
  });

  test(`${pack}: khách "Giá 1250 mà" (kèm ảnh web), bot nháp "giá chuẩn là 1.350k ạ" → không gửi 1.350k, gọi người`, () => {
    const r = gate.run("Dạ giá chuẩn trên hệ thống là 1.350k ạ.",
      base({ customerSaid: "[ảnh]\nGiá 1250 mà", customerMessage: "Giá 1250 mà", hasImages: true, found: [item("AB1234", "Mẫu A", 1350000)] }));
    assert.ok(has(r.trace, "khach_doi_chieu_gia"), r.trace.join(","));
    assert.doesNotMatch(r.reply, /1\.350|1350/);
    assert.match(r.reply, /kiểm tra lại giá/);
    assert.equal(r.needsHuman, true);
    assert.equal(r.handoffReason, "khach_doi_chieu_gia");
  });

  test(`${pack}: khách nêu giá bằng nhiều cách viết ("1tr25", "1.250.000", "1250k") → cùng một số`, () => {
    for (const said of ["sao web ghi 1tr25 mà", "trên web 1.250.000 mà shop", "web để 1250k sao lại khác"]) {
      const r = gate.run("Dạ mẫu này giá 1.350.000đ ạ.", base({ customerSaid: said, found: [item("AB1234", "Mẫu A", 1350000)] }));
      assert.ok(has(r.trace, "khach_doi_chieu_gia"), `${said} → ${r.trace.join(",")}`);
    }
  });

  test(`${pack}: khách đối chiếu giá, bot nói ĐÚNG số khách nêu → không chặn`, () => {
    const draft = "Dạ đúng ạ, mẫu này đang 1.250.000đ ạ.";
    const r = gate.run(draft, base({ customerSaid: "Giá 1250 mà", found: [item("AB1234", "Mẫu A", 1250000)] }));
    assert.ok(!has(r.trace, "khach_doi_chieu_gia"), r.trace.join(","));
    assert.equal(r.reply, draft);
  });

  test(`${pack}: dữ liệu giá web là 1.250k, bot nháp 1.350k, khách nói 1250 → cổng đổi về giá dữ liệu, không cãi khách`, () => {
    const r = gate.run("Dạ mẫu AB1234 giá 1.350.000đ ạ.", base({ customerSaid: "Giá 1250 mà", found: [item("AB1234", "Mẫu A", 1250000)] }));
    assert.doesNotMatch(r.reply, /1\.350/);
    assert.match(r.reply, /1\.250\.000/);
  });

  test(`${pack}: khách "cho em xin IE0841 size 42" → không đọc IE0841 thành 841.000đ, không chặn oan`, () => {
    const draft = "Dạ mẫu IE0841 size 42 giá 1.350.000đ còn hàng ạ.";
    const r = gate.run(draft, base({ customerSaid: "cho em xin IE0841 size 42", found: [item("IE0841", "Mẫu B", 1350000)] }));
    assert.ok(!has(r.trace, "khach_doi_chieu_gia") && !has(r.trace, "bia_ly_do_doi_gia"), r.trace.join(","));
  });

  test(`${pack}: khách mã có số trong câu đối chiếu ("IE0841 trên web 1250 mà") → chỉ 1.250.000 là số khách nêu`, () => {
    const r = gate.run("Dạ mẫu IE0841 giá 1.250.000đ ạ.", base({ customerSaid: "IE0841 trên web 1250 mà", found: [item("IE0841", "Mẫu B", 1250000)] }));
    assert.ok(!has(r.trace, "khach_doi_chieu_gia"), r.trace.join(","));
  });

  test(`${pack}: khách hỏi "giá bao nhiêu" (không tranh luận), bot báo đúng giá kho → không chặn`, () => {
    const draft = "Dạ mẫu này giá 1.350.000đ ạ.";
    const r = gate.run(draft, base({ customerSaid: "mẫu này giá bao nhiêu shop", found: [item("AB1234", "Mẫu A", 1350000)] }));
    assert.equal(r.reply, draft);
    assert.equal(r.trace.length, 0, r.trace.join(","));
  });

  test(`${pack}: khách đối chiếu giá nhưng tiền cọc / phí ship trong câu bot → không coi là cãi giá`, () => {
    const draft = "Dạ phí ship 30.000đ, anh chuyển cọc giúp em nhé.";
    const r = gate.run(draft, base({ customerSaid: "Giá 1250 mà", shopSaid: "phí ship 30.000đ" }));
    assert.ok(!has(r.trace, "khach_doi_chieu_gia"), r.trace.join(","));
  });
}
