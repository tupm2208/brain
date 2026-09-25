/**
 * 25/09/2026 — `POST /spx/ky`: Xeon signs a landing's SPX request with the developer's app; the
 * App Secret never leaves Xeon. The signature must match what SPX checks (HMAC over appId_ts_nonce_body).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { LicenseLedger, LicenseService, ManualClock, MemoryLogger, SpxController, SPX_SIGN_BUDGET, generateSigningKey } from "@sp/xeon";

const T0 = new Date("2026-09-25T03:00:00.000Z");
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads wire fields

async function build(appId = "app-1", appSecret = "bi-mat-app") {
  const clock = new ManualClock(T0);
  const license = new LicenseService({ ledger: await LicenseLedger.open(), signingKey: generateSigningKey(), clock, sellableModules: ["chatbot-cskh"], coreModules: ["hang-kho"] });
  const key = await license.issueKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2027-09-15T00:00:00.000Z", nganh: "giay-chay" });
  const landing = await license.registerLanding({ key: key.key, diaChi: "https://shop.test" });
  assert.ok(landing.ok);
  const controller = new SpxController({ license, appId, appSecret, clock, logger: new MemoryLogger() });
  const call = async (body: unknown, token: string | null = landing.ok ? landing.maNhanTin : "", path = "/spx/ky"): Promise<{ handled: boolean; status: number; body: Body }> => {
    let status = 0;
    let out: Body = {};
    const req = { headers: token === null ? {} : { authorization: `Bearer ${token}` } } as unknown as IncomingMessage;
    const res = { writeHead(code: number) { status = code; return this; }, end(t: string) { out = t ? JSON.parse(t) : {}; } } as unknown as ServerResponse;
    const handled = await controller.handle(req, res, { method: "POST", path, ip: "1.1.1.1", readJson: async () => body as Record<string, unknown> });
    return { handled, status, body: out };
  };
  return { clock, call };
}

const ts = Math.floor(T0.getTime() / 1000);

test("signs exactly what SPX checks, and never returns the secret", async () => {
  const { call } = await build();
  const body = JSON.stringify({ user_id: 123, user_secret: "cua-shop", orders: [] });
  const r = await call({ timestamp: ts, nonce: 42, body });
  assert.equal(r.status, 200);
  assert.equal(r.body["appId"], "app-1");
  assert.equal(r.body["checkSign"], crypto.createHmac("sha256", "bi-mat-app").update(`app-1_${ts}_42_${body}`, "utf8").digest("hex"));
  assert.ok(!JSON.stringify(r.body).includes("bi-mat-app"), "the app secret never leaves Xeon");
});

test("refuses a stranger, a broken request, a skewed clock; other paths pass through", async () => {
  const { call } = await build();
  assert.equal((await call({ timestamp: ts, nonce: 1, body: "{}" }, null)).status, 401);
  assert.equal((await call({ timestamp: ts, nonce: 1, body: "{}" }, "ma-la")).status, 401);
  assert.equal((await call({ timestamp: ts, nonce: 0, body: "{}" })).status, 400);
  assert.equal((await call({ timestamp: ts, nonce: 1, body: "" })).status, 400);
  assert.equal((await call({ timestamp: ts - 3600, nonce: 1, body: "{}" })).body["error"], "gio_lech");
  assert.equal((await call({}, undefined, "/khac")).handled, false);
});

test("without the developer's SPX app the door says so (503), and a shop has a budget", async () => {
  const off = await build("", "");
  const r = await off.call({ timestamp: ts, nonce: 1, body: "{}" });
  assert.equal(r.status, 503);
  assert.match(String(r.body["message"]), /SPX_APP_ID/);

  const on = await build();
  for (let i = 0; i < SPX_SIGN_BUDGET; i += 1) assert.equal((await on.call({ timestamp: ts, nonce: i + 1, body: "{}" })).status, 200);
  assert.equal((await on.call({ timestamp: ts, nonce: 1, body: "{}" })).status, 429);
  on.clock.advance(11 * 60 * 1000);
  assert.equal((await on.call({ timestamp: ts + 660, nonce: 1, body: "{}" })).status, 200, "a new window opens");
});
