/**
 * 05/10/2026 — phiếu Desk 2026-09-13 "bot tự xác nhận 'đúng màu' thay khách", phần BỘ ĐỊNH TUYẾN (luật anh
 * chốt 15/09): khách phản bác mẫu / màu bot vừa đưa TRƯỚC khi có hàng → lần 1 câu trung tính + gọi người;
 * lần 2 (đã phản bác một lần và page đã trả lời) → gọi người + DỪNG bot hội thoại đó (`pauseBot`); sau khi
 * đã nhận hàng thì "không đúng màu" vẫn là khiếu nại. Chạy cả gói giày (tầng 2) và nhà thuốc (chỉ tầng 1).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { emptyShopProfile, type LinkedOrderBrief } from "@sp/contract";
import "./fixtures.mts";

const AT = "2026-09-13T09:00:00.000Z";
const shop = { profile: (() => { const p = emptyShopProfile(); p.xungHo = { khach: "bác", shop: "em" }; return p; })(), site: "shop.example", tenShop: "Shop Mẫu" };
const botShowed = { role: "shop" as const, text: "Dạ mẫu HQ8708 bên em còn size 42 ạ, bác xem ảnh mẫu nhé.", at: AT };

for (const pack of ["giay-chay", "nha-thuoc"]) {
  const router = B.ruleRouterFor(pack);

  test(`${pack}: phản bác lần 1 ("không phải màu này shop") → câu trung tính tự gửi + gọi người, KHÔNG dừng bot`, () => {
    for (const message of ["không phải màu này shop", "k phải mẫu này đâu", "sai màu rồi shop ơi", "Màu này chứ shop", "không giống ảnh mình gửi"]) {
      const out = router.route({ message, turns: [{ role: "customer", text: "[ảnh]", at: AT }, botShowed], ...shop });
      assert.equal(out.decision.kind, "human_handoff", `${message}: ${out.decision.kind} ${out.decision.reason}`);
      if (out.decision.kind !== "human_handoff") continue;
      assert.equal(out.decision.reason, "product_rejected", message);
      assert.equal(out.decision.safeToAutoSend, true);
      assert.notEqual(out.decision.pauseBot, true);
      assert.doesNotMatch(out.decision.reply, /đúng (màu|mẫu) rồi|chuẩn|yên tâm/);
      assert.match(out.decision.reply, /người phụ trách/);
    }
  });

  test(`${pack}: phản bác lần 2 trong cùng hội thoại → gọi người + DỪNG bot (pauseBot)`, () => {
    const turns = [botShowed, { role: "customer" as const, text: "không phải màu này shop", at: AT }, { role: "shop" as const, text: "Dạ em xin lỗi bác, em báo người phụ trách kiểm tra lại ạ.", at: AT }];
    const out = router.route({ message: "vẫn sai màu mà shop", turns, ...shop });
    assert.equal(out.decision.kind, "human_handoff");
    if (out.decision.kind !== "human_handoff") return;
    assert.equal(out.decision.reason, "product_rejected_again");
    assert.equal(out.decision.pauseBot, true);
    // Two messages of ONE burst (no page answer between) are still the first time.
    const burst = router.route({ message: "sai màu rồi", turns: [botShowed, { role: "customer", text: "không phải màu này shop", at: AT }], ...shop });
    assert.equal(burst.decision.kind === "human_handoff" ? burst.decision.pauseBot : undefined, undefined);
  });

  test(`${pack}: "không đúng màu" SAU KHI đã nhận hàng → vẫn là khiếu nại, không phải phản bác`, () => {
    const words = router.route({ message: "nhận hàng rồi mà không đúng màu shop ơi", turns: [botShowed], ...shop });
    assert.equal(words.decision.kind, "human_handoff");
    assert.notEqual(words.decision.reason, "product_rejected");
    assert.equal(words.intent.intent, "complaint_or_human");
    const delivered: LinkedOrderBrief = { maDon: "DH1", giaiDoan: "da_ket_thuc", ketThuc: "da_giao", vanDonDong: false, taoLuc: AT, mon: [], tien: { tong: 0, daTra: 0, conLai: 0 } };
    const byOrder = router.route({ message: "không đúng màu shop ơi", turns: [botShowed], orders: [delivered], ...shop });
    assert.notEqual(byOrder.decision.reason, "product_rejected");
    assert.equal(byOrder.decision.kind, "human_handoff");
  });

  test(`${pack}: câu không phải phản bác → không đụng`, () => {
    for (const message of ["mẫu này còn màu khác không shop", "không phải hàng order à shop", "có màu đen không ạ"]) {
      const out = router.route({ message, turns: [botShowed], ...shop });
      assert.ok(!out.pipeline.includes("product_rejected"), `${message}: ${out.pipeline.join(" › ")}`);
    }
  });
}

test("giay-chay: từ của ngành ('không phải đôi này') cũng là phản bác; câu tầng 2 nói 'mẫu và màu'", () => {
  const out = B.ruleRouterFor("giay-chay").route({ message: "không phải đôi này shop ơi", turns: [botShowed], ...shop });
  assert.equal(out.decision.reason, "product_rejected");
  assert.match(out.decision.kind === "human_handoff" ? out.decision.reply : "", /đúng mẫu và đúng màu/);
});
