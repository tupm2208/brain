/**
 * TWO PARTS JOINED: a message travels the whole path, merchant inbox -> brain -> reply.
 *
 * This test plugs the REAL merchant server (kernel + three modules) into the REAL brain; nothing
 * on either side is faked. The only fake is the NETWORK: the brain's `fetch` is wired straight
 * into the merchant server's request handler, so the test runs in one process without a socket
 * while still passing through the real doors.
 *
 * Requires MySQL on port 3307:
 *   TOPRUN_MYSQL_URL=mysql://root:...@127.0.0.1:3307/toprun_modules_test npm run test:mysql
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import {
  BrainService, InMemoryConversationMemory, InboundController, LandingGateway, MemoryLogger, createRequestListener,
  type FetchLike
} from "@sp/xeon";

const require = createRequire(import.meta.url);
// The merchant server is TypeScript too (since 14/09/2026); its compiled package is required from dist.
type Landing = typeof import("../../../../server-khach/dist/index.js");
const LANDING_DIST = path.join(import.meta.dirname, "..", "..", "..", "..", "server-khach", "dist", "index.js");
/* eslint-disable @typescript-eslint/no-require-imports */
const landing = require(LANDING_DIST) as Landing;
/* eslint-enable @typescript-eslint/no-require-imports */
const { Kernel, openMysqlStore, FixedWindowRateLimiter, ManualClock, FakeHttpClient, TokenAuth, ROLE } = landing;
const { hangKho: mHangKho, hopThu: mHopThu, congBoNao: mCongBoNao, vanChuyen: mVanChuyen } = landing;
type LandingStore = import("../../../../server-khach/dist/index.js").DataStore;
type LandingKernel = import("../../../../server-khach/dist/index.js").Kernel;
type LandingManifest = import("../../../../server-khach/dist/index.js").AnyManifest;

const ADMIN_TOKEN = "ma-quan-tri";
const BRAIN_TOKEN = "ma-bo-nao";
const SHOP = "toprun";

