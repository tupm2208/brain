/**
 * The developer's Meta app on Xeon (decided 15/09/2026): one webhook for every merchant's pages,
 * routed by page id to each merchant's landing. Real socket, fake Meta, fake landings.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HealthController, LandingGateway, LicenseLedger, LicenseService, ManualClock, MemoryLogger, MetaController, MetaForwarder,
  MetaGraphClient, PENDING_FILE, createXeonServer, generateSigningKey, verifyTicket, type FetchLike
} from "@sp/xeon";

const T0 = new Date("2026-09-15T08:00:00.000Z");
const MODULES = ["hang-kho", "don-khach", "gian-hang", "hop-thu", "chatbot-cskh"];
const CORE = ["hang-kho", "don-khach", "gian-hang"];
const APP_SECRET = "bi-mat-app-meta-thu";
const VERIFY = "chuoi-xac-minh-thu";
/** The page tokens fake Meta knows: token -> page. */
const META_PAGES: Record<string, { id: string; name: string }> = {
  "tk-trang-a": { id: "trang-a", name: "Trang A" },
  "tk-trang-b": { id: "trang-b", name: "Trang B" }
};

interface LandingCall { origin: string; path: string; body: Record<string, unknown>; token: string }

async function setup({ appSecret = APP_SECRET, dataDirectory = null as string | null } = {}) {
  const clock = new ManualClock(T0);
  const signingKey = generateSigningKey();
  const license = new LicenseService({ ledger: await LicenseLedger.open(), signingKey, clock, xeonAddress: "https://xeon.test", sellableModules: MODULES, coreModules: CORE });
  const logger = new MemoryLogger();
  const shopA = await license.issueKey({ shop: "shop-a", tenShop: "Shop A", manh: ["hop-thu", "chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  const shopB = await license.issueKey({ shop: "shop-b", tenShop: "Shop B", manh: ["hop-thu"], hetHan: "2027-01-01T00:00:00.000Z" });
  const regA = await license.registerLanding({ key: shopA.key, diaChi: "https://a.test" });
  const regB = await license.registerLanding({ key: shopB.key, diaChi: "https://b.test" });
  if (!regA.ok || !regB.ok) throw new Error("landing registration failed");

  const landingCalls: LandingCall[] = [];
  const graphCalls: string[] = [];
  const network = { down: (_origin: string): boolean => false };
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.hostname === "graph.facebook.com") {
      graphCalls.push(`${init.method} ${u.pathname}`);
      const page = META_PAGES[u.searchParams.get("access_token") ?? ""];
      if (!page) return reply({ error: { message: "Invalid OAuth access token." } }, 400);
      if (u.pathname.endsWith("/me")) return reply({ id: page.id, name: page.name });
      if (u.pathname.endsWith("/subscribed_apps")) return reply({ success: true });
      return reply({ error: { message: "khong biet" } }, 404);
    }
    if (network.down(u.origin)) throw new Error("mat mang");
    landingCalls.push({ origin: u.origin, path: u.pathname, body: JSON.parse(String(init.body)) as Record<string, unknown>, token: String(init.headers["Authorization"] ?? "").replace(/^Bearer /, "") });
    return reply({ ok: true, daNhan: 1, trung: 0 });
  };

  const forwarder = new MetaForwarder({ license, clock, logger, dataDirectory, fetch });
  const server = createXeonServer({
    controllers: [
      new HealthController(license, clock, () => ({ meta: { soTrang: license.pageCount(), goiDangCho: forwarder.pendingCount() } })),
      new MetaController({ license, forwarder, graph: new MetaGraphClient({ fetch }), appSecret, verifyToken: VERIFY, logger })
    ]
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (p: string, { method = "GET", body, token, headers = {} }: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) => {
    const h: Record<string, string> = { "Content-Type": "application/json", ...headers };
    if (token) h["Authorization"] = `Bearer ${token}`;
    const init: RequestInit = { method, headers: h };
    if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
    // The real network, to Xeon — `fetch` in this scope is the fake Meta/landing.
    const real = await globalThis.fetch(`${origin}${p}`, init);
    const text = await real.text();
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
    return { status: real.status, text, body: json };
  };
  return {
    call, license, signingKey, clock, logger, forwarder, landingCalls, graphCalls, network,
    inboxA: regA.maNhanTin, inboxB: regB.maNhanTin,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

const signed = (raw: string, secret = APP_SECRET) => ({ "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex") });
const packet = (...entries: unknown[]) => JSON.stringify({ object: "page", entry: entries });
const message = (pageId: string, sender: string, text: string) => ({
  id: pageId, time: 1789459200000,
  messaging: [{ sender: { id: sender }, recipient: { id: pageId }, timestamp: 1789459200000, message: { mid: `m.${pageId}.${sender}`, text } }]
});

test("Meta confirms the address with the verify token; a wrong token is 403", async () => {
  const x = await setup();
  try {
    const ok = await x.call(`/meta/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=98765`);
    assert.equal(ok.status, 200);
    assert.equal(ok.text, "98765");
    assert.equal((await x.call("/meta/webhook?hub.mode=subscribe&hub.verify_token=sai&hub.challenge=1")).status, 403);
  } finally { await x.close(); }
});

test("without the app secret the webhook refuses (503); a wrong signature is 401; not a page packet is 400", async () => {
  const unset = await setup({ appSecret: "" });
  try {
    assert.equal((await unset.call("/meta/webhook", { method: "POST", body: packet(), headers: signed(packet()) })).status, 503);
  } finally { await unset.close(); }

  const x = await setup();
  try {
    const raw = packet(message("trang-a", "khach-1", "con size 42"));
    assert.equal((await x.call("/meta/webhook", { method: "POST", body: raw, headers: signed(raw, "khoa-cua-ke-gia") })).status, 401);
    const insta = JSON.stringify({ object: "instagram", entry: [] });
    assert.equal((await x.call("/meta/webhook", { method: "POST", body: insta, headers: signed(insta) })).status, 400);
    assert.equal(x.landingCalls.length, 0, "nothing reaches a landing without a valid packet");
  } finally { await x.close(); }
});

test("a landing connects its pages: Meta must confirm each token, and another shop cannot take a connected page", async () => {
  const x = await setup();
  try {
    assert.equal((await x.call("/meta/trang", { method: "POST", body: { trang: [] } })).status, 401, "the private inbox token is required");

    const a = await x.call("/meta/trang", {
      method: "POST", token: x.inboxA,
      body: { dangKyNhanTin: true, trang: [{ ma: "trang-a", token: "tk-trang-a" }, { ma: "trang-b", token: "tk-trang-a" }] }
    });
    assert.equal(a.status, 200);
    const outcomes = a.body!["ketQua"] as Record<string, unknown>[];
    assert.deepEqual(outcomes[0], { ma: "trang-a", ok: true, ten: "Trang A", daDangKyNhanTin: true });
    assert.equal(outcomes[1]!["viSao"], "token_khong_dung_trang", "a token of page A cannot claim page B");
    assert.ok(x.graphCalls.includes("POST /v23.0/trang-a/subscribed_apps"), "the page is subscribed to the app");
    assert.ok(!a.text.includes("tk-trang-a"), "a token never comes back");

    const stolen = await x.call("/meta/trang", { method: "POST", token: x.inboxB, body: { trang: [{ ma: "trang-a", token: "tk-trang-a" }] } });
    assert.equal((stolen.body!["ketQua"] as Record<string, unknown>[])[0]!["viSao"], "trang_thuoc_shop_khac");

    const b = await x.call("/meta/trang", { method: "POST", token: x.inboxB, body: { trang: [{ ma: "trang-b", token: "tk-trang-b" }] } });
    assert.equal((b.body!["ketQua"] as Record<string, unknown>[])[0]!["ok"], true);
    assert.ok(!x.graphCalls.includes("POST /v23.0/trang-b/subscribed_apps"), "no subscription unless asked");

    const listed = await x.call("/meta/trang", { token: x.inboxA });
    assert.deepEqual((listed.body!["trang"] as { ma: string }[]).map((p) => p.ma), ["trang-a"]);
    assert.equal(x.license.shopForPage("trang-b"), "shop-b");
  } finally { await x.close(); }
});

test("one packet, two merchants: each landing gets only its own page's entries, with a ticket naming it; unknown pages are dropped", async () => {
  const x = await setup();
  try {
    await x.license.connectPages("shop-a", [{ ma: "trang-a", ten: "A" }]);
    await x.license.connectPages("shop-b", [{ ma: "trang-b", ten: "B" }]);
    const raw = packet(message("trang-a", "khach-1", "con size 42"), message("trang-b", "khach-2", "ship bao lau"), message("trang-la", "khach-3", "alo"));
    const r = await x.call("/meta/webhook", { method: "POST", body: raw, headers: signed(raw) });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, soShop: 2, chuaChuyen: 0, trangLa: 1 });

    const toA = x.landingCalls.find((c) => c.origin === "https://a.test")!;
    const toB = x.landingCalls.find((c) => c.origin === "https://b.test")!;
    assert.equal(toA.path, "/api/hop-thu/meta-tu-xeon");
    const entriesA = (toA.body["goi"] as { entry: { id: string }[] }).entry;
    const entriesB = (toB.body["goi"] as { entry: { id: string }[] }).entry;
    assert.deepEqual(entriesA.map((e) => e.id), ["trang-a"]);
    assert.deepEqual(entriesB.map((e) => e.id), ["trang-b"], "shop B never sees shop A's customers");

    const ticketA = verifyTicket(toA.token, { publicKeyForKeyId: () => x.signingKey.khoaCongPem, now: x.clock.now() });
    assert.ok(ticketA.hopLe);
    assert.equal(ticketA.than.shop, "shop-a");
    assert.equal(ticketA.than.vai, "dich-vu");
    assert.ok(x.logger.warnings.some((w) => w.includes("trang-la")), "an unknown page is logged");
  } finally { await x.close(); }
});

test("a landing that cannot take a packet: Meta still gets 200, the packet waits on disk and goes through on the next call", async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "xeon-meta-"));
  const x = await setup({ dataDirectory });
  try {
    await x.license.connectPages("shop-a", [{ ma: "trang-a", ten: "A" }]);
    await x.license.connectPages("shop-b", [{ ma: "trang-b", ten: "B" }]);
    x.network.down = (origin) => origin === "https://a.test";

    const first = packet(message("trang-a", "khach-1", "con size 42"));
    const r1 = await x.call("/meta/webhook", { method: "POST", body: first, headers: signed(first) });
    assert.equal(r1.status, 200, "a dead landing must never make Meta retry");
    assert.equal(r1.body!["chuaChuyen"], 1);
    assert.equal(x.forwarder.pendingCount(), 1);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDirectory, PENDING_FILE), "utf8")) as { muc: unknown[] };
    assert.equal(onDisk.muc.length, 1, "kept on disk, survives a restart");

    x.network.down = () => false;
    const second = packet(message("trang-b", "khach-2", "ship bao lau"));
    await x.call("/meta/webhook", { method: "POST", body: second, headers: signed(second) });
    await x.forwarder.retryPending();          // waits behind the retry the webhook call started
    assert.equal(x.forwarder.pendingCount(), 0);
    assert.equal(x.landingCalls.filter((c) => c.origin === "https://a.test").length, 1, "shop A's packet arrived late, exactly once");
  } finally { await x.close(); }
});

