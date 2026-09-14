/**
 * Tests for the CONTRACT.
 *
 * The goal is not coverage but KEEPING THE RULES: every architectural rule that was decided has
 * a test that breaks the moment the rule is violated. Several tests DELIBERATELY patch the
 * registries and restore them afterwards, proving the checks catch real violations rather than
 * passing only because today's data happens to be valid.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "@sp/contract";

/** Temporarily replaces a property, restoring it even when the callback throws. */
function withPatched<T extends object>(target: T, key: keyof T, value: unknown, run: () => void): void {
  const had = Object.prototype.hasOwnProperty.call(target, key);
  const old = target[key];
  (target as Record<string | number | symbol, unknown>)[key] = value;
  try {
    run();
  } finally {
    if (had) target[key] = old;
    else delete (target as Record<string | number | symbol, unknown>)[key];
  }
}

const sampleLicense = (over: Partial<C.LicensePayload> = {}): C.LicensePayload => ({
  tenant: C.asTenantId("t1"), tenantName: "Shop thu", machine: C.asMachineId("m1"), packId: "giay-chay",
  modules: [], seats: 3,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  minContract: "0.1.0", issuedAt: new Date(Date.now() - 86400000).toISOString(),
  ...over
});

const cleanItem = (): C.CatalogItem & Record<string, unknown> => ({
  tenant: C.asTenantId("t1"), id: C.asItemId("i1"), code: "IE0000", name: "Adizero Boston 13", brand: "adidas",
  category: "giay chay", variantAxis: "size",
  variants: [{ id: C.asVariantId("v1"), label: "42", price: 3190000, sort: 42 }],
  attributes: { gender: "nam" }, images: ["a.jpg"],
  url: "https://toprun.site/p/ie0000", updatedAt: "2026-09-09T00:00:00.000Z"
});

// ===========================================================================
// Decided structure
// ===========================================================================

test("selfCheck: every architectural self-check passes", () => {
  assert.doesNotThrow(() => C.selfCheck());
});

test("three groups, thirteen modules, under the ceiling of 15", () => {
  assert.equal(C.MODULE_IDS.length, 13);
  assert.ok(C.MODULE_IDS.length <= C.MODULE_CEILING);
  assert.deepEqual([...C.MODULE_GROUPS], ["vanhanh", "content", "chatbot"]);
  assert.equal(C.modulesOfGroup("vanhanh").length, 7);
  assert.equal(C.modulesOfGroup("content").length, 3);
  assert.equal(C.modulesOfGroup("chatbot").length, 3);
});

test("the three core modules are as decided", () => {
  assert.deepEqual([...C.CORE_MODULE_IDS].sort(), ["don-khach", "hang-kho", "lien-ket"]);
});

// ===========================================================================
// Rule 1: peer modules never call each other directly
// ===========================================================================

test("no module depends on a non-core module", () => {
  for (const id of C.MODULE_IDS) {
    for (const dep of C.MODULES[id].dependsOn) {
      assert.ok(C.MODULES[dep].core, `"${id}" depends directly on "${dep}", which is not core.`);
    }
  }
});

test("no module has a source dependency across machines", () => {
  for (const id of C.MODULE_IDS) {
    for (const dep of C.MODULES[id].dependsOn) {
      assert.equal(
        C.MODULES[dep].runsOn, C.MODULES[id].runsOn,
        `"${id}" (${C.MODULES[id].runsOn}) depends on "${dep}" (${C.MODULES[dep].runsOn}): two machines.`
      );
    }
  }
});

test("CAUGHT: peer dependency", () => {
  withPatched(C.MODULES["xuong-video"], "dependsOn", ["van-chuyen"], () => {
    assert.throws(() => C.assertModuleGraph(), /khong phai manh loi/);
  });
});

test("CAUGHT: cross-machine dependency", () => {
  withPatched(C.MODULES["chatbot-cskh"], "dependsOn", ["hang-kho"], () => {
    assert.throws(() => C.assertModuleGraph(), /hai may khac nhau/i);
  });
});

test("CAUGHT: cycle between two core modules", () => {
  // Both are core and on the same machine, so the other two checks let it through; only the
  // cycle check catches it. That check did not exist at first.
  withPatched(C.MODULES["hang-kho"], "dependsOn", ["don-khach"], () => {
    assert.throws(() => C.assertModuleGraph(), /Vong tron phu thuoc/);
  });
});

test("CAUGHT: a module declaring another module's tool", () => {
  withPatched(C.MODULES["tien"], "tools", ["payment.status", "order.approve", "shipment.track"], () => {
    assert.throws(() => C.assertModuleGraph(), /so dang ky noi cong cu do thuoc/);
  });
});

test("CAUGHT: an event emitted that nobody listens to", () => {
  withPatched(C.MODULES["tien"], "listens", ["order.paid", "order.cancelled"], () => {
    assert.throws(() => C.assertModuleGraph(), /partner\.out_of_stock/);
  });
});

