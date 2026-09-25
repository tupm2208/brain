/**
 * The soft shopping episode: a 6-hour gap alone does not lose the item; naming another one does.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { runningShoesPack } from "./fixtures.mts";

const dialogue = B.loadDialogueConfig("giay-chay");
const tracker = new B.EpisodeTracker(dialogue, runningShoesPack.lexicon.brands);
const T0 = Date.UTC(2026, 8, 24, 9, 0);
const at = (hours: number): string => new Date(T0 + hours * 3600_000).toISOString();
const BOSTON = { code: "JP9252", name: "Adizero Boston 13", brand: "adidas" };
const EVO = { code: "JH1234", name: "Adizero Evo SL", brand: "adidas" };

function start(): B.EpisodeUpdate {
  return tracker.update(null, [], { now: at(0), customerText: "adizero boston 13 con size 42 khong", intentId: "ask_size", reliableTop: BOSTON });
}

test("the first named item becomes the focus", () => {
  const u = start();
  assert.equal(u.opened, "first");
  assert.equal(u.episode.focus?.code, "JP9252");
  assert.equal(u.episode.focus?.by, "khach_nhac");
  assert.equal(u.episode.turns, 1);
});

test("seven hours later, 'đôi này' keeps the episode and its focus", () => {
  const u1 = start();
  const u2 = tracker.update(u1.episode, u1.past, { now: at(7), customerText: "doi nay con size 43 khong", intentId: "ask_size" });
  assert.equal(u2.opened, "", "a gap alone opened a new episode");
  assert.equal(u2.episode.id, u1.episode.id);
  assert.equal(u2.episode.focus?.code, "JP9252");
  assert.equal(u2.episode.staleGap, "7 giờ");
  assert.equal(u2.past.length, 0);
  const text = tracker.render(u2.episode, u2.past, at(7));
  assert.match(text, /KHÁCH QUAY LẠI SAU 7 giờ/);
  assert.match(text, /MẪU CHÍNH .*JP9252 Adizero Boston 13/);
});

test("seven hours later, naming ANOTHER item closes the old episode and opens a new one", () => {
  const u1 = start();
  const u2 = tracker.update(u1.episode, u1.past, { now: at(7), customerText: "co evo sl khong shop", reliableTop: EVO });
  assert.match(u2.opened, /^gap:/);
  assert.notEqual(u2.episode.id, u1.episode.id);
  assert.equal(u2.episode.focus?.code, "JH1234");
  assert.equal(u2.past.length, 1);
  assert.equal(u2.past[0]!.focus?.code, "JP9252");
  assert.equal(u2.past[0]!.outcome, "bo_do");
  assert.match(tracker.render(u2.episode, u2.past, at(7)), /PHIÊN TRƯỚC .*JP9252 Adizero Boston 13 — bỏ dở, chưa chốt/);
});

test("the view at read time reports a stale FINISHED episode as new", () => {
  const u1 = start();
  const u2 = tracker.update(u1.episode, u1.past, { now: at(1), customerText: "chot don nhe", intentId: "place_order", state: "cart_created" });
  assert.equal(u2.episode.stage, "sau_dat");
  assert.equal(u2.episode.outcome, "da_dat");
  const view = tracker.view(u2.episode, u2.past, at(9));
  assert.equal(view.current, null);
  assert.equal(view.justOpened, "8 giờ");
  assert.match(tracker.render(u2.episode, u2.past, at(9)), /^PHIÊN MỚI BẮT ĐẦU VỚI TIN NÀY \(khách quay lại sau 8 giờ\)/);
});

test("the shoe the customer is wearing is 'dang_di', never the focus", () => {
  const PEGASUS = { code: "NK001", name: "Nike Pegasus 41", brand: "nike" };
  const u = tracker.update(null, [], {
    now: at(0), customerText: "em dang di pegasus 41 size 42", intentId: "ask_size",
    reliableTop: PEGASUS, currentItemName: "Pegasus 41", pool: [PEGASUS]
  });
  assert.equal(u.episode.focus, null, "the worn shoe became the item to buy");
  assert.deepEqual(u.episode.others.map((o) => [o.code, o.role]), [["NK001", "dang_di"]]);
  assert.match(tracker.render(u.episode, u.past, at(0)), /MẪU PHỤ .*NK001 Nike Pegasus 41 — đôi khách ĐANG ĐI/);
});

test("a price question about another item is browsing; a size question moves the focus", () => {
  const u1 = start();
  const u2 = tracker.update(u1.episode, u1.past, { now: at(0.1), customerText: "evo sl gia bao nhieu", intentId: "ask_price", reliableTop: EVO });
  assert.equal(u2.episode.focus?.code, "JP9252", "a price question flipped the focus");
  assert.deepEqual(u2.episode.others.map((o) => [o.code, o.role]), [["JH1234", "khach_so_sanh"]]);
  const u3 = tracker.update(u2.episode, u2.past, { now: at(0.2), customerText: "evo sl size 42 con khong", intentId: "ask_size", reliableTop: EVO });
  assert.equal(u3.episode.focus?.code, "JH1234");
  assert.deepEqual(u3.episode.others.map((o) => [o.code, o.role]), [["JP9252", "khach_so_sanh"]]);
});

test("'thoi khong lay' drops the focus without a replacement; a page card is only a suggestion", () => {
  const u1 = start();
  const u2 = tracker.update(u1.episode, u1.past, { now: at(0.1), customerText: "thoi khong lay nua", pageProduct: EVO });
  assert.equal(u2.episode.focus, null);
  assert.ok(u2.episode.others.some((o) => o.code === "JP9252" && o.role === "da_bo"));
  assert.ok(u2.episode.others.some((o) => o.code === "JH1234" && o.role === "shop_goi_y"));
});

test("customerNamesProduct: code, brand-stripped name, line + version, word pair", () => {
  assert.equal(tracker.customerNamesProduct(BOSTON, "con jp9252 khong"), true);
  assert.equal(tracker.customerNamesProduct(BOSTON, "boston 13 size 42"), true);
  assert.equal(tracker.customerNamesProduct(EVO, "evo sl con khong"), true);
  assert.equal(tracker.customerNamesProduct(BOSTON, "con size 42 khong"), false);
  assert.equal(tracker.customerNamesProduct({ name: "adidas" }, "adidas con khong"), false, "a bare brand is not a product");
});

test("annotateHistory marks a gap between two turns", () => {
  const out = tracker.annotateHistory([{ at: at(0), text: "a" }, { at: at(0.5), text: "b" }, { at: at(8), text: "c" }]);
  assert.equal(out.length, 4);
  assert.deepEqual(out[2], { note: "—— cách 8 giờ, coi như PHIÊN MỚI từ đây ——" });
});

test("the pharmacy runs the tracker on tier 1's config alone", () => {
  const t = new B.EpisodeTracker(B.loadDialogueConfig("nha-thuoc"), []);
  const u = t.update(null, [], { now: at(0), customerText: "paracetamol 500mg con khong", intentId: "ask_size", reliableTop: { code: "PARA500", name: "Paracetamol" } });
  assert.equal(u.episode.focus?.code, "PARA500");
});
