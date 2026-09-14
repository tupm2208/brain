/**
 * The gateway to a merchant's landing (after the L5 iteration, 14/09/2026): tools read from the
 * landing, call context forwarded, offline for only 30 seconds, catalog count, memory on the
 * landing, handoff notices.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BrainService, DEFAULT_TOOL_LIST, LandingGateway, LicenseLedger, LicenseService, MemoryLogger, OFFLINE_HOLD_MS,
  TOOL_LIST_TTL_MS, generateSigningKey, type FetchLike
} from "@sp/xeon";

const T0 = Date.parse("2026-09-14T08:00:00.000Z");

interface RecordedCall { path: string; method: string; body: Record<string, unknown> | null; token: string }

/** A fake landing: records every call and answers by path. */
function fakeLanding({ tools = ["catalog.search", "stock.lookup", "catalog.count", "policy.get", "storefront.link"], failing = (): boolean => false }: {
  tools?: string[]; failing?: (path: string) => boolean;
} = {}) {
  const calls: RecordedCall[] = [];
  const memory = new Map<string, unknown>();
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ path: u.pathname, method: init.method || "GET", body, token: String(init.headers["Authorization"] || "").replace(/^Bearer /, "") });
    if (failing(u.pathname)) throw new Error("mat mang");
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.pathname === "/api/bo-nao/cong-cu" && (init.method || "GET") === "GET") return reply({ ok: true, congCu: tools });
    if (u.pathname === "/api/bo-nao/cong-cu") {
      const tool = String(body!["ten"]);
      if (!tools.includes(tool)) return reply({ ok: false, error: "cong_cu_khong_co", dangMo: tools }, 400);
      if (tool === "catalog.count") return reply({ ok: true, data: { total: 4834 } });
      if (tool === "catalog.search") return reply({ ok: true, data: { items: [{ id: "DV1", code: "DV1", name: "Pegasus 40", priceFrom: 1, variantCount: 1 }], truncated: false } });
      return reply({ ok: true, data: { rows: [], asOf: "", truncated: false } });
    }
    if (u.pathname.startsWith("/api/bo-nao/tri-nho/")) {
      const id = decodeURIComponent(u.pathname.split("/").pop()!);
      if ((init.method || "GET") === "PUT") { memory.set(id, body!["trangThai"]); return reply({ ok: true, capNhatLuc: "x" }); }
      return reply({ ok: true, trangThai: memory.get(id) ?? null });
    }
    if (u.pathname === "/api/hop-thu/gui") return reply({ ok: true, ketQua: { guiNgay: true } });
    if (u.pathname === "/api/hop-thu/can-nguoi") return reply({ ok: true });
    return reply({ ok: false, error: "khong_thay" }, 404);
  };
  return { fetch, calls, memory };
}

function buildGateway({ landing = fakeLanding(), time = { now: T0 } }: { landing?: ReturnType<typeof fakeLanding>; time?: { now: number } } = {}) {
  const logger = new MemoryLogger();
  const gateway = new LandingGateway({ origin: "https://shop.vn/", ticket: () => "ve-dich-vu", fetch: landing.fetch, logger, clock: { now: () => new Date(time.now) } });
  return { gateway, time, logger, landing };
}

test("tool list: fallback before asking; the landing's list after refresh; stale after 5 minutes", async () => {
  const { gateway, time } = buildGateway();
  assert.deepEqual(gateway.tools.available(), DEFAULT_TOOL_LIST);
  assert.equal(gateway.toolListStale(), true);
  const list = await gateway.refreshToolList();
  assert.ok(list.includes("policy.get"));
  assert.ok(list.includes("catalog.count" as never));
  assert.deepEqual(gateway.tools.available(), list);
  assert.equal(gateway.toolListStale(), false);
  time.now += TOOL_LIST_TTL_MS + 1;
  assert.equal(gateway.toolListStale(), true, "stale after 5 minutes");
});

test("landing down while asking for tools: keep the fallback (or the previous list) and warn once", async () => {
  const down = { yes: true };
  const landing = fakeLanding({ failing: (p) => down.yes && p === "/api/bo-nao/cong-cu" });
  const { gateway, logger } = buildGateway({ landing });
  await gateway.refreshToolList();
  assert.deepEqual(gateway.tools.available(), DEFAULT_TOOL_LIST);
  assert.ok(logger.warnings.some((m) => /tam dung ban lui/.test(m)));
  down.yes = false;
  const list = await gateway.refreshToolList();
  assert.ok(list.includes("policy.get"));
  down.yes = true;
  await gateway.refreshToolList();
  assert.ok(gateway.tools.available().includes("policy.get"), "a later failure keeps the list already obtained");
});

