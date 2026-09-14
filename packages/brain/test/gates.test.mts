/**
 * Safety gates and number scanning: SILENCE BEATS A WRONG ANSWER.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { CONV, T0, TENANT, gateInput } from "./fixtures.mts";

test("BLOCK: a number with no source", () => {
  const g = B.runGates(gateInput({
    draft: "Dạ còn 5 đôi ạ",
    facts: [{ source: "stock.lookup", text: "con 3", numbers: [3] }]
  }));
  assert.equal(g.verdict.action, "block");
  assert.equal(g.verdict.rule, "no_unsourced_numbers");
});

test("BLOCK: a quantity written in words", () => {
  const g = B.runGates(gateInput({ draft: "Dạ còn ba đôi ạ" }));
  assert.equal(g.verdict.action, "block");
  assert.match(g.verdict.reason, /viet bang chu/);

  const g2 = B.runGates(gateInput({ draft: "Dạ còn vài đôi cuối ạ" }));
  assert.equal(g2.verdict.action, "block");
});

test("NOT BLOCKED: a price written for humans", () => {
  // "3,19 trieu" and "3190000" must count as the same number; otherwise the readable form is
  // blocked while the raw form passes, which pushes people to loosen the gate.
  const g = B.runGates(gateInput({
    draft: "Giá 3,19 triệu ạ",
    facts: [{ source: "stock.lookup", text: "gia", numbers: [3190000] }]
  }));
  assert.equal(g.verdict.action, "send", g.verdict.reason);
});

test("NOT BLOCKED: repeating the value the customer just gave", () => {
  const g = B.runGates(gateInput({ draft: "Dạ size 42 ạ", echoedValues: ["42"] }));
  assert.equal(g.verdict.action, "send");
});

test("BLOCK: policy claims without a source, in any phrasing", () => {
  for (const draft of [
    "Bên em đổi trả trong vòng bảy ngày ạ",
    "Bác cứ đổi size thoải mái nhé",
    "Ship bên em bác không phải trả thêm đồng nào"
  ]) {
    const g = B.runGates(gateInput({ draft }));
    assert.equal(g.verdict.action, "block", draft);
  }
});

test("NOT BLOCKED: an ordinary sales sentence containing 'đôi'", () => {
  const g = B.runGates(gateInput({
    draft: "Còn 7 đôi size 42, giá 3190000 ạ",
    facts: [{ source: "stock.lookup", text: "x", numbers: [7, 3190000] }],
    echoedValues: ["42"]
  }));
  assert.equal(g.verdict.action, "send", g.verdict.reason);
});

test("BLOCK: a forbidden phrase", () => {
  const g = B.runGates(gateInput({ draft: "Hàng này bảo hành trọn đời nhé bác" }));
  assert.equal(g.verdict.action, "block");
  assert.equal(g.verdict.rule, "forbidden_phrases");

  const g2 = B.runGates(gateInput({ draft: "Bên em rẻ nhất trên thị trường ạ" }));
  assert.equal(g2.verdict.action, "block");
});

test("times and dates are compared as whole tokens", () => {
  const g1 = B.runGates(gateInput({
    draft: "Dạ 14h30 còn chỗ ạ",
    facts: [{ source: "schedule", text: "khung 14h30 con cho", numbers: [] }]
  }));
  assert.equal(g1.verdict.action, "send", g1.verdict.reason);

  const g2 = B.runGates(gateInput({ draft: "Dạ 14h30 còn chỗ ạ" }));
  assert.equal(g2.verdict.action, "block", "The bot invented an appointment time.");
});

test("the preposition 'sau' is not read as the number six", () => {
  for (const draft of [
    "Bác quay lại sau buổi đầu tiên nhé",
    "Sau ngày lễ shop mở lại ạ",
    "Em nhắn lại sau giờ làm việc ạ"
  ]) {
    const g = B.runGates(gateInput({ draft }));
    assert.equal(g.verdict.action, "send", `${draft} -> ${g.verdict.reason}`);
  }
  const g = B.runGates(gateInput({ draft: "Dạ còn sáu đôi ạ" }));
  assert.equal(g.verdict.action, "block");
});

test("bot sentences WITHOUT diacritics are still caught", () => {
  // Merchants often type templates without diacritics; the gates must not go blind.
  const g1 = B.runGates(gateInput({ draft: "Ben em re nhat thi truong a" }));
  assert.equal(g1.verdict.action, "block", "A forbidden phrase without diacritics must still be blocked.");

  const g2 = B.runGates(gateInput({ draft: "Ben em doi tra trong vong 7 ngay a" }));
  assert.equal(g2.verdict.action, "block", "An unsourced policy claim without diacritics.");
});

test("a number the customer typed is NOT automatically a valid stock figure", () => {
  // Allowing EVERY number the customer typed would let "shop con 500 doi khong" license the bot
  // to assert "con 500 doi". Only slot values (size, strength) may be echoed.
  const g = B.runGates(gateInput({
    state: {
      tenant: TENANT, conversationId: CONV,
      turns: [{ role: "customer", text: "shop con 500 doi khong", at: T0.toISOString() }]
    },
    draft: "Dạ còn 500 đôi ạ",
    facts: [{ source: "stock.lookup", text: "con 3", numbers: [3] }],
    echoedValues: []
  }));
  assert.equal(g.verdict.action, "block", "A number the customer typed is used as a stock figure.");
});

test("punctuation in the middle does not let a forbidden phrase escape", () => {
  for (const draft of [
    "Giá tốt ạ, rẻ nhất - thị trường luôn ạ.",
    "Bên em bảo hành... trọn đời ạ.",
    "Rẻ nhất, thị trường luôn ạ."
  ]) {
    const g = B.runGates(gateInput({ draft }));
    assert.equal(g.verdict.action, "block", `${draft} -> ${g.verdict.reason}`);
  }
});

// ---------------------------------------------------------------- number scanning

test("the number gate READS formatted money", () => {
  // The weakest point when changing display: `normalize` turns `đ` into `d`, a letter after a
  // number makes the scanner back off, and "gia 3.190.000đ" read as 3190: unsourced, so the bot
  // blocked ITSELF and the customer got nothing.
  assert.deepEqual(B.numbersIn("giá 3.190.000đ"), [3190000]);
  assert.deepEqual(B.numbersIn("giá 25.000₫"), [25000]);
  assert.deepEqual(B.numbersIn("giá 3.190.000 VNĐ"), [3190000]);
  assert.deepEqual(B.numbersIn("Còn 7 đôi size 42, giá 3.190.000đ ạ."), [7, 42, 3190000]);
  assert.deepEqual(B.numbersIn("500k"), [500000]);
  assert.deepEqual(B.numbersIn("con 3 kieu"), [3]);
});

test("a money unit is not glued to the following word", () => {
  assert.deepEqual(B.numbersIn("con 3 kieu"), [3]);
  assert.deepEqual(B.numbersIn("o 2 kho"), [2]);
  assert.deepEqual(B.numbersIn("4 khach dat roi"), [4]);
  assert.deepEqual(B.numbersIn("gia 45k"), [45000]);
  assert.deepEqual(B.numbersIn("gia 3,190,000"), [3190000]);
});

test("common price spellings all yield the same number", () => {
  for (const s of ["3190000", "3.190.000", "3,19 trieu"]) {
    assert.ok(B.numbersIn(s).includes(3190000), `${s} -> ${B.numbersIn(s)}`);
  }
  assert.ok(B.numbersIn("2tr5").includes(2500000));
  assert.ok(B.numbersIn("3 ty").includes(3000000000));
});

test("money without diacritics (3.190.000d) and compound money (3tr190) read correctly", () => {
  assert.deepEqual(B.numbersIn("gia 3.190.000d"), [3190000]);
  assert.deepEqual(B.numbersIn("gia 25.000d/hop"), [25000]);
  assert.deepEqual(B.numbersIn("3tr190"), [3190000]);
  assert.deepEqual(B.numbersIn("2tr5"), [2500000]);
  assert.deepEqual(B.numbersIn("2tr50"), [2500000]);
  assert.deepEqual(B.numbersIn("2 doi 6.380.000d"), [2, 6380000]);
  assert.deepEqual(B.numbersIn("con 3 doi"), [3]);
  assert.deepEqual(B.numbersIn("hang ve 3 ngay"), [3]);
});

// ---------------------------------------------------------------- personal data

test("phone numbers are redacted however they are written", () => {
  const spellings = [
    "0968411655", "0968.411.655", "0968 411 655", "0968-411-655",
    "0968_411_655", "0968/411/655", "0968,411,655", "(0968) 411 655",
    "0968*411*655", "0968|411|655", "0968 - 411 - 655", "0968 . 411 . 655",
    "+84968411655", "84968411655", "0084968411655", "O968411655"
  ];
  for (const s of spellings) {
    const redacted = B.redactPII(`don cua em ${s} nhe`);
    assert.ok(!/\d{6}/.test(redacted), `Not redacted: "${s}" -> ${redacted}`);
  }
  assert.match(B.redactPII("mail em la a.b@gmail.com"), /\[da che\]/);
  assert.ok(B.findPIIInText("so em 0968411655").length > 0);
  assert.ok(B.findPIIInText("mail a.b@gmail.com").length > 0);
});

test("the stored-PII guard really throws", () => {
  assert.throws(() => B.assertNoStoredPII(["so em la 0968411655"]), /personal data/);
  assert.throws(() => B.assertNoStoredPII(["mail a.b@gmail.com"]), /personal data/);
  assert.doesNotThrow(() => B.assertNoStoredPII(["con size 42 khong"]));
});

test("the redactor and the detector are two different patterns", () => {
  // With one shared pattern, whatever the redactor misses the detector misses identically.
  assert.notEqual(B.redactPII.toString(), B.findPIIInText.toString());
  assert.ok(!/\d{6}/.test(B.redactPII("lien he 0968*411*655")));
});

test("order ids, product codes, size lists and prices are NOT redacted", () => {
  const untouched = [
    "Con size 40, 41, 42, 43, 44, 45 a",
    "Ma hang 8935001234567 a",
    "Don DH20250909001 dang giao a",
    "Gia 3190000 a",
    "Gia 3.190.000 a",
    "Ngay 09/09/2026 a",
    "Alo bac oi, don da giao a",
    "Ben em co zalo nhe"
  ];
  for (const s of untouched) {
    assert.equal(B.redactPII(s), s, `Wrongly redacted: ${s} -> ${B.redactPII(s)}`);
  }
});