const MYSQL_URL = String(process.env["TOPRUN_MYSQL_URL"] || "").trim();
const skip = MYSQL_URL ? {} : { skip: "TOPRUN_MYSQL_URL not set — skipping the two-part integration test" };
if (MYSQL_URL && /:3306\//.test(MYSQL_URL)) throw new Error("Port 3306 holds the landing's REAL data. Use 3307.");

const ITEM = {
  code: "DV1234", name: "Giày chạy Nike Pegasus 40", brand: "Nike", listPrice: 3500000,
  sizes: [
    { size: "42", qty: 3, price: 2890000, warehouseId: "wh_yen", warehouse: "Yên" },
    { size: "43", qty: 0, price: 2890000, warehouseId: "wh_yen", warehouse: "Yên" }
  ]
};

/** One shared connection for the whole file; a connection per test leaves the runner hanging. */
let sharedStore: LandingStore | null = null;
async function store() {
  if (!sharedStore) {
    sharedStore = await openMysqlStore({ url: MYSQL_URL, logger: new MemoryLogger() });
    await sharedStore.runSchema("hang-kho", mHangKho.schema ?? []);
  }
  return sharedStore;
}
after(async () => { if (sharedStore) await sharedStore.close(); });

/** Builds both parts with a fake network between them. */
async function buildBoth({ items = [ITEM] }: { items?: unknown[] } = {}) {
  const landingLogger = new MemoryLogger();
  const landingClock = new ManualClock();
  const kho = await store();
  for (const table of ["hang_kho_giu_cho", "hang_kho_bien_the", "hang_kho_mon", "hang_kho_ma_chan"]) {
    await kho.execute(`DELETE FROM \`${table}\``, []);
  }
  const sent: { url: string; body: Record<string, unknown> }[] = [];

  const kernel: LandingKernel = new Kernel({
    ports: {
      store: kho, logger: landingLogger, clock: landingClock,
      // Fake Graph API: records what was sent to the customer.
      http: new FakeHttpClient((url, init) => {
        sent.push({ url: String(url), body: JSON.parse(String(init.body || "{}")) });
        return { ok: true, status: 200, json: async () => ({ message_id: "m.1" }), text: async () => "" };
      }),
      auth: new TokenAuth({ keys: [{ token: ADMIN_TOKEN, name: "quan-tri", role: ROLE.admin }, { token: BRAIN_TOKEN, name: "bo-nao", role: ROLE.service }], clock: landingClock }),
      rateLimiter: new FixedWindowRateLimiter(landingClock)
    },
    logger: landingLogger,
    modules: [mHangKho, mVanChuyen, mHopThu, mCongBoNao],
    config: {
      "hang-kho": {},
      "hop-thu": { verifyToken: "v", appSecret: "", pageToken: "tk" },
      "cong-bo-nao": { siteUrl: "https://toprun.site" },
      "van-chuyen": { defaultCarrier: "spx", spx: {} }
    }
  });

  await kernel.handle({
    method: "POST", path: "/api/products", ip: "1.1.1.1",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` }, json: async () => items
  });

  // The fake network: an HTTP call becomes a direct call into the merchant server's kernel.
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const reply = await kernel.handle({
      method: init.method || "GET",
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      headers: Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
      ip: "1.1.1.1",
      json: async () => JSON.parse(String(init.body || "{}")),
      raw: async () => Buffer.from(String(init.body || ""), "utf8")
    });
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  };

  const brainLogger = new MemoryLogger();
  const brain = new BrainService({
    legacyShops: { [SHOP]: { diaChi: "https://toprun.site", ma: BRAIN_TOKEN, nganh: "giay-chay" } },
    memory: new InMemoryConversationMemory(),
    fetch,
    logger: brainLogger,
    clock: { now: () => new Date("2026-09-12T10:00:00.000Z") }
  });

  const receive = (text: string, customer = "khach-1", conversation = "hoi-thoai-1") =>
    brain.handleInbound({ tenant: SHOP, kenh: "facebook", nguoi: customer, chu: text, maHoiThoai: conversation, luc: "2026-09-12T10:00:00.000Z" });

  return { kernel, sent, brain, receive, gateway: brain.merchant(SHOP)!.gateway };
}

test("the brain reads real stock through the merchant server's tool door", { ...skip }, async () => {
  const { gateway } = await buildBoth();
  const found = await gateway.tools.call("catalog.search", { q: "pegasus", limit: 5 });
  assert.equal(found.ok, true, JSON.stringify(found));
  if (found.ok) {
    assert.equal(found.data.items.length, 1);
    assert.equal(found.data.items[0]!.code, "DV1234");
  }
  const stock = await gateway.tools.call("stock.lookup", { code: "DV1234", variantLabel: "42" });
  assert.equal(stock.ok, true);
  if (stock.ok) {
    assert.equal(stock.data.rows.length, 1);
    assert.equal(stock.data.rows[0]!.qty, 3);
    assert.equal(stock.data.rows[0]!.price, 2890000);
  }
});

test("WAREHOUSE NAMES and IDS are not sent to the brain", { ...skip }, async () => {
  const { gateway } = await buildBoth();
  const stock = await gateway.tools.call("stock.lookup", { code: "DV1234" });
  assert.ok(stock.ok);
  const text = JSON.stringify(stock.data.rows);
  assert.ok(!/Yên/.test(text), `warehouse name leaked to the brain: ${text}`);
  // The real warehouse id carries a person's name ("wh_yen") and partner names, so it is hashed.
  assert.ok(!/wh_yen/.test(text), `real warehouse id leaked to the brain: ${text}`);
  for (const r of stock.data.rows) assert.match(r.warehouseId, /^kho_[0-9a-f]{8}$/);
  // Hashed but still COUNTED correctly: one real warehouse, one hashed id.
  assert.equal(new Set(stock.data.rows.map((r) => r.warehouseId)).size, 1);
});

test("a customer asks for stock: the bot answers and the reply leaves through the inbox door", { ...skip }, async () => {
  const { receive, sent } = await buildBoth();
  const result = await receive("shop còn Pegasus 40 size 42 không");
  assert.equal(result.daTraLoi, true, JSON.stringify(result));
  assert.equal(sent.length, 1, "exactly one message must be sent");
  assert.match(sent[0]!.url, /graph\.facebook\.com/);
  assert.equal((sent[0]!.body["recipient"] as { id: string }).id, "khach-1");
  assert.ok(String((sent[0]!.body["message"] as { text: string }).text).length > 0);
});

test("when the size is sold out the bot does NOT say it is available", { ...skip }, async () => {
  const { receive, sent } = await buildBoth();
  await receive("còn Pegasus 40 size 43 không");
  const reply = String((sent[0]?.body["message"] as { text?: string } | undefined)?.text ?? "");
  assert.ok(reply.length > 0, "there must be a reply");
  assert.ok(!/còn hàng size 43|còn size 43/i.test(reply), `the bot said in stock while sold out: ${reply}`);
});

test("an unknown tool name is refused with a clear error", { ...skip }, async () => {
  const { gateway } = await buildBoth();
  const r = await gateway.tools.call("chay_cau_lenh" as never, {} as never);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "tool_unknown");
});

test("without a service token no tool can be called", { ...skip }, async () => {
  const { kernel } = await buildBoth();
  const reply = await kernel.handle({
    method: "POST", path: "/api/bo-nao/cong-cu", headers: {},
    json: async () => ({ ten: "catalog.search", input: { q: "x" } })
  });
  assert.equal(reply.status, 401);
});

test("orders module not purchased: order lookup is closed while stock answers still work", { ...skip }, async () => {
  const { gateway, kernel } = await buildBoth();
  const lookup = await gateway.tools.call("order.lookup", { conversationId: "c1" as never, phoneGivenInConversation: "0911111111" });
  assert.equal(lookup.ok, false, "a module not purchased must keep its tool closed");

  const list = await kernel.handle({ method: "GET", path: "/api/bo-nao/cong-cu", headers: { authorization: `Bearer ${BRAIN_TOKEN}` } });
  const open = (list.body as { congCu: string[] }).congCu;
  assert.ok(open.includes("stock.lookup"));
  assert.ok(!open.includes("order.lookup"), "a tool of an unpurchased module must not be listed");

  const stock = await gateway.tools.call("stock.lookup", { code: "DV1234", variantLabel: "42" });
  assert.equal(stock.ok, true);
});

test("with the orders module: order lookup ONLY matches the phone number the customer typed", { ...skip }, async () => {
  const asked: Record<string, unknown>[] = [];
  const fakeOrders: LandingManifest = {
    id: "don-khach", name: "Đơn giả", tier: "van-hanh", runsOn: "server-khach", version: "0.0.1",
    provides: {
      "don-khach.search": async (_ctx: unknown, condition: Record<string, unknown>) => {
        asked.push(condition);
        return [{ id: "ORD-1", status: "pending", createdAt: "", total: 100, paidAmount: 0, remainingAmount: 100, items: [] }];
      },
      "don-khach.read": async () => null
    }
  };

  const logger = new MemoryLogger();
  const clock = new ManualClock();
  const kho = await store();
  const kernel: LandingKernel = new Kernel({
    ports: { store: kho, logger, clock, http: new FakeHttpClient(), auth: new TokenAuth({ keys: [{ token: BRAIN_TOKEN, name: "bo-nao", role: ROLE.service }], clock }), rateLimiter: new FixedWindowRateLimiter(clock) },
    logger, modules: [mHangKho, fakeOrders, mCongBoNao],
    config: { "hang-kho": {}, "cong-bo-nao": { siteUrl: "https://toprun.site" } }
  });

  const callTool = (input: unknown) => kernel.handle({
    method: "POST", path: "/api/bo-nao/cong-cu",
    headers: { authorization: `Bearer ${BRAIN_TOKEN}` }, ip: "1.1.1.1",
    json: async () => ({ ten: "order.lookup", input })
  });

  const withoutPhone = await callTool({ conversationId: "c1", phoneGivenInConversation: "" });
  assert.equal(withoutPhone.status, 200);
  assert.deepEqual((withoutPhone.body as { data: { orders: unknown[] } }).data.orders, [], "no phone typed by the customer means no orders");
  assert.equal(asked.length, 0, "without a phone the orders module must not even be asked");

  const withPhone = await callTool({ conversationId: "c1", phoneGivenInConversation: "0911111111" });
  assert.equal((withPhone.body as { data: { orders: unknown[] } }).data.orders.length, 1);
  assert.equal(asked[0]!["phone"], "0911111111", "must filter by the phone the customer typed");
});

test("network down: the brain knows it and does not assert stock", { ...skip }, async () => {
  const { gateway } = await buildBoth();
  assert.equal(gateway.tools.online(), true);

  const broken = new LandingGateway({
    origin: "https://toprun.site", ticket: "x",
    fetch: async () => { throw new Error("dut mang"); },
    logger: new MemoryLogger()
  });
  const r = await broken.tools.call("stock.lookup", { code: "DV1234" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "omi_offline");
  assert.equal(broken.tools.online(), false, "a network failure must be noticed");
  assert.deepEqual(await broken.catalog.search("toprun" as never, "pegasus", 5), [], "offline returns nothing rather than inventing");
});

test("the brain's request listener: no token refused, right token accepted", async () => {
  const received: unknown[] = [];
  const listener = createRequestListener({
    controllers: [new InboundController({
      brain: { handleInbound: async (m) => { received.push(m); return { daTraLoi: true, hanhDong: "send", traLoi: "" }; } },
      license: null, sharedToken: "ma-nhan", logger: new MemoryLogger()
    })]
  });

  const send = async (headers: Record<string, string>, body: unknown) => {
    // Real Node emits Buffers on `req`; a string would make the fake easier than reality.
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body), "utf8")]), { method: "POST", url: "/tin-den", headers, socket: {} });
    let status = 0; let out: unknown = null;
    const res = { writeHead: (s: number) => { status = s; }, end: (chunk?: string) => { out = chunk ? JSON.parse(chunk) : null; } };
    await listener(req as never, res as never);
    return { status, out };
  };

  assert.equal((await send({}, { tenant: "t", nguoi: "n", chu: "a" })).status, 401);
  assert.equal((await send({ authorization: "Bearer sai" }, { tenant: "t", nguoi: "n", chu: "a" })).status, 401);
  const ok = await send({ authorization: "Bearer ma-nhan" }, { tenant: "t", nguoi: "n", chu: "a" });
  assert.equal(ok.status, 200);
  assert.equal(received.length, 1);
  const missing = await send({ authorization: "Bearer ma-nhan" }, { tenant: "t" });
  assert.equal(missing.status, 400);
});

test("a message from an unknown merchant is ignored, never answered", { ...skip }, async () => {
  const { brain, sent } = await buildBoth();
  const result = await brain.handleInbound({ tenant: "shop-la", kenh: "facebook", nguoi: "x", chu: "còn hàng không" });
  assert.equal(result.daTraLoi, false);
  assert.equal((result as { viSao: string }).viSao, "khong_phuc_vu_shop");
  assert.equal(sent.length, 0);
});

test("two merchants never share conversation memory", async () => {
  const memory = new InMemoryConversationMemory();
  await memory.save({ tenant: "shop-a" as never, conversationId: "c1" as never, turns: [{ role: "customer", text: "a", at: "" }] });
  assert.equal(await memory.load("shop-b" as never, "c1" as never), null, "merchant B must not read merchant A's conversation");
  assert.notEqual(await memory.load("shop-a" as never, "c1" as never), null);
});
