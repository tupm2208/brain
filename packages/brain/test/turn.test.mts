/**
 * Turn engine behaviour: everything learned from real conversations, one test per lesson.
 * Each section header names the review round that produced it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import type { CatalogItemLite, ItemId } from "@sp/contract";
import { ask, BOSTON, clonePack, CONV, fakePorts, PARA, pharmacyPack, pharmacyRow as HL, row, runningShoesPack, T0, TENANT } from "./fixtures.mts";

const minutes = (n: number): Date => new Date(T0.getTime() + n * 60_000);
const hours = (n: number): Date => new Date(T0.getTime() + n * 3600_000);
const itemLite = (id: string, code: string, name: string, brand: string, priceFrom: number, variantCount: number): CatalogItemLite =>
  ({ id: id as ItemId, code, name, brand, priceFrom, variantCount });

// ===========================================================================
// A normal turn
// ===========================================================================

test("recognises the item and answers with real stock", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong shop");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.equal(r.itemCode, "IE0000");
  assert.equal(r.slots["size"], "42");
  assert.match(r.reply, /Còn 3 đôi size 42/);
  assert.ok(r.facts.length > 0);
});

test("a long polite sentence still identifies the item", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "cho em hoi doi adizero boston 13 nay con size 42 khong shop oi");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.equal(r.itemCode, "IE0000");
});

test("out of stock is said plainly, and that sentence carries no number", async () => {
  const f = fakePorts({ rows: [row("43", 5)] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send");
  assert.match(r.reply, /hết size/);
  assert.deepEqual(B.numbersIn(r.reply), []);
});

// ===========================================================================
// Three serious bugs found in review
// ===========================================================================

test("S1: the customer writes '41 ruoi', the warehouse '41.5': they must meet", async () => {
  const f = fakePorts({ rows: [row("41.5", 7)] });
  const r = await ask(f.ports, "adizero boston 13 con 41 ruoi khong");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /Còn 7 đôi/);
  assert.ok(!/hết/.test(r.reply), "The shelf has 7 pairs and the bot said out of stock.");
});

test("S2: stock in two warehouses sums with a traceable source", async () => {
  const f = fakePorts({ rows: [row("42", 3, "w1", "Kho nha"), row("42", 4, "w2", "Kho doi tac")] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send", "Two warehouses made the bot give up: " + JSON.stringify(r.gates));
  assert.match(r.reply, /Còn 7 đôi/);
});

test("S3: a customer answering exactly what the bot asked must be served", async () => {
  const f = fakePorts();
  const r1 = await ask(f.ports, "con size 42 khong shop");
  assert.equal(r1.action, "ask_back");

  f.setNow(new Date(T0.getTime() + 90_000));
  const r2 = await ask(f.ports, "adizero boston 13 nhe");
  assert.equal(r2.action, "send", "The customer answered correctly and was pushed to a human.");
  assert.equal(r2.itemCode, "IE0000");
  assert.match(r2.reply, /Còn 3 đôi size 42/);
});

// ===========================================================================
// Safety gates in context
// ===========================================================================

test("unknown item: ask back, never guess", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "con size 42 khong shop");
  assert.equal(r.action, "ask_back");
  assert.match(r.reply, /xin mã hoặc tên mẫu/);
  assert.ok(!f.calls.some((c) => c.tool === "stock.lookup"));
});

test("a second ask-back still lacking information hands off", async () => {
  const f = fakePorts();
  await ask(f.ports, "con size 42 khong shop");
  f.setNow(minutes(5));
  const r = await ask(f.ports, "co khong shop oi");
  assert.equal(r.action, "handoff");
  assert.ok(r.gates.some((g) => g.rule === "ask_back_once"));
});

test("after a handoff the bot does not jump back in", async () => {
  const f = fakePorts();
  await ask(f.ports, "con size 42 khong shop");
  f.setNow(minutes(5));
  await ask(f.ports, "co khong shop oi");
  f.setNow(minutes(40));
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "handoff", "Handed to a human, yet the bot kept answering.");
});

test("offline: no factual claims", async () => {
  const f = fakePorts({ online: false });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send");
  assert.match(r.reply, /kiểm lại hàng/);
  assert.deepEqual(B.numbersIn(r.reply), []);
  assert.equal(f.calls.length, 0);
});

test("'we do not carry brand X' only with a large enough catalog", async () => {
  const big = fakePorts({ catalogSize: 1200, items: [] });
  const r1 = await ask(big.ports, "shop co ban salomon khong");
  assert.equal(r1.action, "send");
  assert.match(r1.reply, /chưa kinh doanh hàng salomon/);

  const small = fakePorts({ catalogSize: 12, items: [] });
  const r2 = await ask(small.ports, "shop co ban salomon khong");
  assert.equal(r2.action, "ask_back");
  assert.ok(r2.gates.some((g) => g.rule === "brand_not_carried_needs_catalog"));
});

test("comparing with another brand still answers the real question", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "so voi salomon thi adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /Còn 3 đôi/, "The bot dropped the stock question to talk about another brand.");
});

test("every gate verdict carries a traceable reason", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "con size 42 khong shop");
  assert.ok(Array.isArray(r.gates));
  assert.ok(r.gates.every((g) => typeof g.reason === "string" && g.reason.length > 0));
});

// ===========================================================================
// Memory
// ===========================================================================

test("remembers the item within an episode, forgets after six hours", async () => {
  const f = fakePorts();
  const r1 = await ask(f.ports, "adizero boston 13 gia bao nhieu");
  assert.equal(r1.itemCode, "IE0000");

  f.setNow(minutes(20));
  const r2 = await ask(f.ports, "con size 42 khong");
  assert.equal(r2.itemCode, "IE0000");
  assert.equal(r2.action, "send", JSON.stringify(r2.gates));

  f.setNow(hours(7));
  const r3 = await ask(f.ports, "con size 42 khong");
  assert.equal(r3.itemCode, null, "A new episode still clings to the old item.");
  assert.equal(r3.action, "ask_back");
});

test("a terse message right after the bot's question is read as the answer", async () => {
  const f = fakePorts();
  const r1 = await ask(f.ports, "adizero boston 13 con hang khong");
  assert.equal(r1.action, "ask_back", "Missing size must ask for the size.");
  assert.equal(r1.state.lastAskedSlot, "size");

  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "42");
  assert.equal(r2.action, "send", "The terse '42' was read as a new conversation.");
  assert.match(r2.reply, /Còn 3 đôi size 42/);
});

test("a customer who sent a photo is asked for the model name, not another photo", async () => {
  const withImage = fakePorts();
  assert.equal(await withImage.ports.memory.load(TENANT, CONV), null);
  const a = await ask(withImage.ports, "doi nay con 42 ko", { imageCount: 1 });
  assert.equal(a.action, "ask_back");
  assert.match(a.reply, /xem ảnh rồi/, "The customer just sent a photo and the bot asked generically.");

  // The same sentence WITHOUT a photo must yield a different reply, otherwise the photo evidence
  // branch is dead code (as review pointed out in an earlier version).
  const without = fakePorts();
  const b = await ask(without.ports, "doi nay con 42 ko");
  assert.equal(b.action, "ask_back");
  assert.notEqual(b.reply, a.reply);
  assert.ok(!/xem ảnh rồi/.test(b.reply));
});

test("order lookup: ask for the phone number, then answer once it is given", async () => {
  const f = fakePorts({
    orders: [{ orderId: "MAN-1", status: "đang giao", createdAt: T0.toISOString(),
               money: { total: 3190000, paid: 3190000, remaining: 0, cod: 0 }, lines: [] }]
  });
  const r1 = await ask(f.ports, "don hang cua em toi dau roi");
  assert.equal(r1.action, "ask_back");
  assert.match(r1.reply, /số điện thoại/);

  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "0968411655");
  assert.equal(r2.action, "send", JSON.stringify(r2.gates));
  assert.match(r2.reply, /đang giao/);
});

// ===========================================================================
// Mutation killers: one line each that broke silently before
// ===========================================================================

test("warehouse labels in other spellings still meet the customer's value", async () => {
  const cases: [string, string, number][] = [
    ["adizero boston 13 con 41 ruoi khong", "41.5", 7],
    ["adizero boston 13 con 41.5 khong", "41 ruoi", 7],
    ["adizero boston 13 con 42,5 khong", "42.5", 4],
    ["adizero boston 13 con size 42 khong", "EU 42", 9]
  ];
  for (const [question, label, qty] of cases) {
    const f = fakePorts({ rows: [row(label, qty)] });
    const r = await ask(f.ports, question);
    assert.equal(r.action, "send", `${question} / warehouse "${label}": ${JSON.stringify(r.gates)}`);
    assert.match(r.reply, new RegExp(`Còn ${qty} đôi`), `${question} / warehouse "${label}" -> ${r.reply}`);
  }
});

test("asking size 42 when only 42.5 exists reports out of stock", async () => {
  const f = fakePorts({ rows: [row("42.5", 7)] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send");
  assert.match(r.reply, /hết/, "42.5 was treated as 42.");
});

test("unknown size with several sizes on the shelf: NEVER sum and label", async () => {
  // The worst bug of round two: "Con 5 doi size 42" while size 42 had 0. Every number had a
  // source, so no gate could catch it; it must be stopped where the sentence is built.
  const f = fakePorts({ rows: [row("42", 0), row("43", 5)] });
  const r = await ask(f.ports, "adizero boston 13 gia bao nhieu");
  assert.notEqual(r.action, "send", `The bot just asserted wrong stock: ${r.reply}`);
  assert.ok(!/size 42/.test(r.reply));
});

test("several prices: quote the range, not one warehouse's price", async () => {
  const f = fakePorts({
    rows: [row("42", 3, "w1", "Kho nha", 3190000), row("42", 4, "w2", "Kho doi tac", 3590000)]
  });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /Còn 7 đôi/);
  assert.match(r.reply, /3\.190\.000đ.*3\.590\.000đ/, `One warehouse's price quoted while two differ: ${r.reply}`);
});

test("money for customers uses the Vietnamese format, not a raw digit string", async () => {
  const f = fakePorts({ rows: [row("42", 3, "w1", "Kho nha", 3190000)] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.match(r.reply, /giá 3\.190\.000đ/, `Raw money sent to the customer: ${r.reply}`);
  assert.ok(!/3190000/.test(r.reply), "A raw digit string reached the customer.");
});

test("the reply and its evidence agree AFTER formatting", async () => {
  const f = fakePorts({ rows: [row("42", 3, "w1", "Kho nha", 3190000)] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  const sources = new Set(r.facts.flatMap((x) => x.numbers));
  for (const n of B.numbersIn(r.reply)) {
    assert.ok(sources.has(n), `Number ${n} in the reply has no evidence: ${r.reply}`);
  }
});

test("loop: small catalog + unknown brand must hand off eventually", async () => {
  const f = fakePorts({ catalogSize: 12, items: [] });
  const r1 = await ask(f.ports, "shop co ban salomon khong");
  assert.equal(r1.action, "ask_back");
  f.setNow(minutes(3));
  const r2 = await ask(f.ports, "shop co ban salomon khong a");
  assert.equal(r2.action, "handoff", "The bot loops on one question and never calls a human.");
});

test("the old focus must not answer for the item the customer just asked about", async () => {
  const f = fakePorts();
  const r1 = await ask(f.ports, "adizero boston 13 gia bao nhieu");
  assert.equal(r1.itemCode, "IE0000");

  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "con salomon speedcross size 42 khong");
  assert.notEqual(r2.itemCode, "IE0000", "adidas stock answered to a Salomon question.");
  assert.ok(!/Còn 3 đôi/.test(r2.reply), r2.reply);
});

test("two similar models: no guessing", async () => {
  const BOSTON12 = itemLite("i2", "IE0001", "Adizero Boston 12", "adidas", 2890000, 8);
  const clear = fakePorts({ items: [BOSTON, BOSTON12] });
  const r1 = await ask(clear.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r1.itemCode, "IE0000", "The model was named explicitly and still not chosen.");

  const vague = fakePorts({ items: [BOSTON, BOSTON12] });
  const r2 = await ask(vague.ports, "boston con size 42 khong");
  assert.equal(r2.action, "ask_back", "Two Bostons and the bot picked one.");
});

test("a failing tool is admitted, without re-asking what is already known", async () => {
  const f = fakePorts({ stockFails: true });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.itemCode, "IE0000");
  assert.match(r.reply, /chưa tra được kho/, `Code known, yet asked for the code: ${r.reply}`);
});

test("a fetched policy reaches the customer", async () => {
  const f = fakePorts({ policy: "Đổi size trong 7 ngày, còn nguyên tem mác." });
  const r = await ask(f.ports, "shop cho doi size khong a");
  assert.equal(r.intentId, "doi_tra");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /Đổi size trong 7 ngày/);
});

test("one blocked sentence does not mute the whole episode", async () => {
  const bad = clonePack(runningShoesPack);
  bad.intents = bad.intents.map((i) => i.id === "hoi_gia" ? { ...i, template: "Giá 999999 ạ." } : i);
  const f = fakePorts();

  const r1 = await B.handleTurn(bad, f.ports, { tenant: TENANT, conversationId: CONV, text: "adizero boston 13 gia bao nhieu" });
  assert.equal(r1.action, "handoff");
  assert.ok(r1.gates.some((g) => g.rule === "no_unsourced_numbers"));
  assert.notEqual(r1.state.handedOff, true, "One blocked sentence locked the episode.");

  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r2.action, "send", "The bot went mute because one sentence was blocked.");
});

test("a new episode clears the handed-off flag", async () => {
  const f = fakePorts();
  await ask(f.ports, "con size 42 khong shop");
  f.setNow(minutes(5));
  const r2 = await ask(f.ports, "co khong shop oi");
  assert.equal(r2.action, "handoff");

  f.setNow(hours(8));
  const r3 = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r3.action, "send", "A new episode and the bot is still mute.");
});

test("an episode survives a five-hour gap", async () => {
  const f = fakePorts();
  await ask(f.ports, "adizero boston 13 gia bao nhieu");
  f.setNow(hours(5));
  const r = await ask(f.ports, "con size 42 khong");
  assert.equal(r.itemCode, "IE0000", "Forgot the item after only five hours.");
});

test("a ten-digit order id is not read as a phone number", async () => {
  const f = fakePorts({
    orders: [{ orderId: "MAN-1", status: "đang giao", createdAt: T0.toISOString(), money: { total: 100, paid: 100, remaining: 0, cod: 0 }, lines: [] }]
  });
  const r = await ask(f.ports, "don hang cua em ma 1234567890 toi dau roi");
  assert.equal(r.slots["phone"], undefined, "A number not starting with 0 was taken for a phone number.");
});

test("a template with an empty placeholder is never sent", async () => {
  const pack = clonePack(runningShoesPack);
  pack.intents = pack.intents.map((i) => i.id === "hoi_gia" ? { ...i, template: "Giá {songay} ạ." } : i);
  const f = fakePorts();
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "adizero boston 13 gia bao nhieu" });
  assert.equal(r.action, "handoff", `A sentence with a hole was sent: ${r.reply}`);
});

test("only slot values may be echoed, not every number the customer typed", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "shop con 500 doi adizero boston 13 size 42 khong");
  assert.ok(r.echoed.includes("42"), "The size the customer gave must be echoable.");
  assert.ok(!r.echoed.some((v) => B.numbersIn(v).includes(500)), "The 500 the customer typed became a licensed stock figure.");
});

// ===========================================================================
// Review round three
// ===========================================================================

test("an OPTIONAL axis must not disable the gate of a REQUIRED axis", async () => {
  // Pharmacy: packaging given (optional), strength not (required). Earlier the "filtered" flag was
  // set and the bot summed two different strengths together.
  const f = fakePorts({
    items: [PARA],
    rows: [
      { itemId: "i9", variantId: "a", variantLabel: "500mg x 30 vien", warehouseId: "w1", warehouseName: "Quay 1", qty: 0, price: 25000 },
      { itemId: "i9", variantId: "b", variantLabel: "250mg x 30 vien", warehouseId: "w1", warehouseName: "Quay 1", qty: 7, price: 18000 }
    ] as never
  });
  const r = await ask(f.ports, "paracetamol hop 30 vien gia bao nhieu", {}, "nha-thuoc");
  assert.notEqual(r.action, "send", `Two strengths summed together: ${r.reply}`);
  assert.ok(!/Còn 7 hộp/.test(r.reply), r.reply);
});

test("placeholders NAMED BY THE PACK are guarded too", async () => {
  const pack = clonePack(pharmacyPack);
  pack.intents = pack.intents.map((i) => i.id === "hoi_gia" ? { ...i, template: "Còn {ton} hộp {quycach} ạ." } : i);
  const f = fakePorts({
    items: [PARA],
    rows: [{ itemId: "i9", variantId: "a", variantLabel: "khong theo quy uoc", warehouseId: "w1", warehouseName: "Q1", qty: 5, price: 25000 }] as never
  });
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "paracetamol gia bao nhieu" });
  assert.notEqual(r.action, "send", `A sentence with a hole was sent: ${r.reply}`);
});

test("ask-backs spread far apart still end with a human", async () => {
  // A 30-minute window is not enough: on Fanpage customers answer hours apart.
  const f = fakePorts();
  let t = T0.getTime();
  const actions: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    f.setNow(new Date(t));
    actions.push((await ask(f.ports, "con size 42 khong shop")).action);
    t += 35 * 60_000;
  }
  assert.ok(actions.includes("handoff"), `The bot asks forever and never calls a human: ${actions.join(", ")}`);
});

test("a truncated stock result asserts nothing", async () => {
  const f = fakePorts({ truncated: true, rows: [row("43", 5)] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.match(r.reply, /chưa tra được kho/, `Asserted on a partial result: ${r.reply}`);
  assert.ok(!/hết|Còn \d/.test(r.reply), "Said in or out of stock on a partial result.");
});

test("tools taking an ItemId receive the ItemId, not the merchant code", async () => {
  const pack = clonePack(runningShoesPack);
  pack.intents.push({
    id: "hoi_order", name: "Hoi hang order", keywords: ["order", "bao lau ve"],
    requiredSlots: ["item"], tools: ["purchase.eta"],
    template: "Hàng về trong {songay} ngày ạ.",
    askBackTemplate: "{khach} cho {shop} xin tên mẫu ạ."
  });
  const f = fakePorts({ etaDays: 7 });
  await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "adizero boston 13 order bao lau ve" });
  const call = f.calls.find((c) => c.tool === "purchase.eta");
  assert.ok(call !== undefined, "purchase.eta was not called.");
  assert.equal((call.input as { itemId: string }).itemId, "i1", "The merchant code was passed instead of the internal id.");
});

test("DECISION 3: the customer's phone number is NOT stored on Xeon", async () => {
  const f = fakePorts({
    orders: [{ orderId: "MAN-1", status: "đang giao", createdAt: T0.toISOString(), money: { total: 100, paid: 100, remaining: 0, cod: 0 }, lines: [] }]
  });
  await ask(f.ports, "don hang cua em toi dau roi");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "0968411655");
  assert.equal(r.action, "send", JSON.stringify(r.gates));

  const stored = JSON.stringify(r.state);
  assert.ok(!stored.includes("0968411655"), "The customer's phone number was written to Xeon.");
  assert.equal(r.state.focusSlots?.["phone"], undefined);
  assert.doesNotThrow(() => B.assertNoStoredPII([...r.state.turns.map((t) => t.text), ...Object.values(r.state.focusSlots ?? {})]));
});

test("a disabled module's tool is NOT called by the engine", async () => {
  const f = fakePorts({ available: ["catalog.search"] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.ok(!f.calls.some((c) => c.tool === "stock.lookup"), "Called a tool of a disabled module.");
  assert.notEqual(r.action, "send", `Answered stock without permission: ${r.reply}`);
});

test("a blocked sentence is NOT sent", async () => {
  const bad = clonePack(runningShoesPack);
  bad.intents = bad.intents.map((i) => i.id === "hoi_gia" ? { ...i, template: "Giá {gia} ạ. Bên em bảo hành trọn đời ạ." } : i);
  const f = fakePorts();
  const r = await B.handleTurn(bad, f.ports, { tenant: TENANT, conversationId: CONV, text: "adizero boston 13 gia bao nhieu" });
  assert.equal(r.action, "handoff");
  assert.ok(!/bảo hành trọn đời/.test(r.reply), `The forbidden sentence reached the customer: ${r.reply}`);
  assert.match(r.reply, /nhờ nhân viên/);
});

test("an always-handoff intent locks the episode", async () => {
  const f = fakePorts({ items: [PARA] });
  const r1 = await ask(f.ports, "thuoc nay uong may vien mot ngay", {}, "nha-thuoc");
  assert.equal(r1.action, "handoff");
  assert.equal(r1.state.handedOff, true);

  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "co paracetamol 500mg khong a", {}, "nha-thuoc");
  assert.equal(r2.action, "handoff", "The bot jumped back in after handing to the pharmacist.");
});

test("switching items drops the old item's axis values", async () => {
  const HOKA = itemLite("i3", "HK0008", "Hoka Bondi 8", "hoka", 4290000, 6);
  const f = fakePorts({ items: [BOSTON, HOKA], rows: [row("42", 3), row("43", 6)] });
  const r1 = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r1.slots["size"], "42");

  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "hoka bondi 8 con hang khong");
  assert.equal(r2.itemCode, "HK0008");
  assert.notEqual(r2.slots["size"], "42", "The previous pair's size stuck to the new item.");
});

test("the recognition threshold is in force", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "cho em hoi con 42 khong shop");
  assert.equal(r.itemCode, null, "No model named, yet an item was chosen.");
  assert.equal(r.action, "ask_back");
});

test("a follow-up does not lose the focus", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r1 = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r1.itemCode, "IE0000");

  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "doi nay con 43 khong a");
  assert.equal(r2.itemCode, "IE0000", "The most common follow-up made the bot forget the item.");
  assert.equal(r2.action, "send", JSON.stringify(r2.gates));
  assert.match(r2.reply, /Còn 6 đôi/);
});

test("the catalog threshold for 'we do not carry' comes from the PACK", async () => {
  // The pharmacy declares 100, not the 200 hard-coded for shoes.
  const f = fakePorts({ items: [], catalogSize: 150 });
  const r = await ask(f.ports, "co thuoc bayer khong a", {}, "nha-thuoc");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /không có hàng bayer/);
});

// ===========================================================================
// Review round four
// ===========================================================================

test("a numeric Messenger conversation id does NOT kill the turn", async () => {
  const f = fakePorts();
  const r = await B.handleTurn(B.loadPack("giay-chay"), f.ports, {
    tenant: "84001234567" as never, conversationId: "2418071638332614" as never, text: "adizero boston 13 con size 42 khong"
  });
  assert.equal(r.action, "send", JSON.stringify(r.gates));
});

test("an EAN-13 product code is NOT treated as personal data", async () => {
  const EAN = itemLite("i7", "8934841100018", "Paracetamol", "traphaco", 25000, 1);
  const f = fakePorts({
    items: [EAN],
    rows: [{ itemId: "i7", variantId: "a", variantLabel: "500mg", warehouseId: "w1", warehouseName: "Q1", qty: 4, price: 25000 }] as never
  });
  const r = await ask(f.ports, "co paracetamol 500mg khong a", {}, "nha-thuoc");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.equal(r.state.focusItemCode, "8934841100018");
});

test("the customer's message text is NOT stored on Xeon", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "em ten Nguyen Van A, giao ve 123 Nguyen Trai Thanh Xuan, adizero boston 13 con size 42 khong");
  const customerTurns = r.state.turns.filter((t) => t.role === "customer");
  assert.ok(customerTurns.length > 0);
  for (const t of customerTurns) assert.equal(t.text, "", "The customer's text was written to Xeon.");
  assert.ok(!JSON.stringify(r.state).includes("Nguyen Trai"));
});

test("the industry's OWN gate really blocks, independent of the handoff intent", async () => {
  const pack = clonePack(pharmacyPack);
  pack.intents = pack.intents.map((i) => i.id === "hoi_gia" ? { ...i, template: "Ngày uống 2 viên ạ." } : i);
  const f = fakePorts({
    items: [PARA],
    rows: [{ itemId: "i9", variantId: "a", variantLabel: "500mg", warehouseId: "w1", warehouseName: "Q1", qty: 2, price: 2 }] as never
  });
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "paracetamol gia bao nhieu" });
  assert.ok(r.gates.some((g) => g.rule === "forbidden_patterns"), `The industry gate did not fire: ${JSON.stringify(r.gates)}`);
  assert.ok(!/uống 2 viên/.test(r.reply), `Dosage advice reached the customer: ${r.reply}`);
});

test("two models with equal scores: no guessing", async () => {
  const B12 = itemLite("i2", "IE0001", "Adizero Boston 12", "adidas", 2590000, 8);
  const f = fakePorts({ items: [BOSTON, B12] });
  const r = await ask(f.ports, "adizero boston con size 42 khong");
  assert.equal(r.itemCode, null, "Two Bostons tied and the bot still chose one.");
  assert.equal(r.action, "ask_back");
});

test("a stock sentence with an empty placeholder is never sent", async () => {
  const pack = clonePack(pharmacyPack);
  pack.templates["in_stock"] = "Còn {ton} hộp {quycach} ạ.";
  const f = fakePorts({
    items: [PARA],
    rows: [{ itemId: "i9", variantId: "a", variantLabel: "500mg", warehouseId: "w1", warehouseName: "Q1", qty: 5, price: 25000 }] as never
  });
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "co paracetamol 500mg khong a" });
  assert.notEqual(r.action, "send", `A sentence with a hole was sent: ${r.reply}`);
});

// ===========================================================================
// Review round five
// ===========================================================================

test("a forbidden phrase in the ASK-BACK sentence never reaches the customer", async () => {
  const bad = clonePack(runningShoesPack);
  bad.templates["ask_item"] = "{khach} cho {shop} xin mã mẫu ạ, bên em bảo hành trọn đời ạ.";
  const f = fakePorts();
  const r = await B.handleTurn(bad, f.ports, { tenant: TENANT, conversationId: CONV, text: "con size 42 khong shop" });
  assert.ok(!/bảo hành trọn đời/.test(r.reply), `The forbidden phrase reached the customer: ${r.reply}`);
});

test("a forbidden phrase in the HANDOFF sentence never reaches the customer", async () => {
  const bad = clonePack(pharmacyPack);
  bad.templates["handoff"] = "{shop} chuyển dược sĩ ạ, thuốc này chữa khỏi hoàn toàn ạ.";
  const f = fakePorts({ items: [PARA] });
  const r = await B.handleTurn(bad, f.ports, { tenant: TENANT, conversationId: CONV, text: "thuoc nay uong may vien mot ngay" });
  assert.equal(r.action, "handoff");
  assert.ok(!/chữa khỏi hoàn toàn/.test(r.reply), `The forbidden phrase reached the customer: ${r.reply}`);
});

test("an ask-back sentence with an empty placeholder is not sent", async () => {
  const bad = clonePack(runningShoesPack);
  bad.templates["ask_item"] = "{khach} cho {shop} xin mã mẫu, bên em còn {ton} đôi ạ.";
  const f = fakePorts();
  const r = await B.handleTurn(bad, f.ports, { tenant: TENANT, conversationId: CONV, text: "con size 42 khong shop" });
  assert.notEqual(r.action, "ask_back", `A sentence with a hole was sent: ${r.reply}`);
});

test("a product code containing digits is not an invented number", async () => {
  const pack = clonePack(runningShoesPack);
  pack.intents = pack.intents.map((i) => i.id === "hoi_gia" ? { ...i, template: "Mẫu {mon} giá {gia} ạ." } : i);
  const f = fakePorts({ rows: [row("42", 3)] });
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "adizero boston 13 gia bao nhieu" });
  assert.equal(r.action, "send", `The product code was treated as an invented number: ${JSON.stringify(r.gates)}`);
  assert.match(r.reply, /IE0000/);
});

test("a successful answer resets the ask-back counter", async () => {
  const f = fakePorts();
  const r1 = await ask(f.ports, "con size 42 khong shop");
  assert.equal(r1.action, "ask_back");
  assert.equal(r1.state.askBackCount, 1);

  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "adizero boston 13 nhe");
  assert.equal(r2.action, "send");
  assert.equal(r2.state.askBackCount, 0, "The counter was not reset after a successful answer.");

  f.setNow(hours(2));
  const r3 = await ask(f.ports, "the con mau khac thi sao");
  assert.notEqual(r3.action, "handoff", "Episode locked although the customer had answered fully before.");
});

// ===========================================================================
// Review round six
// ===========================================================================

test("a memory keyed by the wrong merchant must NOT answer the wrong merchant", async () => {
  // This fake is deliberately keyed by conversation id ALONE, the mistake a real storage layer
  // could easily repeat.
  const store = new Map<string, B.ConversationState>();
  const shared: B.Ports = {
    clock: { now: () => T0 },
    tools: {
      online: () => true,
      available: () => ["stock.lookup"],
      async call(tool) {
        return (tool === "stock.lookup"
          ? { ok: true, tool, data: { rows: [row("42", 3)], asOf: T0.toISOString(), truncated: false } }
          : { ok: false, tool, error: { code: "not_found", message: "x" } }) as B.ToolResult<typeof tool>;
      }
    },
    catalog: {
      async search(_t, q) {
        return B.tokens("IE0000 Adizero Boston 13").some((x) => B.normalize(q).includes(x)) ? [BOSTON] : [];
      },
      async size() { return 1200; }
    },
    memory: {
      async load(_tenant, id) { return store.get(id) ?? null; },
      async save(s) { store.set(s.conversationId, s); }
    }
  };
  const pack = B.loadPack("giay-chay");
  await B.handleTurn(pack, shared, { tenant: "shopA" as never, conversationId: "c9" as never, text: "adizero boston 13 con size 42 khong" });
  const r = await B.handleTurn(pack, shared, { tenant: "shopB" as never, conversationId: "c9" as never, text: "con hang khong" });
  assert.notEqual(r.action, "send", `Merchant B received merchant A's answer: ${r.reply}`);
  assert.equal(r.itemCode, null, "Merchant A's focus leaked to merchant B.");
});

test("endless greetings must end with a human", async () => {
  const f = fakePorts();
  const actions: string[] = [];
  const texts = ["alo", "ok", "co ai khong", "the a"];
  for (let i = 0; i < 4; i += 1) {
    f.setNow(minutes(i));
    actions.push((await ask(f.ports, texts[i]!)).action);
  }
  assert.ok(actions.includes("handoff"), `The bot loops greetings forever: ${actions.join(", ")}`);
});

test("text WRITTEN BY THE MERCHANT also passes the industry gate", async () => {
  // The validator forces pack templates to carry diacritics, but cannot force what the merchant
  // types into the policy table, and that text is inserted verbatim into the reply.
  const f = fakePorts({ items: [PARA], policy: "Thuoc nay uong 2 vien moi ngay, ngay 3 lan a." });
  const pack = clonePack(pharmacyPack);
  pack.intents.push({
    id: "hoi_chinh_sach", name: "Hoi chinh sach", keywords: ["doi tra", "chinh sach"],
    requiredSlots: ["topic"], tools: ["policy.get"],
    template: "{chinhsach}", askBackTemplate: "{khach} cho {shop} biết cụ thể hơn ạ."
  });
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "chinh sach doi tra the nao" });
  assert.ok(!/uong 2 vien/.test(r.reply), `Dosage advice from the policy table reached the customer: ${r.reply}`);
});

test("numbers inside an order status count as sourced", async () => {
  const f = fakePorts({
    orders: [{ orderId: "MAN-7", status: "còn 2 ngày nữa tới", createdAt: T0.toISOString(), money: { total: 100, paid: 100, remaining: 0, cod: 0 }, lines: [] }]
  });
  await ask(f.ports, "don hang cua em toi dau roi");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "0968411655");
  assert.equal(r.action, "send", `A number in the order status was treated as invented: ${JSON.stringify(r.gates)}`);
  assert.match(r.reply, /còn 2 ngày nữa tới/);
});

test("a pack-specific placeholder renders its value", async () => {
  const pack = clonePack(runningShoesPack);
  pack.extraValues = { camket: "hàng có sẵn tại kho" };
  pack.templates["in_stock"] = "Còn {ton} đôi {truc} {size}, giá {gia} ạ, {camket} ạ.";
  const f = fakePorts();
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "adizero boston 13 con size 42 khong" });
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /hàng có sẵn tại kho/);
});

test("an empty warehouse name means the sentence is not sent", async () => {
  const pack = clonePack(runningShoesPack);
  pack.templates["in_stock"] = "Còn {ton} đôi {truc} {size} tại {kho}, giá {gia} ạ.";
  const f = fakePorts({
    rows: [{ itemId: "i1", variantId: "v", variantLabel: "42", warehouseId: "w1", warehouseName: "", qty: 3, price: 3190000 }] as never
  });
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "adizero boston 13 con size 42 khong" });
  assert.notEqual(r.action, "send", `A sentence with a hole was sent: ${r.reply}`);
});

// ===========================================================================
// MULTI-TURN CONVERSATIONS: what real chats over the link revealed (10/09).
// ===========================================================================

test("naming an item alone is a stock question: ask size, then '42' answers it", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r1 = await ask(f.ports, "shop oi co adizero boston 13 khong");
  assert.equal(r1.intentId, "hoi_ton_kho", "Only a greeting; the customer has to ask again.");
  assert.equal(r1.action, "ask_back");
  assert.match(r1.reply, /size/);

  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "42");
  assert.equal(r2.action, "send", JSON.stringify(r2.gates));
  assert.match(r2.reply, /Còn 3 đôi size 42/, r2.reply);
});

test("a follow-up made only of a number and fillers keeps the focus", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "size 43 thi sao");
  assert.equal(r.itemCode, "IE0000", "The focus was wiped by a simple follow-up.");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /Còn 6 đôi size 43/, r.reply);
});

test("a foreign LETTER word still means a switch: no adidas stock for a Salomon question", async () => {
  const f = fakePorts({ rows: [row("42", 3)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "con salomon speedcross size 42 khong");
  assert.notEqual(r.itemCode, "IE0000");
  assert.ok(!/Còn 3 đôi/.test(r.reply), r.reply);
});

test("a follow-up with ANOTHER bare number switches to it instead of sticking to the old value", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  const r1 = await ask(f.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  assert.match(r1.reply, /Còn 12 hộp 500mg/, r1.reply);

  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "loai 650 con khong", {}, "nha-thuoc");
  assert.equal(r2.action, "send", JSON.stringify(r2.gates));
  assert.match(r2.reply, /Còn 4 hộp 650mg/, `Answered 500mg stock to a question about 650: ${r2.reply}`);
  assert.ok(!/500mg/.test(r2.reply), r2.reply);
  assert.notEqual(r2.state.focusSlots?.["hamluong"], "650mg", "The inferred value stuck to the next turn.");
});

test("a bare number matching TWO labels is not guessed: asking back beats a wrong guess", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("500ml", 3, 40000)] });
  const r = await ask(f.ports, "paracetamol loai 500 con khong", {}, "nha-thuoc");
  assert.equal(r.action, "ask_back", `Guessed between 500mg and 500ml: ${r.reply}`);
});

test("a bare number matching NO label is not guessed", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  const r = await ask(f.ports, "paracetamol con 2 hop khong", {}, "nha-thuoc");
  assert.equal(r.action, "ask_back", `"2 hop" was read as a strength: ${r.reply}`);
});

test("without intentWhenItemNamed, naming an item is only a greeting", async () => {
  const pack = clonePack(runningShoesPack);
  delete pack.intentWhenItemNamed;
  const f = fakePorts({ rows: [row("42", 3)] });
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "adizero boston 13" });
  assert.equal(r.intentId, null, "The engine decided in place of the pack.");
});

test("a bare number must NOT override an axis value stated explicitly in the same sentence", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await ask(f.ports, "adizero boston 13 con khong");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "size 44 con khong hay chi con 43");
  assert.equal(r.slots["size"], "44", JSON.stringify(r.slots));
  assert.ok(!/Còn 6 đôi size 43/.test(r.reply), `Answered size 43 to a question about 44: ${r.reply}`);
});

// ===========================================================================
// REVIEW ROUND 7: every conversation rule pushed the same way (ask -> assert).
// Each test below keeps the OPPOSITE direction: silence beats a wrong answer.
// ===========================================================================

test("a number WITH a unit ('650mg') does not lose the focus", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  await ask(f.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "con 650mg nua khong", {}, "nha-thuoc");
  assert.equal(r.itemCode, "PARA500", "'650mg' was treated as a foreign word and wiped the focus.");
  assert.match(r.reply, /Còn 4 hộp 650mg/, r.reply);
});

test("a new item with a PURELY NUMERIC name (New Balance 574) is still a switch", async () => {
  const NB574 = itemLite("i5", "NB574", "New Balance 574", "new balance", 2290000, 6);
  const f = fakePorts({ items: [BOSTON, NB574], rows: [row("42", 3)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "con 574 khong shop");
  assert.notEqual(r.itemCode, "IE0000", "Boston stock answered to a question about 574.");
  assert.ok(!/Còn 3 đôi/.test(r.reply), r.reply);
});

test("naming an item WITH other content is not a stock question", async () => {
  for (const text of [
    "adizero boston 13 bi bong keo roi shop",
    "em nhan duoc adizero boston 13 roi nhe cam on shop",
    "adizero boston 13 giat may duoc khong",
    "adizero boston 13 em di duoc 43 hom thi bi bong keo"
  ]) {
    const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
    const r = await ask(f.ports, text);
    assert.notEqual(r.intentId, "hoi_ton_kho", `A complaint or thanks was read as a stock question: "${text}"`);
    assert.ok(!/Còn \d+ đôi/.test(r.reply), `A complaint answered with a stock table: "${text}" -> ${r.reply}`);
  }
});

test("a number next to a quantity, weight or money word is NOT guessed as a variant", async () => {
  const cases: [string, RegExp][] = [
    ["shop oi adizero boston 13 con 42 doi khong", /size 42/],
    ["adizero boston 13 em nang 50 kg cao 1m70 nen di size nao", /size 50/],
    ["adizero boston 13 em coc truoc 42.000d nhe", /size 42/],
    ["adizero boston 13 don cua em 45.000d tien ship", /size 45/]
  ];
  for (const [text, forbidden] of cases) {
    const f = fakePorts({ rows: [row("42", 3), row("43", 6), row("45", 1), row("50", 2)] });
    const r = await ask(f.ports, text);
    assert.ok(!forbidden.test(r.reply), `Guessed a variant from a number that is not one: "${text}" -> ${r.reply}`);
  }
});

test("pharmacy: transferred money and box counts are not read as strengths", async () => {
  const f1 = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  const r1 = await ask(f1.ports, "paracetamol em chuyen 500.000d roi shop", {}, "nha-thuoc");
  assert.ok(!/Còn 12 hộp 500mg/.test(r1.reply), `Transferred money became a strength: ${r1.reply}`);

  const f2 = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("2ml", 7, 15000)] });
  const r2 = await ask(f2.ports, "paracetamol cho em lay 2 hop", {}, "nha-thuoc");
  assert.ok(!/2ml/.test(r2.reply), `A box count became a strength: ${r2.reply}`);
});

test("an INFERRED value lives only in its turn and never sticks", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  const r1 = await ask(f.ports, "co paracetamol khong", {}, "nha-thuoc");
  assert.equal(r1.action, "ask_back", r1.reply);
  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "650", {}, "nha-thuoc");
  assert.equal(r2.action, "send", `The bot did not understand the answer to its own question: ${r2.reply}`);
  assert.match(r2.reply, /Còn 4 hộp 650mg/, r2.reply);
  f.setNow(minutes(2));
  const r3 = await ask(f.ports, "the con hang khong shop", {}, "nha-thuoc");
  assert.equal(r3.action, "ask_back", `The inferred value stuck to the next turn: ${r3.reply}`);
});

test("an ordinary follow-up in another industry keeps the focus too", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  await ask(f.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "loai 650 thi sao", {}, "nha-thuoc");
  assert.equal(r.itemCode, "PARA500");
  assert.match(r.reply, /Còn 4 hộp 650mg/, r.reply);
});

test("a sentence with TWO bare numbers is not guessed even when only one matches", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  const r = await ask(f.ports, "paracetamol hom qua em hoi 650, gio 700 con khong", {}, "nha-thuoc");
  assert.ok(!/Còn 4 hộp 650mg/.test(r.reply), `Guessed 650mg for a question about 700: ${r.reply}`);
  assert.equal(r.action, "ask_back", r.reply);
});

// ===========================================================================
// REVIEW ROUND 8: an ALLOW-LIST for bare numbers; the pack's pattern passes through it too.
// ===========================================================================

test("X1: the size pattern must not read money as a size, and must not store it", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r1 = await ask(f.ports, "adizero boston 13 con hang khong shop, em chuyen 42.000d tien ship roi");
  assert.ok(!/size 42/.test(r1.reply), `Shipping money became a size: ${r1.reply}`);
  assert.equal(r1.slots["size"], undefined, JSON.stringify(r1.slots));
  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "con hang khong shop");
  assert.ok(!/size 42/.test(r2.reply), `The wrong size stuck to the next turn: ${r2.reply}`);
});

test("X2: a number without a variant cue is not guessed (pharmacy)", async () => {
  const rows = [HL("3ml", 2, 12000), HL("5ml", 9, 18000), HL("10ml", 4, 30000)];
  const cases: [string, RegExp][] = [
    ["paracetamol con hang khong shop, thu 5 em qua lay", /5ml/],
    ["paracetamol con hang khong, em o quan 3 giao duoc khong", /3ml/],
    ["paracetamol con hang khong, nha em so 10 ngo 5", /10ml|5ml/]
  ];
  for (const [text, forbidden] of cases) {
    const f = fakePorts({ items: [PARA], rows });
    const r = await ask(f.ports, text, {}, "nha-thuoc");
    assert.ok(!forbidden.test(r.reply), `Guessed a variant from a number that is not one: "${text}" -> ${r.reply}`);
  }
});

test("X2: a number without a variant cue is not guessed (shoes)", async () => {
  const rows = [row("40", 5), row("42", 3), row("43", 6)];
  const cases: [string, RegExp][] = [
    ["adizero boston 13 con hang khong shop, ngoai troi 40 do ma van chay duoc chu", /size 40/],
    ["adizero boston 13 con hang khong, em chay duoc 42 buoi roi", /size 42/],
    ["adizero boston 13 con hang khong shop, nha em o toa 43", /size 43/],
    ["adizero boston 13 con hang khong, em cao 1m70", /size 70|size 1\b/]
  ];
  for (const [text, forbidden] of cases) {
    const f = fakePorts({ rows });
    const r = await ask(f.ports, text);
    assert.ok(!forbidden.test(r.reply), `"${text}" -> ${r.reply}`);
  }
});

test("the allow-list still admits the most common ways of asking about a variant", async () => {
  const pharmacy = () => fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  for (const text of ["co paracetamol con 650 khong", "paracetamol het 650 chua", "paracetamol loai 650 con khong"]) {
    const r = await ask(pharmacy().ports, text, {}, "nha-thuoc");
    assert.match(r.reply, /Còn 4 hộp 650mg/, `Asked back unfairly: "${text}" -> ${r.reply}`);
  }
  const shoes = () => fakePorts({ rows: [row("42", 3), row("43", 6)] });
  for (const text of ["adizero boston 13 em di 42", "adizero boston 13 mau nay 42 con khong", "adizero boston 13 con 42 khong"]) {
    const r = await ask(shoes().ports, text);
    assert.match(r.reply, /Còn 3 đôi size 42/, `Asked back unfairly: "${text}" -> ${r.reply}`);
  }
});

test("a number answering the pending slot is NOT mistaken for another item (Vitamin C 500)", async () => {
  const VITC = itemLite("i8", "VITC500", "Vitamin C 500", "dhg", 40000, 1);
  const f = fakePorts({ items: [PARA, VITC], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  const r1 = await ask(f.ports, "co paracetamol khong", {}, "nha-thuoc");
  assert.equal(r1.action, "ask_back", r1.reply);
  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "500", {}, "nha-thuoc");
  assert.equal(r2.itemCode, "PARA500", "The focus jumped to Vitamin C 500 because of '500'.");
  assert.match(r2.reply, /Còn 12 hộp 500mg/, r2.reply);
});

test("calling the item by a SHORT NAME keeps the focus", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "boston con size 43 khong");
  assert.equal(r.itemCode, "IE0000", "Said 'boston' and the bot asked for the model name.");
  assert.match(r.reply, /Còn 6 đôi size 43/, r.reply);
});

test("a TWO-digit item name (Air Max 90) is still a switch", async () => {
  const AM90 = itemLite("i6", "AM90", "Air Max 90", "nike", 3290000, 6);
  const f = fakePorts({ items: [BOSTON, AM90], rows: [row("42", 3)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "con 90 khong");
  assert.notEqual(r.itemCode, "IE0000", "Boston stock answered to a question about Air Max 90.");
  assert.ok(!/Còn 3 đôi/.test(r.reply), r.reply);
});

test("N4: a bare greeting does not clear the ask-back mark: ask -> alo -> ask again hands off", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r1 = await ask(f.ports, "shop oi co adizero boston 13 khong");
  assert.equal(r1.action, "ask_back", r1.reply);
  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "alo");
  assert.notEqual(r2.action, "ask_back");
  f.setNow(minutes(2));
  const r3 = await ask(f.ports, "co size khong shop");
  assert.equal(r3.action, "handoff", `Second ask-back within 30 minutes without a human: ${r3.reply}`);
});

test("a stock row without qty must not produce 'Con NaN doi'", async () => {
  const f = fakePorts({ rows: [{ itemId: "i1", variantId: "v", variantLabel: "42", warehouseId: "w1", warehouseName: "Kho nha", price: 3190000 }] as never });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.ok(!/NaN/.test(r.reply), r.reply);
  assert.notEqual(r.action, "send", `A sentence built on broken data was sent: ${r.reply}`);
});

// ===========================================================================
// REVIEW ROUND 9: refusing a new number must not become confirming the old one.
// ===========================================================================

test("pinned size: asking about another size in everyday phrasing NEVER answers with the old size", async () => {
  for (const text of [
    "the 43 con khong", "cho em hoi 43 con khong", "shop oi 43 con khong",
    "ban 43 con khong a", "a 43 con khong", "hoi 43 con hang khong"
  ]) {
    const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
    await ask(f.ports, "adizero boston 13 con size 42 khong");
    f.setNow(minutes(1));
    const r = await ask(f.ports, text);
    assert.ok(!/size 42/.test(r.reply), `Answered size 42 to a question about 43: "${text}" -> ${r.reply}`);
    assert.ok(/size 43/.test(r.reply) || r.action === "ask_back", `"${text}" -> ${r.reply}`);
  }
});

test("the item name right before a number is a variant cue", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "boston 43 con khong");
  assert.match(r.reply, /Còn 6 đôi size 43/, r.reply);

  const g = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  await ask(g.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  g.setNow(minutes(1));
  for (const text of ["paracetamol 650 con khong", "co paracetamol 650 khong"]) {
    const r2 = await ask(g.ports, text, {}, "nha-thuoc");
    assert.match(r2.reply, /Còn 4 hộp 650mg/, `"${text}" -> ${r2.reply}`);
  }
});

test("two bare numbers that cannot be resolved also UN-PIN the old value", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6), row("44", 1)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "con 43 hay 44 khong");
  assert.ok(!/size 42/.test(r.reply), `Two new numbers, answered with the old one: ${r.reply}`);
});

test("an OPTIONAL axis filtering to nothing drops the filter: NEVER 'out of stock'", async () => {
  for (const text of [
    "co paracetamol 500mg khong, em can 2 vien thoi",
    "paracetamol 500mg con khong, cho em 10 vien"
  ]) {
    const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
    const r = await ask(f.ports, text, {}, "nha-thuoc");
    assert.ok(!/hết/.test(r.reply), `Out of stock while 12 boxes are on the shelf: "${text}" -> ${r.reply}`);
    assert.match(r.reply, /Còn 12 hộp 500mg/, r.reply);
  }
});

test("valid numbers are computed on the SAME string as the pack pattern: an alias cannot split the decision", async () => {
  const pack = clonePack(runningShoesPack);
  pack.lexicon.aliases = { ...pack.lexicon.aliases, sz: "size" };
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "adizero boston 13 con size 42 khong" });
  f.setNow(minutes(1));
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "sz 43 con khong" });
  assert.match(r.reply, /Còn 6 đôi size 43/, `Alias sz->size and still: ${r.reply}`);
  // Without the alias "sz" is no cue: ask back, but NEVER answer with size 42.
  const g = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await ask(g.ports, "adizero boston 13 con size 42 khong");
  g.setNow(minutes(1));
  const r2 = await ask(g.ports, "sz 43 con khong");
  assert.ok(!/size 42/.test(r2.reply), r2.reply);
});

test("WEAK cues (co/con/la) that are homonyms of ordinary words do not leak", async () => {
  const rows = [HL("2ml", 4, 9000), HL("5ml", 9, 18000), HL("10ml", 4, 30000)];
  const cases: [string, RegExp][] = [
    ["paracetamol con hang khong, nha em co 2 be nho", /2ml/],
    ["paracetamol con hang khong, em con 2 don chua nhan", /2ml/],
    ["paracetamol con hang khong, cai nay la 5 phai khong", /5ml/],
    ["paracetamol con hang khong, em lay 2 vi thoi", /2ml/]
  ];
  for (const [text, forbidden] of cases) {
    const f = fakePorts({ items: [PARA], rows });
    const r = await ask(f.ports, text, {}, "nha-thuoc");
    assert.ok(!forbidden.test(r.reply), `"${text}" -> ${r.reply}`);
  }
  // Real questions still pass. "lay 5" does NOT: "lay" is an ordering verb, its object a quantity.
  for (const text of ["paracetamol con 5 khong", "paracetamol con 5 khong shop", "co paracetamol 5 khong"]) {
    const f = fakePorts({ items: [PARA], rows });
    const r = await ask(f.ports, text, {}, "nha-thuoc");
    assert.match(r.reply, /Còn 9 hộp 5ml/, `Asked back unfairly: "${text}" -> ${r.reply}`);
  }
});

test("a number inside an axis range (size 41) is NOT an item name (Pegasus 41)", async () => {
  const PEG41 = itemLite("i7", "PEG41", "Pegasus 41", "nike", 3690000, 6);
  const f = fakePorts({ items: [BOSTON, PEG41], rows: [row("41", 4), row("42", 3)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "41 con khong");
  assert.equal(r.itemCode, "IE0000", "Jumped to Pegasus 41 because of the number 41.");
  assert.match(r.reply, /Còn 4 đôi size 41/, r.reply);
});

test("search in WAREHOUSE ORDER: 'Con O' on top does not steal the Vitamin C 500 focus", async () => {
  const CONO = itemLite("i1", "DGCO", "Dầu gió Con Ó", "x", 20000, 1);
  const VITC = itemLite("i8", "VITC500", "Vitamin C 500", "dhg", 40000, 1);
  const f = fakePorts({ items: [CONO, VITC], keepWarehouseOrder: true,
    rows: [{ itemId: "i8", variantId: "h5", variantLabel: "500mg", warehouseId: "q1", warehouseName: "Quay 1", qty: 7, price: 40000 }] as never });
  const r1 = await ask(f.ports, "co vitamin c 500 khong", {}, "nha-thuoc");
  assert.equal(r1.itemCode, "VITC500");
  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "500 con khong shop", {}, "nha-thuoc");
  assert.equal(r2.itemCode, "VITC500", `Focus lost because 'Con O' tops the list: ${r2.reply}`);
  assert.notEqual(r2.action, "handoff", r2.reply);
});

test("two bare numbers on a unit axis: unresolved, and the old pin is removed too", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000), HL("700mg", 2, 35000)] });
  await ask(f.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "loai 650 hay 700 con khong", {}, "nha-thuoc");
  assert.ok(!/500mg/.test(r.reply), "Two unresolved new numbers, answered with the old 500mg: " + r.reply);
  assert.equal(r.action, "ask_back", r.reply);
});

test("an alias turning WORDS into a NUMBER: the pack pattern sees that number", async () => {
  const pack = clonePack(runningShoesPack);
  pack.lexicon.aliases = { ...pack.lexicon.aliases, "bon hai": "42" };
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "adizero boston 13 con size bon hai khong" });
  assert.match(r.reply, /Còn 3 đôi size 42/, r.reply);
});

// ===========================================================================
// REVIEW ROUND 10: ordering verbs are not variant cues.
// ===========================================================================

test("a CLOSING line ('minh lay 2 nhe') is not answered with the 2ml stock", async () => {
  const rows = [HL("2ml", 4, 9000), HL("5ml", 9, 18000), HL("10ml", 4, 30000)];
  for (const text of [
    "paracetamol con hang khong shop, minh lay 2 nhe",
    "paracetamol con hang khong, cho em 2 nhe",
    "paracetamol con hang khong, em mua 2 duoc khong",
    "paracetamol con hang khong, em can 2 thoi",
    "paracetamol con hang khong, em lay 2 a",
    "paracetamol con hang khong, em can mua 2 hay 3 hop"
  ]) {
    const f = fakePorts({ items: [PARA], rows });
    const r = await ask(f.ports, text, {}, "nha-thuoc");
    assert.ok(!/2ml|5ml|10ml/.test(r.reply), `An order line was read as a variant: "${text}" -> ${r.reply}`);
  }
});

test("closing an order after stating the strength does not re-ask the strength", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  await ask(f.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "paracetamol con hang khong shop, minh lay 2 nhe", {}, "nha-thuoc");
  assert.match(r.reply, /Còn 12 hộp 500mg/, `The 500mg pin was removed because of a quantity: ${r.reply}`);
});

test("U1: a bare number matching TWO labels with a pinned value: ask back, never answer with the old value", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("500ml", 3, 40000), HL("650mg", 4, 32000)] });
  await ask(f.ports, "co paracetamol 650mg khong", {}, "nha-thuoc");
  f.setNow(minutes(1));
  const r = await ask(f.ports, "paracetamol con 500 khong", {}, "nha-thuoc");
  assert.ok(!/650mg/.test(r.reply), `A correct number for a different question: ${r.reply}`);
  assert.equal(r.action, "ask_back", r.reply);
});

test("both un-pins share one lifetime: the old value must not return on the third turn", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000), HL("700mg", 2, 35000)] });
  await ask(f.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "loai 650 hay 700 con khong", {}, "nha-thuoc");
  assert.equal(r2.action, "ask_back", r2.reply);
  // Past the 30-minute window of `ask_back_once`, so the third turn is not handed off for another reason.
  f.setNow(minutes(40));
  const r3 = await ask(f.ports, "the con hang khong", {}, "nha-thuoc");
  assert.ok(!/500mg/.test(r3.reply), `The old value came back on the third turn: ${r3.reply}`);
  assert.notEqual(r3.action, "send", `Answered with a value that had been un-pinned: ${r3.reply}`);
});

test("extra cues: 'boston 43' is STORED (the third turn is still 43, no re-ask)", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "boston 43 con khong");
  assert.match(r2.reply, /Còn 6 đôi size 43/, r2.reply);
  f.setNow(minutes(2));
  const r3 = await ask(f.ports, "con hang khong shop");
  assert.match(r3.reply, /Còn 6 đôi size 43/, `Size 43 just given was not kept: ${r3.reply}`);
});

// ===========================================================================
// REVIEW ROUND 11: item names and message openings also pass the question latch; the ordering veto is local.
// ===========================================================================

test("an order line with the number after the ITEM NAME or OPENING the message is not a variant", async () => {
  const rows = [HL("2ml", 4, 9000), HL("5ml", 9, 18000), HL("10ml", 4, 30000)];
  for (const text of ["cho em paracetamol 2 nhe", "paracetamol 2 nhe shop", "paracetamol 2 thoi"]) {
    const f = fakePorts({ items: [PARA], rows });
    const r = await ask(f.ports, text, {}, "nha-thuoc");
    assert.ok(!/2ml/.test(r.reply), `"${text}" -> ${r.reply}`);
  }
  // Second turn with NO pending question: "2 nhe shop" is a quantity.
  for (const text of ["2 nhe shop", "2 duoc khong shop"]) {
    const f = fakePorts({ items: [PARA], rows });
    await ask(f.ports, "co paracetamol 5ml khong", {}, "nha-thuoc");
    f.setNow(minutes(1));
    const r = await ask(f.ports, text, {}, "nha-thuoc");
    assert.ok(!/2ml/.test(r.reply), `second turn "${text}" -> ${r.reply}`);
  }
});

test("when the bot just asked for an axis, a number opening the message is the answer, any particle allowed", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r1 = await ask(f.ports, "shop oi co adizero boston 13 khong");
  assert.equal(r1.action, "ask_back", r1.reply);
  f.setNow(minutes(1));
  const r2 = await ask(f.ports, "42 nhe shop");
  assert.match(r2.reply, /Còn 3 đôi size 42/, `The customer answered the size and was asked again: ${r2.reply}`);
});

test("'cho em hoi' / 'xin hoi' openers do NOT veto the variant question", async () => {
  const pharmacy = () => fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  for (const text of ["cho em hoi paracetamol con 650 khong", "xin hoi paracetamol con 650 khong",
    "em mua hom truoc roi, paracetamol con 650 khong"]) {
    const r = await ask(pharmacy().ports, text, {}, "nha-thuoc");
    assert.match(r.reply, /Còn 4 hộp 650mg/, `Asked back unfairly: "${text}" -> ${r.reply}`);
  }
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r = await ask(f.ports, "cho em hoi adizero boston 13 con 43 khong");
  assert.match(r.reply, /Còn 6 đôi size 43/, r.reply);
  // But an ordering verb CLOSE to the number still vetoes.
  const g = fakePorts({ items: [PARA], rows: [HL("2ml", 4, 9000), HL("5ml", 9, 18000)] });
  const r2 = await ask(g.ports, "paracetamol con hang khong, cho em 2 nhe", {}, "nha-thuoc");
  assert.ok(!/2ml/.test(r2.reply), r2.reply);
});

test("generic words 'cai nay', 'san pham nay', 'chai nay' do not lose the focus", async () => {
  const cases: [string, CatalogItemLite[], never[], string, RegExp][] = [
    ["nha-thuoc", [PARA], [HL("500mg", 12, 25000)] as never[], "cai nay con khong", /Còn 12 hộp 500mg/],
    ["nha-thuoc", [PARA], [HL("500mg", 12, 25000)] as never[], "chai nay con khong", /Còn 12 hộp 500mg/],
    ["giay-chay", [BOSTON], [row("42", 3)] as never[], "san pham nay con khong", /Còn 3 đôi size 42/]
  ];
  for (const [packId, items, rows, text, expected] of cases) {
    const f = fakePorts({ items, rows });
    await ask(f.ports, packId === "giay-chay" ? "adizero boston 13 con size 42 khong" : "co paracetamol 500mg khong", {}, packId);
    f.setNow(minutes(1));
    const r = await ask(f.ports, text, {}, packId);
    assert.match(r.reply, expected, `"${text}" (${packId}) -> ${r.reply}`);
  }
});