test("call: forwards the context (conversation id + idempotency key) and the service ticket", async () => {
  const { gateway, landing } = buildGateway();
  await gateway.refreshToolList();
  const r = await gateway.tools.call("stock.lookup", { code: "DV1" }, { conversationId: "facebook:k1" as never, idempotencyKey: "facebook:k1:t:stock.lookup" });
  assert.equal(r.ok, true);
  const call = landing.calls.find((c) => c.method === "POST" && c.path === "/api/bo-nao/cong-cu")!;
  assert.deepEqual(call.body!["nguCanh"], { conversationId: "facebook:k1", idempotencyKey: "facebook:k1:t:stock.lookup" });
  assert.equal(call.token, "ve-dich-vu");
  const unknown = await gateway.tools.call("chay_lenh" as never, {} as never);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error.code, "tool_unknown");
});

test("online(): offline for 30 seconds after a network failure, then retry; never offline forever", async () => {
  const down = { yes: true };
  const landing = fakeLanding({ failing: () => down.yes });
  const { gateway, time } = buildGateway({ landing });
  assert.equal(gateway.tools.online(), true);
  const r = await gateway.tools.call("stock.lookup", { code: "x" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "omi_offline");
  assert.equal(gateway.tools.online(), false);
  time.now += OFFLINE_HOLD_MS - 1000;
  assert.equal(gateway.tools.online(), false);
  time.now += 2000;
  assert.equal(gateway.tools.online(), true, "after 30 seconds the bot may retry");
  down.yes = false;
  await gateway.refreshToolList();
  assert.equal((await gateway.tools.call("stock.lookup", { code: "x" })).ok, true);
  assert.equal(gateway.tools.online(), true);
});

test("catalog.size(): asks catalog.count; 0 when the landing does not open it", async () => {
  const { gateway } = buildGateway();
  await gateway.refreshToolList();
  assert.equal(await gateway.catalog.size("toprun" as never), 4834);
  const items = await gateway.catalog.search("toprun" as never, "pegasus", 5);
  assert.equal(items[0]!.code, "DV1");
  const { gateway: limited } = buildGateway({ landing: fakeLanding({ tools: ["catalog.search"] }) });
  await limited.refreshToolList();
  assert.equal(await limited.catalog.size("toprun" as never), 0);
});

test("memory: load before save is null; save then load from the landing; handoff notice goes to the right door", async () => {
  const { gateway, landing } = buildGateway();
  assert.equal(await gateway.memory.load("toprun" as never, "facebook:k1" as never), null);
  const state = { tenant: "toprun" as never, conversationId: "facebook:k1" as never, turns: [] };
  await gateway.memory.save(state);
  assert.deepEqual(await gateway.memory.load("toprun" as never, "facebook:k1" as never), state);
  assert.ok(landing.calls.some((c) => c.method === "PUT" && c.path === "/api/bo-nao/tri-nho/facebook%3Ak1"));
  assert.equal(await gateway.notifyHandoff({ kenh: "facebook", nguoi: "k1", maHoiThoai: "facebook:k1", lyDo: "khong chac", tinCuoi: "x" }), true);
  const notice = landing.calls.find((c) => c.path === "/api/hop-thu/can-nguoi")!;
  assert.equal(notice.body!["maHoiThoai"], "facebook:k1");
});

test("licensed brain: memory goes through the landing (not RAM), and a pack/tool mismatch is reported once", async () => {
  const clock = { now: () => new Date(T0) };
  const signingKey = generateSigningKey();
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey, clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  await license.registerLanding({ key, diaChi: "https://shop.vn" });

  const landing = fakeLanding({ tools: ["catalog.search", "stock.lookup", "catalog.count", "storefront.link"] });
  const logger = new MemoryLogger();
  const brain = new BrainService({ license, fetch: landing.fetch, logger, clock });
  await brain.handleInbound({ tenant: "toprun", kenh: "facebook", nguoi: "k1", chu: "shop có Pegasus 40 size 42 không", maHoiThoai: "facebook:k1" });
  assert.ok(landing.calls.some((c) => c.path === "/api/bo-nao/tri-nho/facebook%3Ak1" && c.method === "GET"), "memory read from the landing");
  assert.ok(landing.calls.some((c) => c.path === "/api/bo-nao/tri-nho/facebook%3Ak1" && c.method === "PUT"), "memory written to the landing");
  assert.ok(landing.memory.get("facebook:k1"), "the conversation state lives on the landing");
  assert.ok(logger.warnings.some((m) => /landing khong mo/.test(m) && /policy\.get/.test(m)), `the mismatch must be reported: ${logger.warnings.join(" | ")}`);
  await brain.handleInbound({ tenant: "toprun", kenh: "facebook", nguoi: "k1", chu: "còn không", maHoiThoai: "facebook:k1" });
  assert.equal(logger.warnings.filter((m) => /landing khong mo/.test(m)).length, 1, "reported once");
});
