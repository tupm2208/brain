/**
 * The in-memory catalog on Xeon: the ONLY place a catalog enters the brain, with both guards installed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import type { CatalogItem } from "@sp/contract";
import { TENANT, ask, clonePack, fakePorts, row } from "./fixtures.mts";

/** A catalog item with string ids; the cast stands in for the branded ids the real loader would carry. */
const item = (over: Record<string, unknown> = {}): CatalogItem => ({
  tenant: TENANT, id: "i1", code: "IE0000", name: "Adizero Boston 13", brand: "adidas",
  variantAxis: "size",
  variants: [{ id: "v43", label: "43", price: 3290000, sort: 43 }, { id: "v42", label: "42", price: 3190000, sort: 42 }],
  attributes: { "màu": "Đen" }, images: [], updatedAt: "2026-09-10T00:00:00.000Z", ...over
} as unknown as CatalogItem);

test("catalog: loading passes the DECISION 3 guard on the RECEIVING end; a phone number rejects the WHOLE load and the old catalog stays", async () => {
  const catalog = B.createInMemoryCatalog();
  catalog.load(TENANT, B.runningShoesPack, [item()]);
  assert.equal(await catalog.size(TENANT), 1);
  assert.throws(
    () => catalog.load(TENANT, B.runningShoesPack, [item({ id: "i2", code: "OK" }),
      item({ id: "i3", code: "X", attributes: { note: "Chị Lan 0968411655" } })]),
    /QUYET DINH 3/
  );
  assert.equal(await catalog.size(TENANT), 1, "A failed load replaced the old catalog: half a load slipped in.");
  assert.equal((await catalog.search(TENANT, "adizero boston 13", 5))[0]!.code, "IE0000");
});

test("catalog: another merchant's item, or two items with one id, rejects the whole load", () => {
  const catalog = B.createInMemoryCatalog();
  assert.throws(() => catalog.load(TENANT, B.runningShoesPack, [item(), item({ id: "i2", tenant: "shopB" })]), /shop "shopB"/);
  assert.throws(() => catalog.load(TENANT, B.runningShoesPack, [item(), item({ code: "KHAC" })]), /cung ma "i1"/);
  assert.equal(catalog.fillerWordCollisions(TENANT).length, 0);
});

test("catalog: filler collisions are REPORTED and logged, the load still succeeds (the fault is in the pack, not the merchant)", async () => {
  const lines: string[] = [];
  const catalog = B.createInMemoryCatalog({ log: (line) => lines.push(line) });
  const bad = clonePack(B.runningShoesPack);
  bad.lexicon.fillerWords = [...bad.lexicon.fillerWords!, "moi"];
  const result = catalog.load(TENANT, bad, [item(), item({ id: "i2", code: "GM1", name: "Giày mọi da bò" })]);
  assert.deepEqual(result, { itemCount: 2, fillerWordCollisions: ["moi"] });
  assert.deepEqual(catalog.fillerWordCollisions(TENANT), ["moi"]);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /\[muc-luc\] t1: .*"giay-chay".*: moi/);
  assert.equal(await catalog.size(TENANT), 2, "One item name cost the merchant the whole catalog.");
  // Reload with the fixed pack: no collisions, and the old list is gone.
  const clean = catalog.load(TENANT, B.runningShoesPack, [item({ id: "i2", code: "GM1", name: "Giày mọi da bò" })]);
  assert.deepEqual(clean, { itemCount: 1, fillerWordCollisions: [] });
  assert.deepEqual(catalog.fillerWordCollisions(TENANT), []);
  assert.equal(lines.length, 1);
});

