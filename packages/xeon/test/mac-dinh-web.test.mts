/**
 * `/nganh/mac-dinh-web` — the INDUSTRY's default wording on a shop's website (02/10/2026, tier 2).
 *
 * What must hold: the industry comes from the shop's licence (never the body); an industry without a
 * file answers an empty set (the landing then uses the platform's neutral sentence); a broken file
 * or an industry sentence carrying one shop's number is refused at start-up with the file named.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import "./industries.mts";
import {
  INDUSTRY_DIRECTORY, IndustryDefaultsController, LicenseLedger, LicenseService, ManualClock, MemoryLogger, WebDefaultsLibrary,
  generateSigningKey, licensedIndustry, parseWebDefaults, selfCheckWebDefaultFiles
} from "@sp/xeon";

const T0 = new Date("2026-10-02T08:00:00.000Z");
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

async function build(directory: string = INDUSTRY_DIRECTORY) {
  const clock = new ManualClock(T0);
  const license = new LicenseService({ ledger: await LicenseLedger.open(), signingKey: generateSigningKey(), clock, sellableModules: ["chatbot-cskh"], coreModules: ["hang-kho"] });
  const shoes = await license.issueKey({ shop: "shop-giay", tenShop: "Shop Giày", nganh: "giay-chay", hetHan: "2027-09-15T00:00:00.000Z" });
  const pharmacy = await license.issueKey({ shop: "nha-thuoc-1", tenShop: "Nhà thuốc", nganh: "nha-thuoc", hetHan: "2027-09-15T00:00:00.000Z" });
  const shoeLanding = await license.registerLanding({ key: shoes.key, diaChi: "https://giay.test" });
  const pharmacyLanding = await license.registerLanding({ key: pharmacy.key, diaChi: "https://thuoc.test" });
  assert.ok(shoeLanding.ok && pharmacyLanding.ok);
  const controller = new IndustryDefaultsController({ library: new WebDefaultsLibrary(directory), industryOf: licensedIndustry(license), license, logger: new MemoryLogger() });
  const call = async (body: unknown, token: string | null): Promise<{ status: number; body: Body }> => {
    let status = 0;
    let out: Body = {};
    const req = { headers: token === null ? {} : { authorization: `Bearer ${token}` } } as unknown as IncomingMessage;
    const res = { writeHead(code: number) { status = code; return this; }, end(t: string) { out = t ? JSON.parse(t) : {}; } } as unknown as ServerResponse;
    assert.equal(await controller.handle(req, res, { method: "POST", path: "/nganh/mac-dinh-web", ip: "1.1.1.1", readJson: async () => body as Record<string, unknown> }), true);
    return { status, body: out };
  };
  return { call, shoeToken: shoeLanding.ok ? shoeLanding.maNhanTin : "", pharmacyToken: pharmacyLanding.ok ? pharmacyLanding.maNhanTin : "" };
}

test("a shoe shop gets its industry's wording; the industry comes from the licence", async () => {
  const { call, shoeToken } = await build();
  const r = await call({}, shoeToken);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body["nganh"], "giay-chay");
  assert.equal(r.body["noiDungWeb"]["unitName"], "đôi");
  assert.match(String(r.body["noiDungWeb"]["consultTitle"]), /\S/);
});

test("an industry without the file: an empty set, not an error (the landing uses its neutral sentence)", async () => {
  const { call, pharmacyToken } = await build();
  const r = await call({}, pharmacyToken);
  assert.deepEqual([r.status, r.body["nganh"], r.body["noiDungWeb"]], [200, "nha-thuoc", {}]);
});

test("no token 401, another shop named 403, GET refused", async () => {
  const { call, shoeToken } = await build();
  assert.equal((await call({}, null)).status, 401);
  assert.equal((await call({ tenant: "nha-thuoc-1" }, shoeToken)).status, 403);
});

test("the file is cleaned and checked: odd fields reported, one shop's number refused, start-up names the file", () => {
  const clean = parseWebDefaults({ noiDungWeb: { unitName: " đôi ", "bad key": "x", consultText: 5 } }, "nganh/x/mac-dinh-web.json");
  assert.deepEqual(clean.noiDungWeb, { unitName: "đôi" });
  assert.equal(clean.problems.length, 2);
  const shopNumber = parseWebDefaults({ noiDungWeb: { consultText: "Gọi 0968411655 để được tư vấn" } }, "w");
  assert.ok(shopNumber.problems.length > 0, "a phone number is one shop's, never an industry's");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mac-dinh-web-"));
  const nganh = path.join(root, "nganh");
  fs.mkdirSync(path.join(nganh, "my-pham"), { recursive: true });
  fs.writeFileSync(path.join(nganh, "my-pham", "bo-luat.json"), "{}", "utf8");
  fs.writeFileSync(path.join(nganh, "my-pham", "mac-dinh-web.json"), "{ khong phai json", "utf8");
  assert.throws(() => selfCheckWebDefaultFiles(nganh), /mac-dinh-web\.json/);
  assert.doesNotThrow(() => selfCheckWebDefaultFiles(INDUSTRY_DIRECTORY), "the shipped files are clean");
});