test("a packet waiting past Meta's 24-hour window is dropped, not delivered late", async () => {
  const x = await setup();
  try {
    await x.license.connectPages("shop-a", [{ ma: "trang-a", ten: "A" }]);
    x.network.down = () => true;
    const raw = packet(message("trang-a", "khach-1", "con size 42"));
    await x.call("/meta/webhook", { method: "POST", body: raw, headers: signed(raw) });
    assert.equal(x.forwarder.pendingCount(), 1);

    x.network.down = () => false;
    x.clock.advance(25 * 60 * 60 * 1000);
    assert.equal(await x.forwarder.retryPending(), 0);
    assert.equal(x.forwarder.pendingCount(), 0);
    assert.equal(x.landingCalls.length, 0);
  } finally { await x.close(); }
});

test("/health shows the Meta state", async () => {
  const x = await setup();
  try {
    await x.license.connectPages("shop-a", [{ ma: "trang-a", ten: "A" }]);
    const health = await x.call("/health");
    assert.deepEqual(health.body!["meta"], { soTrang: 1, goiDangCho: 0 });
  } finally { await x.close(); }
});

test("a reply under a comment carries the comment id, and every reply names its conversation", async () => {
  const calls: Record<string, unknown>[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const gateway = new LandingGateway({ origin: "https://shop.test", ticket: "ve", fetch });
  await gateway.sendReply({ kenh: "facebook-binh-luan", nguoi: "khach-1", chu: "Da con a", traLoiTin: "123_456", maHoiThoai: "facebook-binh-luan:khach-1" });
  await gateway.sendReply({ kenh: "facebook", nguoi: "khach-2", chu: "Da" });
  assert.equal(calls[0]!["traLoiTin"], "123_456");
  assert.equal(calls[0]!["maHoiThoai"], "facebook-binh-luan:khach-1");
  assert.equal("traLoiTin" in calls[1]!, false, "a plain message carries no comment id");
});
