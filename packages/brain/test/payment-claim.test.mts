/**
 * Desk `payment_claim_kit.js` as data: the bot never says the money arrived.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import "./fixtures.mts";

const cfg = B.loadReplyGateConfig("giay-chay").payment;
const kit = new B.PaymentClaimKit(cfg);

test("isPaymentReceivedClaim: claims, negations, refunds, the customer receiving, questions", () => {
  assert.equal(B.isPaymentReceivedClaim("Dạ em đã nhận được 690k của bác rồi ạ.", cfg), true);
  assert.equal(B.isPaymentReceivedClaim("Dạ e nhận dc ck r nhé.", cfg), true, "chat shorthand is opened");
  assert.equal(B.isPaymentReceivedClaim("Tiền bác chuyển đã vào tài khoản shop rồi ạ.", cfg), true);
  assert.equal(B.isPaymentReceivedClaim("Chuyển khoản thành công rồi ạ.", cfg), true);
  assert.equal(B.isPaymentReceivedClaim("Dạ em chưa nhận được tiền ạ.", cfg), false, "negated");
  assert.equal(B.isPaymentReceivedClaim("Nhận CK rồi mới đặt hàng bác nhé.", cfg), false, "a procedure, not a claim");
  assert.equal(B.isPaymentReceivedClaim("Tiền hoàn em đã chuyển lại bác rồi ạ.", cfg), false, "a refund");
  assert.equal(B.isPaymentReceivedClaim("Bác đã nhận được hàng chưa ạ?", cfg), false, "a question");
  assert.equal(B.isPaymentReceivedClaim("Bác đã nhận tiền thừa em gửi chưa ạ.", cfg), false, "the customer receives");
});

test("a short affirmation counts only when the customer just asked about the money", () => {
  assert.equal(kit.customerAsksPaymentReceived("shop nhận được tiền chưa"), true);
  assert.equal(kit.customerAsksPaymentReceived("em ck rồi nhé"), true);
  assert.equal(kit.customerAsksPaymentReceived("còn size 42 không"), false);
  assert.equal(kit.shortAffirmation("Dạ nhận rồi ạ."), true);
  assert.equal(kit.shortAffirmation("Dạ vâng ạ."), true);
  assert.equal(kit.shortAffirmation("Dạ để em kiểm tra ạ."), false);
  assert.equal(B.isPaymentReceivedClaim("Dạ nhận rồi ạ.", cfg, "shop nhận được tiền chưa"), true);
  assert.equal(B.isPaymentReceivedClaim("Dạ nhận rồi ạ.", cfg, "còn size 42 không"), false);
});

test("stripPaymentReceivedClaims: the neutral sentence first, order actions built on the money dropped, the rest kept", () => {
  const out = B.stripPaymentReceivedClaims("Dạ em đã nhận được tiền rồi ạ. Em lên đơn cho bác ngay. Bác cho em xin địa chỉ nhận hàng nhé.", cfg, { pronoun: "bác" });
  assert.equal(out.changed, true);
  assert.equal(out.reply, "Dạ em đã nhận thông tin, em báo người phụ trách đối chiếu và báo lại bác ngay ạ. Bác cho em xin địa chỉ nhận hàng nhé.");
  assert.equal(B.stripPaymentReceivedClaims("Dạ để em kiểm tra ạ.", cfg).changed, false);
});

test("paymentPendingText: the shop's text is used unless it itself claims money; {khach} / {xung} filled", () => {
  const neutral = "Dạ em đã nhận thông tin, em báo người phụ trách đối chiếu và báo lại anh ngay ạ.";
  assert.equal(B.paymentPendingText({ neutral: cfg.pendingText }, "anh", cfg), neutral);
  assert.match(B.paymentPendingText({ neutral: cfg.pendingText, vars: { tenNguoiPhuTrach: "anh Dũng" } }, "anh", cfg), /báo anh Dũng đối chiếu và báo lại anh ngay/);
  assert.equal(B.paymentPendingText({ neutral: cfg.pendingText, shopText: "Dạ {Khach} chờ em đối chiếu chút ạ." }, "chị", cfg), "Dạ Chị chờ em đối chiếu chút ạ.");
  assert.equal(B.paymentPendingText({ neutral: cfg.pendingText, shopText: "{Xung} ơi em nhận tiền rồi ạ." }, "chị", cfg), neutral.replace("lại anh", "lại chị"), "a shop text that claims money falls back to the neutral one");
});
