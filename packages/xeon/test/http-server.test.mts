/**
 * The Xeon HTTP surface over a real socket (port 0): licence doors and `/tin-den` with private inbox tokens.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./industries.mts";
import {
  BrainService, HealthController, InboundController, LicenseController, LicenseLedger, LicenseService, ManualClock,
  MemoryLogger, createXeonServer, generateSigningKey, verifyTicket, type InboundMessageBody, type InboundResult
} from "@sp/xeon";

const T0 = new Date("2026-09-14T08:00:00.000Z");
const MODULES = ["hang-kho", "don-khach", "gian-hang", "hop-thu", "chatbot-cskh"];
const CORE = ["hang-kho", "don-khach", "gian-hang"];
const MACHINE = { maMay: "abcdef0123456789abcdef", tenMay: "may ban hang" };

type Handler = (message: InboundMessageBody & { tenant: string }) => Promise<InboundResult>;
const ANSWER_EVERYTHING: Handler = async () => ({ daTraLoi: true, hanhDong: "send", traLoi: "" });

async function startServer({ handleInbound = ANSWER_EVERYTHING, sharedToken = "" }: {
  handleInbound?: Handler; sharedToken?: string;
} = {}) {
  const clock = new ManualClock(T0);
  const signingKey = generateSigningKey();
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey, clock, xeonAddress: "https://xeon.test", sellableModules: MODULES, coreModules: CORE });
  const logger = new MemoryLogger();
  const server = createXeonServer({
    controllers: [
      new HealthController(license, clock),
      new LicenseController(license, logger, clock),
      new InboundController({ brain: { handleInbound }, license, sharedToken, logger })
    ]
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const call = async (path: string, { method = "GET", body, token }: { method?: string; body?: unknown; token?: string } = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
    const response = await fetch(`${origin}${path}`, init);
    return { status: response.status, body: await response.json().catch(() => null) as Record<string, unknown> | null };
  };
  return { call, license, signingKey, clock, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("/health is alive; licence doors: public key, check, duty, leave, landing registration", async () => {
  const { call, license, signingKey, clock, close } = await startServer();
  try {
    const health = await call("/health");
    assert.equal(health.status, 200);
    assert.equal(health.body!["soShop"], 0);

    const publicKey = await call("/license/khoa-cong");
    assert.equal(publicKey.body!["keyId"], signingKey.keyId);

    const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });

    const wrong = await call("/license/kiem", { method: "POST", body: { key: "TR-AAAA-AAAA-AAAA-AAAA", ...MACHINE } });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body!["viSao"], "key_khong_co");

    const ok = await call("/license/kiem", { method: "POST", body: { key, ...MACHINE } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body!["truc"], true);
    assert.equal(ok.body!["diaChiLanding"], "", "landing not registered yet");
    const d = verifyTicket(String(ok.body!["ve"]), { publicKeyForKeyId: () => signingKey.khoaCongPem, now: clock.now() });
    assert.ok(d.hopLe);
    assert.equal(d.than.maMay, MACHINE.maMay);

    const duty = await call("/license/truc", { method: "POST", body: { key, maMay: MACHINE.maMay } });
    assert.deepEqual(duty.body, { ok: true, truc: true });

    const leave = await call("/license/roi", { method: "POST", body: { key, maMay: MACHINE.maMay } });
    assert.equal(leave.status, 200);
    assert.equal(leave.body!["conLai"], 0);
    assert.equal((await call("/license/roi", { method: "POST", body: { key, maMay: MACHINE.maMay } })).status, 403);
    assert.equal((await call("/license/kiem", { method: "POST", body: { key, ...MACHINE } })).status, 200, "can rejoin after leaving");

    const registered = await call("/license/landing-dang-ky", { method: "POST", body: { key, diaChi: "https://toprun.site" } });
    assert.equal(registered.status, 200);
    assert.equal(registered.body!["khoaCongPem"], signingKey.khoaCongPem);
    assert.equal(registered.body!["diaChiXeon"], "https://xeon.test");
    assert.match(String(registered.body!["maNhanTin"]), /^nt-/);

    const again = await call("/license/kiem", { method: "POST", body: { key, ...MACHINE } });
    assert.equal(again.body!["diaChiLanding"], "https://toprun.site", "after registration the console receives the landing address");

    assert.equal((await call("/license/kiem", { method: "POST", body: "khong json" })).status, 400);
    assert.equal((await call("/license/kiem", { method: "POST", body: [1] })).status, 400);
    assert.equal((await call("/license/khong-co", { method: "POST", body: {} })).status, 404);
    assert.equal((await call("/license/kiem")).status, 404, "GET on a POST door");
  } finally { await close(); }
});

test("/tin-den: the shop comes from the inbox token; unknown token 401; a different tenant in the body 403; missing fields 400", async () => {
  const received: (InboundMessageBody & { tenant: string })[] = [];
  const { call, license, close } = await startServer({
    handleInbound: async (message) => { received.push(message); return { daTraLoi: true, hanhDong: "send", traLoi: "" }; }
  });
  try {
    const a = await license.issueKey({ shop: "shop-a", tenShop: "A", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
    const b = await license.issueKey({ shop: "shop-b", tenShop: "B", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
    const registeredA = await license.registerLanding({ key: a.key, diaChi: "https://a.vn" });
    await license.registerLanding({ key: b.key, diaChi: "https://b.vn" });
    assert.ok(registeredA.ok);
    const tokenA = registeredA.maNhanTin;

    assert.equal((await call("/tin-den", { method: "POST", body: { nguoi: "k", chu: "hi" } })).status, 401, "no token");
    assert.equal((await call("/tin-den", { method: "POST", body: { nguoi: "k", chu: "hi" }, token: "nt-la" })).status, 401, "unknown token");

    const ok = await call("/tin-den", { method: "POST", body: { nguoi: "k1", chu: "con hang khong" }, token: tokenA });
    assert.equal(ok.status, 200);
    assert.equal(received[0]!.tenant, "shop-a", "the tenant comes from the token; the body need not say");

    // Landing A claims to be shop-b: impersonation -> 403, not handled.
    const impersonation = await call("/tin-den", { method: "POST", body: { tenant: "shop-b", nguoi: "k1", chu: "x" }, token: tokenA });
    assert.equal(impersonation.status, 403);
    assert.equal(impersonation.body!["error"], "tenant_khong_khop");
    assert.equal(received.length, 1);

    const matching = await call("/tin-den", { method: "POST", body: { tenant: "shop-a", nguoi: "k1", chu: "x" }, token: tokenA });
    assert.equal(matching.status, 200, "the right tenant in the body still passes");

    assert.equal((await call("/tin-den", { method: "POST", body: { chu: "x" }, token: tokenA })).status, 400);
    assert.equal((await call("/tin-den", { method: "POST", body: { nguoi: "k", chu: 5 }, token: tokenA })).status, 400);
  } finally { await close(); }
});

test("the SHARED token (legacy trial mode) still works and the tenant comes from the body", async () => {
  const received: (InboundMessageBody & { tenant: string })[] = [];
  const { call, close } = await startServer({
    sharedToken: "ma-chung-thu",
    handleInbound: async (message) => { received.push(message); return { daTraLoi: false, viSao: "khong_phuc_vu_shop" }; }
  });
  try {
    const ok = await call("/tin-den", { method: "POST", body: { tenant: "toprun", nguoi: "k", chu: "hi" }, token: "ma-chung-thu" });
    assert.equal(ok.status, 200);
    assert.equal(received[0]!.tenant, "toprun");
    assert.equal((await call("/tin-den", { method: "POST", body: { nguoi: "k", chu: "hi" }, token: "ma-chung-thu" })).status, 400, "shared token without a tenant");
  } finally { await close(); }
});

test("the licence doors are rate limited: 429 after 60 calls in 15 minutes, open again afterwards", async () => {
  const { call, clock, close } = await startServer();
  try {
    for (let i = 0; i < 60; i += 1) assert.equal((await call("/license/khoa-cong")).status, 200);
    assert.equal((await call("/license/khoa-cong")).status, 429);
    clock.advance(15 * 60 * 1000 + 1);
    assert.equal((await call("/license/khoa-cong")).status, 200);
  } finally { await close(); }
});

test("licensed brain: serves only active shops and calls the landing with a Xeon-signed service ticket", async () => {
  const clock = new ManualClock(T0);
  const signingKey = generateSigningKey();
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey, clock, sellableModules: MODULES, coreModules: CORE });
  const calls: { url: string; token: string }[] = [];
  const fetchFake = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, token: String(init.headers["Authorization"] || "").replace(/^Bearer /, "") });
    return { ok: true, status: 200, json: async () => ({ ok: true, data: { items: [] } }) };
  };
  const logger = new MemoryLogger();
  const brain = new BrainService({ license, fetch: fetchFake, logger, clock });

  const before = await brain.handleInbound({ tenant: "toprun", kenh: "facebook", nguoi: "k", chu: "hi" });
  assert.equal((before as { viSao: string }).viSao, "khong_phuc_vu_shop");
  assert.match(logger.warnings.at(-1)!, /khong_co_key/);

  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://toprun.site" });
  const result = await brain.handleInbound({ tenant: "toprun", kenh: "facebook", nguoi: "k", chu: "hi" });
  assert.equal(typeof result.daTraLoi, "boolean");
  assert.ok(calls.length > 0, "the landing was called");
  assert.ok(calls.every((c) => c.url.startsWith("https://toprun.site/")));
  const d = verifyTicket(calls[0]!.token, { publicKeyForKeyId: () => signingKey.khoaCongPem, now: clock.now() });
  assert.ok(d.hopLe);
  assert.equal(d.than.vai, "dich-vu");
  assert.equal(d.than.shop, "toprun");

  // The service ticket is reused within the hour and renewed near expiry.
  const firstTicket = calls[0]!.token;
  await brain.handleInbound({ tenant: "toprun", kenh: "facebook", nguoi: "k", chu: "hi" });
  assert.equal(calls.at(-1)!.token, firstTicket, "reused while far from expiry");
  clock.advance(56 * 60 * 1000);
  await brain.handleInbound({ tenant: "toprun", kenh: "facebook", nguoi: "k", chu: "hi" });
  assert.notEqual(calls.at(-1)!.token, firstTicket, "renewed with less than 5 minutes left");
});