test("the refund chain is not broken at its first link", () => {
  assert.ok(
    C.MODULES["tien"].listens.includes("partner.out_of_stock"),
    "The money module must listen to partner.out_of_stock or the refund chain breaks immediately."
  );
});

// ===========================================================================
// Rule 2: the bot never moves money
// ===========================================================================

test("no bot tool carries the money effect", () => {
  for (const name of C.TOOL_NAMES) {
    if (C.TOOLS[name].audience !== "bot") continue;
    assert.notEqual(C.TOOLS[name].effect, "money", `Tool "${name}" moves money but is open to the bot.`);
  }
  assert.doesNotThrow(() => C.assertToolsSafeForBot());
});

test("spending money STILL has a declared place: for humans, not the bot", () => {
  assert.equal(C.TOOLS["order.approve"].effect, "money");
  assert.equal(C.TOOLS["order.approve"].audience, "human");
  assert.ok(!C.BOT_TOOL_NAMES.includes("order.approve"));
});

test("CAUGHT: a wrong effect declaration used to dodge the gate", () => {
  // A refund tool declared as "read": exactly the trick the first version missed because it
  // trusted the declaration alone.
  withPatched(C.TOOLS as Record<string, C.ToolMeta>, "payment.refund",
    { name: "payment.refund", module: "tien", effect: "read", audience: "bot", describe: "fake" },
    () => {
      assert.throws(() => C.assertToolsSafeForBot(), /dong tu tieu tien/);
    });
});

test("every tool belongs to a real module, in both directions", () => {
  for (const name of C.TOOL_NAMES) {
    const owner = C.TOOLS[name].module;
    assert.ok(C.isModuleId(owner), `Tool "${name}" points at an unknown module.`);
    assert.ok(C.MODULES[owner].tools.includes(name), `Module "${owner}" does not list "${name}".`);
  }
});

// ===========================================================================
// Rule 3: Xeon holds no customer data and no cost prices
// ===========================================================================

test("a clean catalog passes the guard", () => {
  assert.deepEqual(C.findCatalogIssues(cleanItem()), []);
  assert.doesNotThrow(() => C.assertCatalogClean([cleanItem(), cleanItem()]));
});

test("BLOCKED: a phone number inside a free attribute", () => {
  // The real leak: the old version only read KEYS, so this passed straight to Xeon.
  const item = cleanItem();
  item.attributes["note"] = "Chi Lan 0968411655, 12 Hoai Duc, Ha Noi";
  const issues = C.findCatalogIssues(item);
  assert.ok(issues.some((i) => i.kind === "phone_in_value"), JSON.stringify(issues));
  assert.throws(() => C.assertCatalogClean(item), /not clean/);
});

test("BLOCKED: a phone number hidden in an image name, and an e-mail", () => {
  const a = cleanItem();
  a.images = ["0968411655 - so nha 12 duong X.jpg"];
  assert.ok(C.findCatalogIssues(a).some((i) => i.kind === "phone_in_value"));

  const b = cleanItem();
  b.attributes["lienHe"] = "chi.lan@gmail.com";
  assert.ok(C.findCatalogIssues(b).some((i) => i.kind === "email_in_value"));
});

test("BLOCKED: unknown fields (cost price under any name)", () => {
  for (const key of ["cost", "costPrice", "giaNhap", "saleFilePrice", "margin", "psid", "customerPhone"]) {
    const item = cleanItem();
    item[key] = 1;
    const issues = C.findCatalogIssues(item);
    assert.ok(issues.some((i) => i.kind === "unknown_key"), `Field "${key}" must be blocked as foreign to the catalog.`);
  }
});

test("BLOCKED: a JSON string is not considered clean", () => {
  assert.throws(() => C.assertCatalogClean(JSON.stringify(cleanItem())), /not clean/);
  assert.throws(() => C.assertCatalogClean(null), /not clean/);
  assert.throws(() => C.assertCatalogClean(42), /not clean/);
});

test("NOT OVER-BLOCKED: other industries can still use free attributes", () => {
  // The old version blocked `hotel` via /tel\b/, `awards`/`rewardPoints` via /ward/, and the
  // warehouse province via /province/. A multi-industry platform would loosen such a gate.
  const item = cleanItem();
  item.attributes = {
    hotel: "Muong Thanh",
    khachSan: "co",
    soKhachToiDa: "4",
    province: "Lam Dong",
    awards: "Giai thuong 2025",
    rewardPoints: "120",
    streetStyle: "yes",
    customerRating: "4.8"
  };
  assert.deepEqual(C.findCatalogIssues(item), []);
});

// ===========================================================================
// Rule 4: a disabled module's tools vanish for the bot
// ===========================================================================

test("a disabled module's tools vanish for the bot", () => {
  const minimal = C.enabledTools(sampleLicense());
  assert.ok(minimal.includes("stock.lookup"));
  assert.ok(!minimal.includes("shipment.track"), "Shipping not purchased yet the bot can track shipments.");

  const withShipping = C.enabledTools(sampleLicense({ modules: ["van-chuyen"] }));
  assert.ok(withShipping.includes("shipment.track"));
});

