/**
 * The catalog resolver: one match / several / none, and whether the one match is proven or a guess.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { ALL, BOSTON13, BOSTON13_DEN, BOSTON12, query, scorer } from "./stage3-fixtures.mts";

const resolver = new B.CatalogResolver(scorer);

test("a code is a proven single match: no verification needed", () => {
  const out = resolver.resolve({ query: query({ productCode: "IH5748" }), found: ALL });
  assert.equal(out.status, "single_match");
  assert.equal(out.selected[0]!.code, "IH5748");
  assert.equal(out.needVerify, false);
  assert.equal(out.reason, "code");
  assert.equal(out.needsClarification, false);
});

test("a loose name with one candidate is a guess: verify before quoting; OCR / image evidence lifts it", () => {
  const guess = resolver.resolve({ query: query({ productName: "boston" }), found: [BOSTON13] });
  assert.equal(guess.status, "single_match");
  assert.equal(guess.needVerify, true);
  assert.equal(guess.reason, "guess");
  const proven = resolver.resolve({ query: query({ productName: "boston" }), found: [BOSTON13], strongEvidence: "image_auto_match" });
  assert.equal(proven.needVerify, false);
  assert.equal(proven.reason, "image_auto_match");
});

test("two colourways of Boston 13 are several matches; nothing is not found", () => {
  const two = resolver.resolve({ query: query({ productName: "boston 13" }), found: [BOSTON13, BOSTON13_DEN, BOSTON12] });
  assert.equal(two.status, "multiple_matches");
  assert.equal(two.selected.length, 2);
  assert.equal(two.needsClarification, true);
  assert.equal(two.requestedVersion, "13");
  const none = resolver.resolve({ query: query({ productName: "vaporfly 3" }), found: ALL });
  assert.equal(none.status, "not_found");
  assert.equal(none.selected.length, 0);
});

test("an empty message takes the focus's code (the page card / the ledger), else it is an empty query", () => {
  const focus = resolver.resolve({ query: query({ size: "42" }), found: ALL, focused: { code: "IH5748", name: "Adizero Boston 12" } });
  assert.equal(focus.status, "single_match");
  assert.equal(focus.reason, "focus_code");
  assert.equal(focus.selected[0]!.code, "IH5748");
  assert.equal(focus.selected[0]!.requestedSizeStock?.size, "42");
  const empty = resolver.resolve({ query: query({ size: "42" }), found: ALL });
  assert.equal(empty.status, "not_found");
  assert.equal(empty.reason, "empty_query");
});
