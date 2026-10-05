/**
 * 05/10/2026 — phiếu Desk 2026-09-05 "khách bấm Trả lời vào ảnh / thẻ / bài viết / story", phần BỘ NÃO (bước 1).
 *
 * Nguyên tắc chung: tin khách đang "Trả lời" quyết định câu hiện tại nói về cái gì (mạnh hơn mẫu bot đang
 * theo); dòng do KÊNH tự chèn (boi "meta") không bao giờ là một lượt page trả lời — chùm tin / ảnh của khách đọc
 * xuyên qua nó, và điều nó báo đi vào ghi chú hệ thống.
 *
 * Tầng 1: ngành giả (nhà thuốc) cho cơ chế; gói giày thật chạy cùng bảng Ca kiểm.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { TurnContextBuilder, renderHistory } from "@sp/xeon";
import * as B from "@sp/brain";
import "./industries.mts";

const NOW = new Date("2026-10-05T10:00:00.000Z");
const minutesAgo = (m: number): string => new Date(NOW.getTime() - m * 60_000).toISOString();
type Line = { maTin?: string; chieu: "den" | "di"; boi: string; chu: string; soAnh: number; luc: string; anh?: string[]; traLoiTin?: string; loaiMeta?: string };
const NOTICE = "Tùng Nguyễn đã trả lời về một bài viết. Xem bài viết(https://www.facebook.com/story.php?story_fbid=123&id=456)";

for (const pack of ["nha-thuoc", "giay-chay"]) {
  const builder = new TurnContextBuilder({ dialogue: B.loadDialogueConfig(pack), ledgerTexts: B.loadLedgerTexts(), brands: [] });
  const build = (tin: Line[], message: { maTin: string; chu: string; luc: string; traLoiTin?: string; anh?: string[]; soAnh?: number }, state: B.ConversationState | null = null) =>
    builder.build({ tenant: "t", conversationId: "facebook:1", message, recent: { tin }, state, now: NOW });

  test(`${pack}: ảnh khách → dòng Meta "đã trả lời về một bài viết" → câu hỏi: dòng Meta không cắt chùm, bot thấy CẢ ảnh, có ghi chú bài viết`, () => {
    const tin: Line[] = [
      { maTin: "cu", chieu: "den", boi: "khach", chu: "mẫu X còn không", soAnh: 0, luc: minutesAgo(600) },
      { maTin: "cu2", chieu: "di", boi: "bo-nao", chu: "Dạ mẫu X còn ạ", soAnh: 0, luc: minutesAgo(599) },
      { maTin: "a", chieu: "den", boi: "khach", chu: "", soAnh: 1, anh: ["https://cdn.example/a.jpg"], luc: minutesAgo(2) },
      { maTin: "n", chieu: "di", boi: "meta", chu: NOTICE, soAnh: 0, luc: minutesAgo(2), loaiMeta: "tra-loi-bai-viet" },
      { maTin: "q", chieu: "den", boi: "khach", chu: "Có loại lớn không", soAnh: 0, luc: minutesAgo(1) }
    ];
    const ctx = build(tin, { maTin: "q", chu: "Có loại lớn không", luc: minutesAgo(1) });
    assert.deepEqual(ctx.photos.map((p) => p.url), ["https://cdn.example/a.jpg"], "ảnh trước dòng Meta vẫn là ảnh của lượt");
    assert.equal(ctx.photoEvidence, true);
    const text = renderHistory(ctx.history, NOW.toISOString());
    assert.doesNotMatch(text, /PAGE[^:]*: Tùng Nguyễn đã trả lời/, "dòng Meta không hiện như một câu page");
    assert.match(text, /GHI CHU HE THONG: Khách bấm "Trả lời" vào một bài viết \/ story của page \(https:\/\/www\.facebook\.com\/story\.php/);
    assert.equal(ctx.history.filter((h) => h.text === "Có loại lớn không").length, 1, "tin khách không bị chép đôi");
    // The frame reads the page's last REAL line, not Meta's.
    assert.ok(ctx.frame === null || ctx.frame.kind !== "statement" || !/trả lời về/.test(JSON.stringify(ctx.frame)));
  });

  test(`${pack}: dòng Meta tới SAU câu hỏi của khách → câu hỏi vẫn là dòng cuối, đúng một lần`, () => {
    const tin: Line[] = [
      { maTin: "q", chieu: "den", boi: "khach", chu: "Còn không shop", soAnh: 0, luc: minutesAgo(1) },
      { maTin: "n", chieu: "di", boi: "meta", chu: NOTICE, soAnh: 0, luc: minutesAgo(0.5), loaiMeta: "tra-loi-bai-viet" }
    ];
    const ctx = build(tin, { maTin: "q", chu: "Còn không shop", luc: minutesAgo(1) });
    assert.equal(ctx.history.length, 1);
    assert.equal(ctx.history[0]!.who, "khach");
    assert.match(ctx.history[0]!.note ?? "", /bài viết \/ story/);
  });

  test(`${pack}: dòng kênh khác ("Bạn đang phản hồi bình luận…") cũng không phải lượt page: chùm chữ đọc xuyên qua`, () => {
    const tin: Line[] = [
      { maTin: "1", chieu: "den", boi: "khach", chu: "shop ơi", soAnh: 0, luc: minutesAgo(3) },
      { maTin: "n", chieu: "di", boi: "meta", chu: "Bạn đang phản hồi bình luận của một người dùng", soAnh: 0, luc: minutesAgo(2) },
      { maTin: "2", chieu: "den", boi: "khach", chu: "còn hàng không", soAnh: 0, luc: minutesAgo(1) }
    ];
    const ctx = build(tin, { maTin: "2", chu: "còn hàng không", luc: minutesAgo(1) });
    assert.equal(ctx.burstText, "shop ơi | còn hàng không");
    assert.match(ctx.history.at(-1)!.note ?? "", /Dòng hệ thống của kênh/);
  });

  test(`${pack}: khách reply vào THẺ sản phẩm của page rồi hỏi ngắn → mẫu chính của lượt = mẫu trên thẻ (by reply_to) + ghi chú`, () => {
    const state = { ...B.emptyState("t" as never, "facebook:1" as never), ledger: { ...B.ConversationLedger.empty(), products: [{ code: "AB1234", name: "Mẫu A", brand: "", askedSizes: [], status: "quan_tam", source: "he_thong", lastAt: "" }] } } as unknown as B.ConversationState;
    const tin: Line[] = [
      { maTin: "the", chieu: "di", boi: "bo-nao", chu: "Mẫu A (AB1234) giá 250.000đ https://shop.example/product/AB1234", soAnh: 0, luc: minutesAgo(10) },
      { maTin: "x", chieu: "di", boi: "bo-nao", chu: "Dạ mẫu B (CD5678) cũng còn ạ", soAnh: 0, luc: minutesAgo(9) },
      { maTin: "q", chieu: "den", boi: "khach", chu: "còn loại lớn không", soAnh: 0, luc: minutesAgo(1), traLoiTin: "the" }
    ];
    const ctx = build(tin, { maTin: "q", chu: "còn loại lớn không", luc: minutesAgo(1), traLoiTin: "the" }, state);
    assert.equal(ctx.focusedProduct?.code, "AB1234");
    assert.equal(ctx.focusedProduct?.by, "reply_to");
    assert.match(ctx.replyNote, /KHÁCH ĐANG TRẢ LỜI \(reply\) VÀO TIN CỦA PAGE/);
  });

  test(`${pack}: khách reply vào ẢNH của chính mình, hỏi ngắn → ảnh đó được mượn làm ảnh của lượt`, () => {
    const tin: Line[] = [
      { maTin: "anh", chieu: "den", boi: "khach", chu: "", soAnh: 1, anh: ["https://cdn.example/old.jpg"], luc: minutesAgo(8) },
      { maTin: "p", chieu: "di", boi: "Lan", chu: "Dạ chị đợi em chút", soAnh: 0, luc: minutesAgo(7) },
      { maTin: "q", chieu: "den", boi: "khach", chu: "cái này giá sao", soAnh: 0, luc: minutesAgo(1), traLoiTin: "anh" }
    ];
    const ctx = build(tin, { maTin: "q", chu: "cái này giá sao", luc: minutesAgo(1), traLoiTin: "anh" });
    assert.deepEqual(ctx.photos.map((p) => p.url), ["https://cdn.example/old.jpg"]);
    assert.match(ctx.replyNote, /VÀO TIN CỦA CHÍNH KHÁCH/);
  });

  test(`${pack}: khách reply vào tin CHỮ của page, hỏi "là sao vậy" → ghi chú bắt giải thích lại đúng tin đó`, () => {
    const tin: Line[] = [
      { maTin: "cs", chieu: "di", boi: "bo-nao", chu: "Dạ đơn trên 500k bên em miễn phí giao ạ", soAnh: 0, luc: minutesAgo(5) },
      { maTin: "q", chieu: "den", boi: "khach", chu: "là sao vậy", soAnh: 0, luc: minutesAgo(1), traLoiTin: "cs" }
    ];
    const ctx = build(tin, { maTin: "q", chu: "là sao vậy", luc: minutesAgo(1), traLoiTin: "cs" });
    assert.match(ctx.replyNote, /miễn phí giao/);
    assert.match(ctx.replyNote, /GIẢI THÍCH LẠI/);
  });
}