test("an expired licence leaves the bot with no tools", () => {
  const expired = sampleLicense({ expiresAt: "2020-01-01T00:00:00.000Z", modules: ["van-chuyen", "tien"] });
  assert.equal(C.isExpired(expired), true);
  assert.deepEqual(C.enabledTools(expired), [], "Subscription ended yet the tools remain.");
});

test("HUMAN tools never leak into the bot's list", () => {
  const full = C.enabledTools(sampleLicense({ modules: ["tien"] }));
  assert.ok(full.includes("payment.status"));
  assert.ok(!full.includes("order.approve"));
});

test("an unknown module id in a licence is named, not swallowed", () => {
  const issues = C.licenseIssues(sampleLicense({ modules: ["vanchuyen" as C.ModuleId] }));
  assert.ok(issues.some((i) => i.kind === "unknown_module" && i.detail === "vanchuyen"));
});

test("a licence issued in the future and a broken date are both reported", () => {
  assert.ok(C.licenseIssues(sampleLicense({ issuedAt: "2999-01-01T00:00:00.000Z" }))
    .some((i) => i.kind === "not_yet_valid"));
  assert.ok(C.licenseIssues(sampleLicense({ expiresAt: "khong-phai-ngay" }))
    .some((i) => i.kind === "bad_date"));
});

test("the licence signature has a stable canonical serialisation", () => {
  const a = sampleLicense({ modules: ["tien", "van-chuyen"] });
  const b = { ...sampleLicense({ modules: ["van-chuyen", "tien"] }), issuedAt: a.issuedAt, expiresAt: a.expiresAt };
  assert.equal(C.canonicalLicenseJSON(a), C.canonicalLicenseJSON(b),
    "Reordering the module list changed the signature, so a valid licence would be refused.");
});

// ===========================================================================
// Money: a single origin
// ===========================================================================

test("money on an order goes through a single origin", () => {
  const m = C.moneyOnOrder({ total: 3190000, paid: 1000000 });
  assert.deepEqual(m, { total: 3190000, paid: 1000000, remaining: 2190000, cod: 0 });

  assert.equal(C.moneyOnOrder({ total: 100, paid: 500 }).remaining, 0, "Remaining is never negative.");
  assert.equal(C.moneyOnOrder({ total: 100, paid: 100 }).remaining, 0);
  assert.equal(C.isSettled(C.moneyOnOrder({ total: 100, paid: 100 })), true);

  const cod = C.moneyOnOrder({ total: 500000, paid: 100000, isCod: true });
  assert.equal(cod.cod, 400000);

  assert.equal(C.moneyOnOrder({ total: "rac" }).total, 0);
  assert.equal(C.moneyOnOrder({ total: 100.6 }).total, 101, "Money is always an integer.");
});

test("customer money formatting: empty for non-numbers, sign kept, Vietnamese thousands separator", () => {
  assert.equal(C.formatCustomerMoney(NaN), "");
  assert.equal(C.formatCustomerMoney(Infinity), "");
  assert.equal(C.formatCustomerMoney(-500000), "-500.000đ");
  assert.equal(C.formatCustomerMoney(0), "0đ");
  assert.equal(C.formatCustomerMoney(3190000), "3.190.000đ");
});

test("every event in EventMap has a name in the registry", () => {
  assert.equal(C.EVENT_NAMES.length, 9);
  assert.ok(C.isEventName("order.paid"));
  assert.ok(!C.isEventName("constructor"));
});

// ===========================================================================
// Tool input / output shape validation at the network edge
// ===========================================================================

test("tool input validation names the missing field", () => {
  assert.equal(C.validateToolInput("stock.lookup", {}), "stock.lookup needs 'code' or 'itemId'");
  assert.equal(C.validateToolInput("stock.lookup", { code: "X" }), null);
  assert.equal(C.validateToolInput("policy.get", { topic: "" }), "'topic' is empty");
  assert.equal(C.validateToolInput("order.draft", { conversationId: "c", lines: [{ itemId: "i", variantId: "v" }] }), "lines[0]: missing 'qty'");
  assert.equal(C.validateToolInput("catalog.search", "x"), "input must be an object");
});

test("tool output validation checks the inside, not only the envelope", () => {
  assert.equal(C.validateToolOutput("stock.lookup", { asOf: "t", truncated: false, rows: [{ variantLabel: "42", price: 1, warehouseId: "w" }] }), "rows[0]: missing 'qty'");
  assert.equal(C.validateToolOutput("stock.lookup", { asOf: "t", truncated: false, rows: ["rac"] }), "rows[0] must be an object");
  assert.equal(C.validateToolOutput("order.lookup", { orders: [{ orderId: "o", status: "x", lines: [] }] }), "orders[0]: missing 'money'");
  assert.equal(C.validateToolOutput("policy.get", { found: true, text: "ok" }), null);
});
