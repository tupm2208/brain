/**
 * The shared activity buffer with MANY LANDINGS (21/09/2026).
 *
 * One Xeon, many merchants, one 500-entry buffer. Plain first-in-first-out means the merchant
 * having a bad hour quietly erases every other merchant's evidence within seconds — the opposite
 * of what the buffer is for. Two guards: a per-merchant rate, and eviction that takes from
 * whoever currently holds the most.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityLog, ManualClock } from "@sp/xeon";

const START = new Date("2026-09-21T09:00:00.000Z");

function heldBy(log: ActivityLog, shop: string): number {
  return log.recent({ shop }).length;
}

test("a merchant in a retry storm cannot push the other merchants out of the buffer", () => {
  const log = new ActivityLog({ clock: new ManualClock(START), capacity: 10, ratePerMinute: 10_000 });
  // Two quiet merchants get in first.
  log.add({ huong: "in", loai: "tin-den", shop: "yen-a" });
  log.add({ huong: "in", loai: "tin-den", shop: "yen-b" });
  // Then one floods far past the capacity.
  for (let i = 0; i < 50; i += 1) log.add({ huong: "in", loai: "tin-den", shop: "on-ao" });

  assert.equal(log.size(), 10);
  // Plain FIFO would have left nothing of the quiet ones. They are still here.
  assert.equal(heldBy(log, "yen-a"), 1);
  assert.equal(heldBy(log, "yen-b"), 1);
  assert.equal(heldBy(log, "on-ao"), 8);
});

test("over its minute a merchant is cut off, and the buffer says so exactly once", () => {
  const clock = new ManualClock(START);
  const log = new ActivityLog({ clock, capacity: 500, ratePerMinute: 5 });

  const kept = [];
  for (let i = 0; i < 20; i += 1) kept.push(log.add({ huong: "in", loai: "tin-den", shop: "on-ao" }));
  assert.equal(kept.filter((e) => e !== null).length, 5, "only the first five of the minute are kept");

  const notes = log.recent({ shop: "on-ao" }).filter((e) => /vượt mức/.test(e.tomTat ?? ""));
  assert.equal(notes.length, 1, "the warning must not itself become the flood");
  assert.match(notes[0]!.tomTat!, /5 mục\/phút/);

  // Another merchant is untouched by its neighbour's rate.
  assert.notEqual(log.add({ huong: "in", loai: "tin-den", shop: "yen-a" }), null);

  // A new minute, a new allowance.
  clock.advance(61_000);
  assert.notEqual(log.add({ huong: "in", loai: "tin-den", shop: "on-ao" }), null);
});

test("entries with no merchant keep their own share and are still evicted fairly", () => {
  const log = new ActivityLog({ clock: new ManualClock(START), capacity: 6, ratePerMinute: 10_000 });
  for (let i = 0; i < 20; i += 1) log.add({ huong: "in", loai: "http", duong: "/health" });
  log.add({ huong: "in", loai: "tin-den", shop: "yen-a" });
  for (let i = 0; i < 20; i += 1) log.add({ huong: "in", loai: "http", duong: "/health" });

  assert.equal(log.size(), 6);
  assert.equal(heldBy(log, "yen-a"), 1, "the one merchant entry survived a flood of unattributed ones");
});

test("holdings names who is filling the buffer, biggest first", () => {
  const log = new ActivityLog({ clock: new ManualClock(START), capacity: 100, ratePerMinute: 10_000 });
  for (let i = 0; i < 9; i += 1) log.add({ huong: "in", loai: "tin-den", shop: "on-ao" });
  for (let i = 0; i < 2; i += 1) log.add({ huong: "in", loai: "tin-den", shop: "yen-a" });
  log.add({ huong: "in", loai: "http", duong: "/health" });

  const holdings = log.holdings();
  assert.deepEqual(holdings[0], { shop: "on-ao", muc: 9 });
  assert.deepEqual(holdings[1], { shop: "yen-a", muc: 2 });
  assert.deepEqual(holdings[2], { shop: "", muc: 1 });
});

test("recent still filters by kind and by sequence, and now by merchant", () => {
  const log = new ActivityLog({ clock: new ManualClock(START), capacity: 100 });
  log.add({ huong: "in", loai: "tin-den", shop: "a" });
  const second = log.add({ huong: "in", loai: "license", shop: "b" })!;
  log.add({ huong: "in", loai: "tin-den", shop: "b" });

  assert.equal(log.recent({ shop: "b" }).length, 2);
  assert.equal(log.recent({ loai: "tin-den" }).length, 2);
  assert.equal(log.recent({ since: second.stt }).length, 1);
  // Newest first, as the viewer expects.
  assert.equal(log.recent()[0]!.stt, 3);
});
