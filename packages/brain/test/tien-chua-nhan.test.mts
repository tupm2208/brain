/**
 * 05/10/2026 — phiếu Desk "bot tự nói 'đã nhận được tiền chuyển khoản' khi chưa nhận đồng nào". Bảng Ca
 * kiểm của phiếu ở tầng bộ não thuần: bộ định tuyến không coi sticker / câu mẫu web / câu hỏi là tiền đã
 * về; cổng soát cắt mọi câu "đã nhận tiền" và cả câu "tiền khách đã chuyển" khi không có bằng chứng
 * (lời NGƯỜI TRỰC hoặc đơn gắn chắc có số đã trả). Thử cả ngành khác (nhà thuốc): đây là luật tầng 1.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import "./fixtures.mts";

const AT = "2026-09-22T07:00:00.000Z";
const shop = { site: "shop.example", tenShop: "Shop Mẫu" };
const askedDeposit = { role: "shop" as const, text: "Dạ hàng order bác đặt cọc trước giúp em nhé", at: AT };
const NEUTRAL = "Dạ em đã nhận thông tin, em báo người phụ trách đối chiếu và báo lại bác ngay ạ.";

for (const pack of ["giay-chay", "nha-thuoc"]) {
  test(`${pack}: sticker / ảnh không phải biên lai sau câu 'đặt cọc' → không câu nhận tiền, không gọi người vì biên lai`, () => {
    const router = B.ruleRouterFor(pack);
    for (const input of [
      { message: "", attachments: 1, attachmentKinds: ["khac"] },
      { message: "", attachments: 1 },
      { message: "(y)" }
    ]) {
      const out = router.route({ ...input, turns: [askedDeposit], ...shop });
      assert.notEqual(out.decision.reason, "payment_receipt_image", JSON.stringify(input));
      assert.notEqual(out.decision.reason, "payment_ack", JSON.stringify(input));
      assert.doesNotMatch(out.decision.kind === "agent_draft" || out.decision.kind === "silent" ? out.decision.reason : out.decision.reply, /đã nhận được tiền|nhận được chuyển khoản/);
    }
  });

  test(`${pack}: câu mẫu web 'Em đã đặt đơn…, mã CK…' → câu TRUNG TÍNH; 'Không chuyển khoản cọc vẫn mua được không' là câu hỏi`, () => {
    const router = B.ruleRouterFor(pack);
    const web = router.route({ message: "Em đã đặt đơn ORD-1790226471756 trên web, mã CK ABC123", turns: [askedDeposit], ...shop });
    if (web.decision.kind === "human_handoff" || web.decision.kind === "script_reply") {
      assert.doesNotMatch(web.decision.reply, /đã nhận (được )?(tiền|chuyển khoản|cọc)/);
    }
    const q = router.route({ message: "Không chuyển khoản cọc vẫn mua được không em", turns: [askedDeposit], ...shop });
    assert.notEqual(q.intent.intent, "payment_confirmation");
    assert.notEqual(q.decision.kind, "human_handoff");
  });

  test(`${pack}: cổng soát — 'đã nhận tiền' luôn bị cắt; 'tiền khách đã chuyển' bị cắt khi không có bằng chứng`, () => {
    const gate = new B.ReplyGate(B.loadReplyGateConfig(pack));
    const src = { shopSaid: "", customerSaid: "", customerMessage: "ok", policy: "", hoSo: null, found: [], stockFacts: null, lookups: { orderLooked: false }, links: {}, pronoun: "bác", uncertainProduct: false, site: "shop.example", tenShop: "Shop" };
    const received = gate.run("Dạ em đã nhận được tiền cọc ạ.", src);
    assert.equal(received.reply, NEUTRAL);
    assert.equal(received.needsHuman, true);
    for (const draft of ["Tiền cọc mình đã chuyển sẽ được trừ vào tổng đơn ạ.", "Dạ khoản cọc bác đã chuyển em ghi nhận rồi ạ."]) {
      const r = gate.run(draft, src);
      assert.ok(r.trace.includes("customer_paid_unverified"), `${draft}: ${r.trace.join(",")}`);
      assert.equal(r.reply, NEUTRAL);
      assert.equal(r.needsHuman, true);
      // Evidence: the linked order carries a paid amount, or a PERSON on duty said the money came.
      assert.equal(gate.run(draft, { ...src, paidEvidence: true }).trace.includes("customer_paid_unverified"), false);
      assert.equal(gate.run(draft, { ...src, shopSaid: "shop đã nhận được chuyển khoản cọc của bác rồi nhé" }).trace.includes("customer_paid_unverified"), false);
    }
    // Not claims: a question, a condition, an instruction.
    for (const ok of ["Dạ bác đã chuyển khoản chưa ạ?", "Dạ bác đã chuyển khoản chưa ạ", "Dạ khi bác đã chuyển khoản xong thì nhắn em nhé.", "Dạ bác chuyển khoản xong nhắn em để em lên đơn nhé.", "Dạ hàng order khi khách đã cọc thì không huỷ được ạ."]) {
      assert.equal(gate.run(ok, src).trace.includes("customer_paid_unverified"), false, ok);
    }
  });
}
