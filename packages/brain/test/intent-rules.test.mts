/**
 * The intent classifier: the sentences of DOI-CHIEU-BO-NAO-CU-MOI.md §1 must land where Sales Desk put them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import "./fixtures.mts";

const rules = B.loadIntentRules("giay-chay");
const classifier = new B.IntentClassifier(rules);
const router = B.ruleRouterFor("giay-chay");
const intentOf = (text: string): string => classifier.classify(text).intent;

test("the industry's keywords are joined onto tier 1's, per intent", () => {
  const complaint = rules.rules.find((r) => r.intent === "complaint_or_human");
  assert.ok(complaint);
  assert.ok(complaint.keywords.includes("khieu nai"), "tier 1's keyword");
  assert.ok(complaint.keywords.includes("bong keo"), "the industry's keyword");
  assert.equal(complaint.confidence, 0.96, "confidence kept from tier 1");
  assert.ok(rules.rules.some((r) => r.intent === "ask_size"), "an intent only the industry declares");
});

test("§1: 'tư vấn giúp mình vài mẫu cho nữ, size 40, chạy bộ nhẹ nhàng' → product_advice (after the entities, like Desk)", () => {
  const text = "tư vấn giúp mình vài mẫu cho nữ, size 40, chạy bộ nhẹ nhàng với";
  assert.equal(intentOf(text), "ask_size", "the keywords alone say size, as Desk's detectIntent does");
  const out = router.route({ message: text });
  assert.equal(out.intent.intent, "product_advice");
  assert.ok(out.intent.matched.includes("advice_request"));
  assert.equal(out.entities.size, "40");
  assert.equal(out.entities.gender, "Nữ");
});

test("§1: a QUESTION about the deposit is deposit_instruction, not a payment claim", () => {
  const v = classifier.classify("Có cách nào không chuyển khoản cọc vẫn mua được ko em");
  assert.equal(v.intent, "deposit_instruction");
  assert.ok(v.matched.includes("deposit_question_semantic"));
  assert.equal(intentOf("gio chuyen coc 300k la len don phai khong"), "deposit_instruction");
  assert.equal(classifier.depositQuestion("gio chuyen coc 300k la len don phai khong")?.amount, 300000);
});

test("§1: money ALREADY sent is payment_confirmation, goods sent is not", () => {
  const v = classifier.classify("da chuyen 500k vao stk cua shop");
  assert.equal(v.intent, "payment_confirmation", "'stk' must not pull it to asks_bank_info");
  assert.ok(v.matched.includes("paid_money_phrase"));
  assert.equal(intentOf("vua coc 300k roi nhe"), "payment_confirmation");
  assert.notEqual(intentOf("shop da chuyen hang chua"), "payment_confirmation");
  assert.equal(intentOf("cho minh xin stk"), "asks_bank_info");
});

test("§1: price, size, complaint, order, resell, authenticity, how-to", () => {
  assert.equal(intentOf("giày này giá bao nhiêu"), "ask_price");
  assert.equal(intentOf("còn size 42 không"), "ask_size");
  assert.equal(intentOf("shop giao sai size cho mình rồi"), "complaint_or_human");
  assert.equal(intentOf("đôi này bị bong keo sau 2 tuần"), "complaint_or_human");
  assert.equal(intentOf("ok shop toi lay mau nay"), "place_order", "small talk yields to the transactional intent");
  assert.ok(classifier.classify("ok shop toi lay mau nay").matched.includes("small_talk_demoted"));
  assert.equal(intentOf("shop co thu lai doi nay khong, minh muon pass"), "resell_offer");
  assert.equal(intentOf("hang chinh hang khong shop"), "authenticity");
  assert.equal(intentOf("dat hang tren web the nao"), "order_howto");
  assert.equal(intentOf("cam on shop nhe"), "small_talk");
});

test("a pure greeting, an icon-only message, and a greeting with content", () => {
  assert.equal(intentOf("chào shop"), "greeting");
  assert.equal(intentOf("👋"), "greeting");
  assert.equal(intentOf("shop oi co adios 9 khong a"), "unknown", "'khong' is not a keyword; the item name is for the catalog");
  assert.equal(classifier.classify("gui anh", { attachments: 1 }).intent, "send_image");
});

test("the payment frame: a claim, a dispute, a bank-account request", () => {
  const AT = "2026-09-24T09:00:00.000Z";
  const none = { intent: "unknown", confidence: 0.35, matched: [] };
  const claim = classifier.paymentFrame("minh ck 1.190.000 hom truoc roi ma", [], none);
  assert.equal(claim?.kind, "payment_claim");
  assert.equal(claim?.claimedAmount, 1190000);
  const dispute = classifier.paymentFrame("minh chuyen khoan roi sao shipper thu them 200k", [{ role: "customer", text: "sao shipper thu them 200k", at: AT }], none);
  assert.equal(dispute?.kind, "payment_dispute");
  assert.equal(dispute?.collectedAmount, 200000);
  assert.equal(classifier.paymentFrame("cho xin stk de minh ck", [], none), null, "asks for the account: not a claim");
  assert.equal(classifier.paymentFrame("da chuyen khoan roi", [], { intent: "payment_confirmation", confidence: 0.95, matched: [] }), null, "the keyword intent already says so");
});

test("money amounts: k, tr, tr+tenth, full", () => {
  assert.equal(B.moneyAmountInText("coc 500k"), 500000);
  assert.equal(B.moneyAmountInText("tam 1tr2"), 1200000);
  assert.equal(B.moneyAmountInText("1,5 trieu"), 1500000);
  assert.equal(B.moneyAmountInText("3.190.000d"), 3190000);
  assert.equal(B.moneyAmountInText("hom nay"), 0);
});
