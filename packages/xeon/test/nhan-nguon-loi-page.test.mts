/**
 * 05/10/2026 — phiếu Desk 2026-09-01 "agent thấy transcript thô, thiếu sổ phiên và nhãn nguồn" (bước 6–7, 10).
 *
 * Nguyên tắc chung: bối cảnh của nơi soạn câu lấy từ kho tin phía máy chủ (hộp thư landing), mỗi câu page mang
 * nhãn ai viết (bot / người trực / không rõ), và câu do BOT viết không bao giờ là nguồn sự thật — kể cả khi
 * khách hỏi lại đúng câu đó.
 *
 * Tầng 1: ngành / shop GIẢ (nhà thuốc) cho cơ chế; gói giày thật chạy cùng bảng Ca kiểm.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { TurnContextBuilder, renderHistory } from "@sp/xeon";
import * as B from "@sp/brain";
import "./industries.mts";

const NOW = new Date("2026-09-24T10:00:00.000Z");
const minutesAgo = (m: number): string => new Date(NOW.getTime() - m * 60_000).toISOString();
type Line = { maTin?: string; chieu: "den" | "di"; boi: string; chu: string; soAnh: number; luc: string };

for (const pack of ["nha-thuoc", "giay-chay"]) {
  const builder = new TurnContextBuilder({ dialogue: B.loadDialogueConfig(pack), ledgerTexts: B.loadLedgerTexts(), brands: [] });

  test(`${pack}: kho tin máy chủ có 30 tin, câu xác nhận của bot ở xa — agent thấy đủ, "Đúng rồi" nối với câu đó`, () => {
    const tin: Line[] = [];
    for (let i = 0; i < 26; i += 1) tin.push({ maTin: `x${i}`, chieu: i % 2 === 0 ? "den" : "di", boi: i % 2 === 0 ? "khach" : "bo-nao", chu: `tin ${i}`, soAnh: 0, luc: minutesAgo(60 - i) });
    tin.push({ maTin: "q", chieu: "di", boi: "bo-nao", chu: "Dạ em xác nhận lại: mình lấy 2 hộp loại lớn, giao về địa chỉ cũ đúng không ạ?", soAnh: 0, luc: minutesAgo(3) });
    tin.push({ maTin: "a", chieu: "den", boi: "khach", chu: "Đúng rồi", soAnh: 0, luc: minutesAgo(0) });
    const ctx = builder.build({ tenant: "t", conversationId: "facebook:1", message: { maTin: "a", chu: "Đúng rồi", luc: minutesAgo(0) }, recent: { tin }, state: null, now: NOW });
    const text = renderHistory(ctx.history, NOW.toISOString());
    assert.match(text, /PAGE \(bot tu dong[^)]*\): Dạ em xác nhận lại/);
    assert.match(text.split("\n").at(-1)!, /^.*KHACH: Đúng rồi/);
    assert.equal(ctx.frame?.answer, "agree", "khung hội thoại đọc 'Đúng rồi' là đồng ý câu page vừa hỏi");
  });

  test(`${pack}: tin page do NGƯỜI TRỰC gõ → "nguoi truc"; tin cũ không nhãn → "không rõ", không mặc định là người`, () => {
    const tin: Line[] = [
      { maTin: "1", chieu: "den", boi: "khach", chu: "còn không shop", soAnh: 0, luc: minutesAgo(9) },
      { maTin: "2", chieu: "di", boi: "", chu: "còn nhé", soAnh: 0, luc: minutesAgo(8) },
      { maTin: "3", chieu: "di", boi: "Lan", chu: "Bên chị nhận đổi trả trong 3 ngày nhé", soAnh: 0, luc: minutesAgo(7) },
      { maTin: "4", chieu: "den", boi: "khach", chu: "ok", soAnh: 0, luc: minutesAgo(0) }
    ];
    const ctx = builder.build({ tenant: "t", conversationId: "facebook:1", message: { maTin: "4", chu: "ok", luc: minutesAgo(0) }, recent: { tin }, state: null, now: NOW });
    assert.deepEqual(ctx.history.map((h) => h.who), ["khach", "khong_ro", "nguoi", "khach"]);
  });

  const gate = new B.ReplyGate(B.loadReplyGateConfig(pack));
  const src = (over: Partial<B.GateSources> = {}): B.GateSources => ({
    shopSaid: "", customerSaid: "vậy đổi trả được đúng không", customerMessage: "vậy đổi trả được đúng không", policy: "", hoSo: null, found: [], stockFacts: null,
    lookups: { orderLooked: false }, links: {}, pronoun: "anh", uncertainProduct: false, site: "shop.example", tenShop: "Shop", ...over
  });

  test(`${pack}: bot từng bịa "có hỗ trợ đổi trả"; khách hỏi lại "vậy đổi trả được đúng không"; nháp "Dạ đúng rồi ạ" → không xác nhận, kiểm chính sách, gọi người`, () => {
    // The bot's own earlier line is NOT in `shopSaid` (only a person's words are a source).
    for (const draft of ["Dạ đúng rồi ạ.", "Dạ vâng ạ.", "Dạ đúng rồi ạ, bên em có hỗ trợ đổi trả nhé."]) {
      const r = gate.run(draft, src());
      assert.ok(r.trace.some((t) => t.startsWith("exchange_promise")), `${draft} → ${r.trace.join(",")}`);
      assert.doesNotMatch(r.reply, /đúng rồi|vâng ạ|có hỗ trợ đổi/i, draft);
      assert.match(r.reply, /kiểm tra chính sách/);
      assert.equal(r.needsHuman, true);
    }
  });

  test(`${pack}: hàng SẴN nhưng shop chưa khai chính sách đổi trả → câu hứa vẫn bị cắt (ô trống = an toàn, không mặc định "được đổi")`, () => {
    const r = gate.run("Dạ bên em có hỗ trợ đổi trả ạ.", src({ stockFacts: { stockType: "san", requestedSize: "", stock: null, price: 0, productCode: "", productName: "", variantsAvailable: [] } as never }));
    assert.ok(r.trace.some((t) => t.startsWith("exchange_promise_no_policy")), r.trace.join(","));
  });

  test(`${pack}: chính sách / hồ sơ shop có mục đổi trả → câu xác nhận được giữ`, () => {
    const r = gate.run("Dạ đúng rồi ạ.", src({ policy: "Đổi trả trong 3 ngày nếu còn nguyên tem." }));
    assert.ok(!r.trace.some((t) => t.startsWith("exchange_promise")), r.trace.join(","));
  });

  test(`${pack}: NGƯỜI TRỰC đã nói "có hỗ trợ đổi trả" → bot nhắc lại là lời shop thật, không cắt`, () => {
    const draft = "Dạ bên em có hỗ trợ đổi trả ạ.";
    const r = gate.run(draft, src({ shopSaid: "bên chị có hỗ trợ đổi trả trong 3 ngày nhé" }));
    assert.equal(r.reply, draft);
  });

  test(`${pack}: khách hỏi chuyện khác, nháp mở đầu "Dạ được ạ" → không bị coi là hứa đổi trả`, () => {
    const draft = "Dạ được ạ. Em gửi mẫu ngay ạ.";
    const r = gate.run(draft, src({ customerSaid: "gửi em xem mẫu với", customerMessage: "gửi em xem mẫu với" }));
    assert.equal(r.reply, draft);
  });

  test(`${pack}: sổ hội thoại cho agent có mẫu đang nói, giá đã báo, tồn đã trả lời`, () => {
    const ledger = new B.ConversationLedger(B.loadLedgerTexts());
    const state = ledger.update(undefined, {
      now: NOW.toISOString(), intentId: "ask_price",
      matched: { item: { code: "AB1234", name: "Mẫu A", price: 250000 }, reliable: true, stock: { requestedSize: "M", inStock: true } },
      customerMessage: "mẫu A size M giá sao"
    } as never);
    const text = ledger.render(state);
    assert.match(text, /AB1234 Mẫu A/);
    assert.match(text, /gia da bao: 250/);
    assert.match(text, /ton da tra loi/);
  });
}