test("catalog: search ranks by coverage, ties keep warehouse order, respects the limit, and never crosses merchants", async () => {
  const catalog = B.createInMemoryCatalog();
  catalog.load(TENANT, B.runningShoesPack, [
    item({ id: "i1", code: "A1", name: "Pegasus 41" }),
    item({ id: "i2", code: "A2", name: "Pegasus 40" }),
    item({ id: "i3", code: "A3", name: "Adizero Boston 13", variants: [] }),
    item({ id: "i4", code: "A4", name: "Pegasus 41 Premium" })
  ]);
  catalog.load("shopB" as never, B.runningShoesPack, [item({ tenant: "shopB", id: "i1", code: "B1", name: "Pegasus 41" })]);
  const r = await catalog.search(TENANT, "pegasus 41 con khong", 10);
  assert.deepEqual(r.map((x) => x.code), ["A1", "A4", "A2"], "A1 full match; A4 and A2 partial, A4 first because 2/3 > 1/2.");
  assert.deepEqual((await catalog.search(TENANT, "pegasus", 10)).map((x) => x.code), ["A1", "A2", "A4"], "Ties keep warehouse order.");
  assert.deepEqual((await catalog.search(TENANT, "pegasus", 2)).map((x) => x.code), ["A1", "A2"]);
  assert.deepEqual(await catalog.search(TENANT, "pegasus", 0), []);
  assert.deepEqual(await catalog.search(TENANT, "!!!", 5), []);
  assert.deepEqual(await catalog.search("shopC" as never, "pegasus", 5), []);
  assert.equal(await catalog.size("shopC" as never), 0);
  assert.deepEqual((await catalog.search("shopB" as never, "pegasus", 5)).map((x) => x.code), ["B1"]);
  // Compact form: LOWEST price and variant count; no variants means price 0 like the merchant server.
  const a1 = r[0]!;
  assert.deepEqual([a1.priceFrom, a1.variantCount, a1.brand], [3190000, 2, "adidas"]);
  assert.equal((await catalog.search(TENANT, "boston", 5))[0]!.priceFrom, 0);
  // Results are COPIES: mutating one does not corrupt the store.
  a1.name = "hong";
  assert.equal((await catalog.search(TENANT, "pegasus 41", 1))[0]!.name, "Pegasus 41");
  catalog.drop(TENANT);
  assert.equal(await catalog.size(TENANT), 0);
  assert.equal(await catalog.size("shopB" as never), 1);
  // Search by CODE (merchants type codes every day), and `url` travels with the compact form.
  catalog.load(TENANT, B.runningShoesPack, [item({ id: "i1", code: "A1", name: "Pegasus 41", url: "https://shop/a1" }),
    item({ id: "i2", code: "A2", name: "Pegasus 40" })]);
  const byCode = await catalog.search(TENANT, "con a2 khong", 5);
  assert.deepEqual(byCode.map((x) => x.code), ["A2"]);
  assert.equal((await catalog.search(TENANT, "pegasus 41", 1))[0]!.url, "https://shop/a1");
  // Coverage is measured on the ITEM NAME, not the query: a short fully covered name outranks a
  // long partially covered one, the same direction as the merchant server's search.
  catalog.load(TENANT, B.runningShoesPack, [item({ id: "i1", code: "D1", name: "Pegasus 41 Premium Gore Tex" }),
    item({ id: "i2", code: "D2", name: "Pegasus" })]);
  assert.deepEqual((await catalog.search(TENANT, "pegasus 41 con khong", 5)).map((x) => x.code), ["D2", "D1"],
    "D2 (2 tokens, 1/2 covered) must come before D1 (6 tokens, 2/6 covered).");
});

test("catalog: the engine recognises items through the REAL catalog, not only the test fake", async () => {
  const catalog = B.createInMemoryCatalog();
  catalog.load(TENANT, B.runningShoesPack, [item(), item({ id: "i2", code: "PG41", name: "Pegasus 41" })]);
  const f = fakePorts({ rows: [row("42", 3)] });
  f.ports.catalog = catalog;
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.equal(r.itemCode, "IE0000");
  assert.match(r.reply, /Còn 3 đôi size 42/);
});
