/**
 * The rule router: Desk's decisions on real sentences, with the shop profile deciding which scripts exist.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { emptyShopProfile } from "@sp/contract";
import "./fixtures.mts";

const router = B.ruleRouterFor("giay-chay");
const AT = "2026-09-24T09:00:00.000Z";
const profile = (): ReturnType<typeof emptyShopProfile> => {
  const p = emptyShopProfile();
  p.xungHo = { khach: "bác", shop: "em" };
  return p;
};
const shop = { profile: profile(), site: "shop.example", tenShop: "Shop Mẫu" };

test("small talk with a request in it goes to the agent; plain thanks is a script", () => {
  // Replay #28: the thank-you must not swallow the request. The keywords already demote small talk
  // to "shipping"; a delivery-time question is the agent's, not the fee script's.
  const out = router.route({ message: "cam on nhe, luc nao ship bao truoc giup minh", ...shop });
  assert.equal(out.decision.kind, "agent_draft");
  assert.equal(out.decision.reason, "shipping_eta_question");
  assert.ok(out.localIntent.matched.includes("small_talk_demoted"));
  // The model called it small talk: the request in the message still keeps the script away.
  const ai = router.route({ message: "oke shop, con size 42 khong", aiIntent: { intent: "small_talk", confidence: 0.9, matched: [] }, ...shop });
  assert.notEqual(ai.decision.kind, "script_reply");
  assert.notEqual(ai.intent.intent, "small_talk", ai.intent.matched.join(","));
  const short = router.route({ message: "ok shop, gia nhe", aiIntent: { intent: "small_talk", confidence: 0.9, matched: [] }, ...shop });
  assert.ok(short.intent.matched.includes("small_talk_carries_request"), short.intent.matched.join(","));
  const thanks = router.route({ message: "cảm ơn shop nhé", ...shop });
  assert.equal(thanks.decision.kind, "script_reply");
  assert.match(thanks.decision.kind === "script_reply" ? thanks.decision.reply : "", /cảm ơn bác/);
  const sad = router.route({ message: "tiếc thật", ...shop });
  assert.equal(sad.decision.reason, "tiec_that");
});

test("'ok shop toi lay mau nay' is an order → the agent drafts (stock needed), not a thank-you script", () => {
  const out = router.route({ message: "ok shop toi lay mau nay", ...shop });
  assert.equal(out.intent.intent, "place_order");
  assert.equal(out.decision.kind, "agent_draft");
  assert.equal(out.decision.reason, "place_order_needs_catalog");
  assert.ok(out.entities.closingSignals.includes("lay"));
});

test("'ban oi' while the page has not answered is a nudge, not a second greeting", () => {
  const turns: B.RouterTurn[] = [
    { role: "shop", text: "Dạ em nghe ạ, bác đang tìm mẫu nào ạ?", at: AT },
    { role: "customer", text: "boston 13 con 42 khong", at: AT }
  ];
  const out = router.route({ message: "ban oi", turns, ...shop });
  assert.ok(out.intent.matched.includes("nudge_unanswered"));
  assert.equal(out.intent.intent, "unknown");
  assert.equal(out.decision.kind, "agent_draft");
  // The first greeting of a conversation is still scripted, and the model cannot flip it to small talk.
  const first = router.route({ message: "chào shop", aiIntent: { intent: "small_talk", confidence: 0.8, matched: [] }, ...shop });
  assert.equal(first.decision.kind, "script_reply");
  assert.ok(first.intent.matched.includes("local_greeting_wins"));
});

test("'da chuyen 500k' → the neutral acknowledgement, auto-sent, and a person is called", () => {
  const out = router.route({ message: "da chuyen 500k vao stk cua shop", ...shop });
  assert.equal(out.intent.intent, "payment_confirmation");
  assert.equal(out.paymentFrame, null, "the keyword detector already got it; the frame only steps in for disputes and misses");
  assert.equal(out.decision.kind, "human_handoff");
  assert.equal(out.decision.reason, "payment_ack");
  assert.equal(out.decision.kind === "human_handoff" && out.decision.safeToAutoSend, true);
  assert.match(out.decision.reply, /em đã nhận thông tin/);
  assert.doesNotMatch(out.decision.reply, /đã nhận (được )?tiền/, "the bot never says the money arrived");
  assert.ok(out.pipeline.includes("script_handoff"));
  // The model says "order" for it: the payment claim still wins.
  const ai = router.route({ message: "vua ck 300k roi nhe", aiIntent: { intent: "place_order", confidence: 0.9, matched: [] }, ...shop });
  assert.equal(ai.intent.intent, "payment_confirmation");
  // A claim the keywords miss ("ck hom truoc roi ma") is caught by the frame, same sentence, same handoff.
  const framed = router.route({ message: "minh ck 1.190.000 hom truoc roi ma", ...shop });
  assert.equal(framed.paymentFrame?.kind, "payment_claim");
  assert.equal(framed.decision.reason, "payment_ack");
  assert.ok(framed.pipeline.includes("payment_claim_resolver"));
});

test("a payment claim the model invented is demoted to the local intent", () => {
  const out = router.route({ message: "chi nhan giay roi nhe", aiIntent: { intent: "payment_confirmation", confidence: 0.9, matched: [] }, ...shop });
  assert.ok(out.intent.matched.includes("payment_claim_demoted"));
  assert.notEqual(out.intent.intent, "payment_confirmation");
});

test("authenticity: the script needs the shop's own promise; unset → the agent", () => {
  const unset = router.route({ message: "hàng chính hãng không shop", ...shop });
  assert.equal(unset.intent.intent, "authenticity");
  assert.equal(unset.decision.kind, "agent_draft");
  assert.equal(unset.decision.reason, "authenticity_profile_missing");
  const p = profile();
  p.camKetHang = "bên em cam kết hàng chính hãng, có tem và hoá đơn";
  const set = router.route({ message: "hàng chính hãng không shop", profile: p, site: shop.site });
  assert.equal(set.decision.kind, "script_reply");
  assert.match(set.decision.kind === "script_reply" ? set.decision.reply : "", /cam kết hàng chính hãng.*bác yên tâm/);
});

test("order_howto needs the site; the bank script needs the account", () => {
  const noSite = router.route({ message: "dat hang tren web the nao", profile: profile() });
  assert.equal(noSite.decision.reason, "order_howto_profile_missing");
  const withSite = router.route({ message: "dat hang tren web the nao", ...shop });
  assert.match(withSite.decision.kind === "script_reply" ? withSite.decision.reply : "", /shop\.example/);
  const noBank = router.route({ message: "cho xin stk", ...shop });
  assert.equal(noBank.decision.kind, "agent_draft");
  const bank = router.route({ message: "cho xin stk", ...shop, bank: { bankName: "Bank A", accountNumber: "0123456789", accountName: "NGUYEN VAN A" } });
  assert.equal(bank.decision.kind, "script_reply");
  assert.match(bank.decision.kind === "script_reply" ? bank.decision.reply : "", /Bank A - 0123456789 - NGUYEN VAN A/);
});

test("complaints, returns and resell offers call a person with a draft the agent may improve", () => {
  const complaint = router.route({ message: "shop giao sai size cho mình rồi", ...shop });
  assert.equal(complaint.decision.kind, "human_handoff");
  assert.equal(complaint.decision.kind === "human_handoff" && complaint.decision.safeToAutoSend, false);
  assert.match(complaint.decision.reply, /người phụ trách/);
  // 25/09/2026 (kb2-08): "shop cho đổi trả không" is a QUESTION about the policy → the agent with the policy tool, not a person.
  assert.equal(router.route({ message: "shop cho doi tra khong", ...shop }).decision.reason, "policy_question");
  assert.equal(router.route({ message: "hang bi loi, shop cho doi khong", ...shop }).decision.kind, "human_handoff", "goods in hand with a fault: a person");
  assert.equal(router.route({ message: "shop co thu lai khong, minh muon pass", ...shop }).decision.kind, "human_handoff");
});

test("shipping: the fee question is scripted, the delivery-time question is the agent's", () => {
  assert.equal(router.route({ message: "phi ship the nao shop", ...shop }).decision.kind, "script_reply");
  // "phi ship bao nhieu": "bao nhieu" is a price keyword and outranks "ship", exactly as in Desk → the catalog path.
  assert.equal(router.route({ message: "phi ship bao nhieu shop", ...shop }).intent.intent, "ask_price");
  const eta = router.route({ message: "ship bao lau thi toi", ...shop });
  assert.equal(eta.decision.kind, "agent_draft");
  assert.equal(eta.decision.reason, "shipping_eta_question");
});

test("kb2-08: a QUESTION about a policy is the agent's with the policy tool; a real return is a person's", () => {
  const ask = router.route({ message: "giày mua bên shop có bảo hành không", ...shop });
  assert.equal(ask.intent.intent, "policy_question");
  assert.equal(ask.decision.kind, "agent_draft");
  assert.equal(ask.decision.reason, "policy_question");
  assert.match(ask.decision.kind === "agent_draft" ? ask.decision.hint : "", /chinh_sach/);
  assert.equal(router.route({ message: "đổi size thế nào shop", ...shop }).intent.intent, "policy_question");
  const real = router.route({ message: "mình muốn trả lại đôi này", ...shop });
  assert.equal(real.decision.kind, "human_handoff");
  assert.equal(real.intent.intent, "return_exchange");
  // Changing the size of an ORDER already placed is neither: the order branch of the pipeline (kb2-07).
  const order = router.route({ message: "cho mình đổi sang size 43 được không, mình đặt hôm qua", ...shop });
  assert.equal(order.decision.kind, "agent_draft", order.decision.reason);
  // "cần đôi đua" is a pair, not an exchange.
  assert.notEqual(router.route({ message: "chạy HM pace 4:30, size 42, cần đôi đua, 3-4 triệu", ...shop }).intent.intent, "return_exchange");
});

test("kb2-20 / kb2-15: asking for the account is the bank script; impatience is the agent's with an apology opener", () => {
  const bank = router.route({ message: "gửi mình số tài khoản để chuyển cọc", ...shop, bank: { bankName: "Bank A", accountNumber: "0123456789", accountName: "NGUYEN VAN A" } });
  assert.equal(bank.intent.intent, "asks_bank_info", bank.intent.matched.join(","));
  assert.equal(bank.decision.kind, "script_reply");
  assert.match(bank.decision.kind === "script_reply" ? bank.decision.reply : "", /0123456789/);
  const late = router.route({ message: "trả lời chậm quá, có bán không thì bảo", ...shop });
  assert.equal(late.decision.kind, "agent_draft");
  assert.equal(late.decision.reason, "impatience");
  assert.match(late.decision.kind === "agent_draft" ? late.decision.hint : "", /xin lỗi bác chờ/);
  assert.equal(router.route({ message: "hàng lỗi, em muốn khiếu nại", ...shop }).decision.kind, "human_handoff", "a real complaint still goes to a person");
});

test("the deposit question and a policy question inside a size question go to the agent", () => {
  assert.equal(router.route({ message: "Có cách nào không chuyển khoản cọc vẫn mua được ko em", ...shop }).decision.reason, "deposit_instruction");
  const policy = router.route({ message: "neu lech thi cho doi size k", ...shop });
  assert.equal(policy.decision.kind, "agent_draft");
});

test("images: a receipt in a payment context is acknowledged and handed over; an unclear photo asks the size", () => {
  const turns: B.RouterTurn[] = [{ role: "shop", text: "Bác chuyển vào STK 19036789012 giúp em nhé", at: AT }];
  // 25/09/2026: the page's bank message alone proves nothing about the picture — a photo of a shoe
  // under it once became a "receipt". The photo reader's word, or the customer's, is what counts.
  const shoe = router.route({ message: "", attachments: 1, attachmentKinds: ["san_pham"], turns, ...shop });
  assert.equal(shoe.decision.kind, "agent_draft", "a product photo under a bank message is still a product photo");
  const unread = router.route({ message: "", attachments: 1, turns, ...shop });
  assert.equal(unread.decision.kind, "agent_draft", "an unread photo is not a receipt either");
  const receipt = router.route({ message: "", attachments: 1, attachmentKinds: ["bien_lai"], turns, ...shop });
  assert.equal(receipt.decision.kind, "human_handoff");
  assert.equal(receipt.decision.reason, "payment_receipt_image");
  assert.equal(receipt.decision.kind === "human_handoff" && receipt.decision.safeToAutoSend, true);
  const said = router.route({ message: "em gửi nhé", attachments: 1, ...shop });
  assert.equal(said.decision.reason, "payment_receipt_image", "the customer says they sent it, with the photo");
  const photo = router.route({ message: "", attachments: 1, ...shop });
  assert.equal(photo.decision.kind, "agent_draft");
  assert.match(photo.decision.kind === "agent_draft" ? photo.decision.hint : "", /size bao nhiêu/);
  const asks = router.route({ message: "cho chi xin them hinh sp", ...shop });
  assert.ok(asks.intent.matched.includes("customer_requests_photos"));
});

test("the frame: '42' after the page asked the size is a stock question; 'ok' after the bank account is a bank ack", () => {
  const builder = new B.DialogueFrameBuilder(B.loadDialogueConfig("giay-chay"));
  const lexicon: B.FrameLexicon = { products: [{ code: "JP9252", name: "Adizero Boston 13" }] };
  const askedSize: B.Turn[] = [{ role: "shop", text: "bác đi size bao nhiêu ạ?", at: AT }];
  const f1 = builder.build({ message: "42", turns: askedSize, lexicon });
  const out = router.route({ message: "42", turns: askedSize, frame: f1, ...shop });
  assert.equal(out.intent.intent, "ask_size");
  assert.ok(out.pipeline.includes("frame_answered_size"));
  const gaveBank: B.Turn[] = [{ role: "shop", text: "Bác chuyển khoản vào STK 19036789012 Techcombank giúp em nhé", at: AT }];
  const f2 = builder.build({ message: "ok", turns: gaveBank, lexicon });
  const ack = router.route({ message: "ok", turns: gaveBank, frame: f2, ...shop });
  assert.equal(ack.decision.reason, "bank_ack");
  assert.equal(ack.decision.kind, "script_reply");
});

test("after a person confirmed payment, 'hang ve gui dia chi nay' is not a new order", () => {
  const turns: B.RouterTurn[] = [{ role: "shop", text: "em nhận được thông tin thanh toán rồi ạ", at: AT, byPerson: true }];
  const out = router.route({ message: "hang ve gui dia chi nay ho e, len don giup", turns, ...shop });
  assert.ok(out.intent.matched.includes("post_payment_continuation"));
  // The same sentence from the BOT is no proof: the order still counts as new.
  const botOnly = router.route({ message: "hang ve gui dia chi nay ho e, len don giup", turns: [{ ...turns[0]!, byPerson: false }], ...shop });
  assert.ok(!botOnly.intent.matched.includes("post_payment_continuation"));
});

test("the trace names every step", () => {
  const out = router.route({ message: "chào shop", ...shop });
  assert.deepEqual(out.pipeline.slice(0, 2), ["intent_rules", "entities"]);
  assert.ok(out.pipeline.includes("bot_script"));
  assert.ok(out.pipeline.includes("script_reply"));
});
