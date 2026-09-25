/**
 * The focus resolver: who wins when the message does not say which product it is about.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { ALL, query, scorer } from "./stage3-fixtures.mts";

const resolver = new B.FocusResolver();
const catalog = new B.CatalogResolver(scorer);
const NOW = "2026-09-25T09:00:00.000Z";

const ledgerWith = (...products: Partial<B.LedgerProduct>[]): B.Ledger => ({
  ...B.ConversationLedger.empty(),
  products: products.map((p) => ({ code: "", name: "", brand: "", source: "chu_khach", firstAt: NOW, lastAt: NOW, askedSizes: [], status: "quan_tam", ...p }))
});

test("an unrecognised photo drops a focus the session never named (Pham Thanh, v46 / v97)", () => {
  const out = resolver.resolve({
    now: NOW, hasImage: true, imageRecognised: false,
    focusedProduct: { code: "BD0060", name: "Bang dau chay bo" },
    sessionTexts: ["co oder doi nay size 40.5 khong"]
  });
  assert.equal(out.product, null);
  assert.equal(out.source, "none");
  assert.equal(out.dropped, "stale_focus_image_turn");
  // The same focus named in the session survives.
  const kept = resolver.resolve({ now: NOW, hasImage: true, imageRecognised: false, focusedProduct: { code: "BD0060", name: "Bang dau chay bo" }, sessionTexts: ["ma BD0060 con khong", "co oder doi nay size 40.5 khong"] });
  assert.equal(kept.product?.code, "BD0060");
  assert.equal(kept.source, "customer_focus");
  // An episode last touched before the session started is not "this session" either.
  const old = resolver.resolve({
    now: NOW, hasImage: true, imageRecognised: false, sessionStartAt: "2026-09-25T08:00:00.000Z",
    episode: { id: "ep", startedAt: "2026-09-20T09:00:00.000Z", lastAt: "2026-09-25T07:00:00.000Z", openedBy: "first", turns: 3, focus: { code: "JS4955", name: "Adizero Boston 13", brand: "adidas", since: NOW, by: "khach_nhac" }, others: [], summary: "", stage: "tu_van", outcome: "", staleGap: "" },
    ledger: ledgerWith({ code: "JS4955", name: "Adizero Boston 13", lastAt: "2026-09-25T01:00:00.000Z" })
  });
  assert.equal(old.product, null, "the ledger entry is 8 h old: outside the gap, not this session's");
  assert.match(old.dropped ?? "", /episode_before_session/);
  // Like Desk (v97), only the EPISODE is set aside: a ledger entry touched within the gap still counts.
  const recent = resolver.resolve({
    now: NOW, hasImage: true, imageRecognised: false, sessionStartAt: "2026-09-25T08:00:00.000Z",
    ledger: ledgerWith({ code: "JS4955", name: "Adizero Boston 13", lastAt: "2026-09-25T07:00:00.000Z" })
  });
  assert.equal(recent.product?.code, "JS4955");
  assert.equal(recent.source, "ledger");
});

test("the card a person sent (or the replied-to product) beats the catalog match", () => {
  const resolution = catalog.resolve({ query: query({ productCode: "JS4955" }), found: ALL });
  const out = resolver.resolve({ now: NOW, hasImage: false, imageRecognised: false, pageSentProduct: { code: "IH5748", name: "Adizero Boston 12" }, resolution });
  assert.equal(out.product?.code, "IH5748");
  assert.equal(out.source, "page_sent");
  const noCard = resolver.resolve({ now: NOW, hasImage: false, imageRecognised: false, resolution });
  assert.equal(noCard.product?.code, "JS4955");
  assert.equal(noCard.source, "catalog");
  // A guess (needVerify) is not a focus: the ledger still decides.
  const guess = catalog.resolve({ query: query({ productName: "boston" }), found: ALL.slice(0, 1) });
  const fromLedger = resolver.resolve({ now: NOW, hasImage: false, imageRecognised: false, resolution: guess, ledger: ledgerWith({ code: "JQ0764", name: "Adizero Adios 9" }) });
  assert.equal(fromLedger.product?.code, "JQ0764");
  assert.equal(fromLedger.source, "ledger");
});

test("the model denying the focus changes nothing while the ledger still has it (Do Quan, 24/08)", () => {
  const ledger = ledgerWith({ code: "JQ0764", name: "Adizero Adios 9", brand: "adidas" });
  const denied = resolver.resolve({ now: NOW, hasImage: false, imageRecognised: false, ledger, analysisFocus: { product: "", changed: true } });
  assert.equal(denied.product?.code, "JQ0764");
  assert.equal(denied.source, "ledger");
  const unknownName = resolver.resolve({ now: NOW, hasImage: false, imageRecognised: false, ledger, analysisFocus: { product: "Pegasus 41", changed: true } });
  assert.equal(unknownName.product?.code, "JQ0764", "a claim naming nothing in the pool is ignored");
  // A claim naming a pool product with evidence flips the focus.
  const claimed = resolver.resolve({ now: NOW, hasImage: false, imageRecognised: false, ledger: ledgerWith({ code: "JQ0764", name: "Adizero Adios 9" }, { code: "JS4955", name: "Adizero Boston 13" }), analysisFocus: { product: "Adizero Adios 9", changed: true } });
  assert.equal(claimed.product?.code, "JQ0764");
  assert.equal(claimed.source, "ai");
});

test("productFromLedger: the episode's focus first, then the newest entry within the gap that is not ordered", () => {
  const episode: B.Episode = { id: "ep", startedAt: NOW, lastAt: NOW, openedBy: "first", turns: 2, focus: { code: "JS4955", name: "Adizero Boston 13", brand: "adidas", since: NOW, by: "khach_nhac" }, others: [], summary: "", stage: "tu_van", outcome: "", staleGap: "" };
  const ledger = ledgerWith({ code: "JS4955", name: "Adizero Boston 13" }, { code: "JQ0764", name: "Adizero Adios 9" });
  assert.equal(resolver.resolve({ now: NOW, hasImage: false, imageRecognised: false, episode, ledger }).source, "episode");
  // A cold episode (7 h) is skipped; the ledger's newest live entry within the gap wins; an ordered one is skipped.
  const later = "2026-09-25T16:30:00.000Z";
  const out = resolver.resolve({ now: later, hasImage: false, imageRecognised: false, episode, ledger: ledgerWith({ code: "JS4955", name: "Adizero Boston 13", lastAt: "2026-09-25T15:00:00.000Z" }, { code: "JQ0764", name: "Adizero Adios 9", lastAt: "2026-09-25T16:00:00.000Z", status: "da_dat" }) });
  assert.equal(out.product?.code, "JS4955");
  assert.equal(out.source, "ledger");
  const stale = resolver.resolve({ now: later, hasImage: false, imageRecognised: false, ledger: ledgerWith({ code: "JS4955", name: "Adizero Boston 13", lastAt: "2026-09-25T09:00:00.000Z" }) });
  assert.equal(stale.product, null, "an entry older than the gap is not the focus of a new session");
});
