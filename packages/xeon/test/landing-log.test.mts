/**
 * The landings' PUSHED log lines (21/09/2026): the lane that works when a landing dies mid-sentence.
 *
 * Two things are being defended. WHICH MERCHANT comes from the inbox token and never from the body
 * — otherwise one shop could write into another's record and the whole log stops being evidence.
 * And ONE MERCHANT CANNOT DROWN THE REST: there are many landings and one shared disk.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  LandingLogController, LandingLogStore, LicenseLedger, LicenseService, MemoryLogger,
  generateSigningKey, type LandingLogLine
} from "@sp/xeon";

const T0 = new Date("2026-09-21T09:00:00.000Z");
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "nhat-ky-landing-"));

function line(n: number, extra: Partial<LandingLogLine> = {}): LandingLogLine {
  return { stt: n, luc: T0.toISOString(), muc: "loi", huong: "in", duong: "/api/don", status: 500, ...extra };
}

// ---- the store ---------------------------------------------------------------------------------

test("lines land in one folder per merchant, one file per day, stamped with Xeon's own clock", async () => {
  const root = await tmp();
  try {
    const store = new LandingLogStore({ root, clock: { now: () => T0 }, logger: new MemoryLogger() });
    assert.deepEqual(await store.accept("toprun", [line(1), line(2)]), { nhan: 2, boQua: 0 });
    await store.accept("dasbui", [line(1)]);

    assert.deepEqual(await store.listShops(), ["dasbui", "toprun"]);
    const got = await store.read("toprun");
    assert.deepEqual(got.map((l) => l.stt), [1, 2]);
    // A landing with a wrong clock must still be orderable, so Xeon stamps arrival itself.
    assert.equal(got[0]!["nhanLuc"], T0.toISOString());
    assert.equal((await store.read("dasbui")).length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("one merchant over its minute is cut off; its neighbour is untouched", async () => {
  const root = await tmp();
  try {
    let now = T0;
    const store = new LandingLogStore({ root, clock: { now: () => now }, logger: new MemoryLogger(), perMinute: 3 });

    assert.deepEqual(await store.accept("on-ao", [line(1), line(2)]), { nhan: 2, boQua: 0 });
    // Only one of the allowance is left, so two of these three are refused — and SAID to be.
    assert.deepEqual(await store.accept("on-ao", [line(3), line(4), line(5)]), { nhan: 1, boQua: 2 });
    assert.deepEqual(await store.accept("yen", [line(1), line(2), line(3)]), { nhan: 3, boQua: 0 });

    now = new Date(T0.getTime() + 61_000);
    assert.deepEqual(await store.accept("on-ao", [line(6)]), { nhan: 1, boQua: 0 }, "a new minute, a new allowance");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("what the landing already dropped itself is counted too, so nothing is lost silently", async () => {
  const root = await tmp();
  try {
    const store = new LandingLogStore({ root, clock: { now: () => T0 }, logger: new MemoryLogger() });
    assert.deepEqual(await store.accept("toprun", [line(1)], { daBo: 7 }), { nhan: 1, boQua: 7 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("read narrows by trace and by level — one incident out of a whole day", async () => {
  const root = await tmp();
  try {
    const store = new LandingLogStore({ root, clock: { now: () => T0 }, logger: new MemoryLogger() });
    await store.accept("toprun", [
      line(1, { vet: "v-1-aaaaaa", muc: "loi" }),
      line(2, { vet: "v-2-bbbbbb", muc: "loi" }),
      line(3, { vet: "v-1-aaaaaa", muc: "tin" })
    ]);
    assert.deepEqual((await store.read("toprun", { vet: "v-1-aaaaaa" })).map((l) => l.stt), [1, 3]);
    assert.deepEqual((await store.read("toprun", { muc: "loi" })).map((l) => l.stt), [1, 2]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the sweep drops day-files past their keep, per merchant", async () => {
  const root = await tmp();
  try {
    let now = new Date("2026-09-01T09:00:00.000Z");
    const store = new LandingLogStore({ root, clock: { now: () => now }, logger: new MemoryLogger(), keepDays: 14 });
    await store.accept("toprun", [line(1)]);
    now = new Date("2026-09-21T09:00:00.000Z");
    await store.accept("toprun", [line(2)]);

    // `accept` sweeps on its own at most once an hour, so by now the old day-file is already gone
    // and an explicit sweep has nothing left to do. What matters is the state, not who removed it.
    assert.deepEqual((await store.read("toprun")).map((l) => l.stt), [2]);
    assert.equal(await store.sweep(now), 0, "sweeping twice is harmless");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ---- the door ----------------------------------------------------------------------------------

function fakeRes() {
  const state = { status: 0, body: null as unknown };
  const res = {
    statusCode: 0,
    writeHead(status: number) { state.status = status; return res; },
    end(text?: string) { state.body = text === undefined ? null : JSON.parse(text); },
    setHeader() { /* not used here */ }
  };
  return { res: res as unknown as ServerResponse, state };
}

function fakeReq(token: string): IncomingMessage {
  return { headers: { authorization: `Bearer ${token}` } } as unknown as IncomingMessage;
}

function ctxFor(body: Record<string, unknown> | null) {
  return { method: "POST", path: "/nhat-ky/gom", ip: "1.2.3.4", readJson: async () => body } as never;
}

async function licensed() {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({
    ledger, signingKey: generateSigningKey(), clock: { now: () => T0 },
    sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"]
  });
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  const registered = await license.registerLanding({ key, diaChi: "https://shop.vn" });
  if (!registered.ok) throw new Error(`khong dang ky duoc landing: ${registered.viSao}`);
  return { license, inboxToken: registered.maNhanTin };
}

test("the merchant comes from the inbox token, never from the body", async () => {
  const root = await tmp();
  try {
    const store = new LandingLogStore({ root, clock: { now: () => T0 }, logger: new MemoryLogger() });
    const { license, inboxToken } = await licensed();
    const door = new LandingLogController({ store, license, logger: new MemoryLogger() });

    // A body claiming to be another shop changes nothing: the token decides.
    const { res, state } = fakeRes();
    assert.equal(await door.handle(fakeReq(inboxToken), res, ctxFor({ muc: [line(1)], shop: "dasbui" })), true);
    assert.equal(state.status, 200);
    assert.deepEqual(await store.listShops(), ["toprun"]);
    assert.equal((await store.read("dasbui")).length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("an unknown token is 401; an empty batch is 400; no store configured says so plainly", async () => {
  const root = await tmp();
  try {
    const store = new LandingLogStore({ root, clock: { now: () => T0 }, logger: new MemoryLogger() });
    const { license, inboxToken } = await licensed();
    const door = new LandingLogController({ store, license, logger: new MemoryLogger() });

    const bad = fakeRes();
    await door.handle(fakeReq("ma-bia"), bad.res, ctxFor({ muc: [line(1)] }));
    assert.equal(bad.state.status, 401);

    const empty = fakeRes();
    await door.handle(fakeReq(inboxToken), empty.res, ctxFor({ muc: [] }));
    assert.equal(empty.state.status, 400);

    // Turned off: a landing pushing into the void should be able to tell.
    const off = fakeRes();
    await new LandingLogController({ store: null, license, logger: new MemoryLogger() })
      .handle(fakeReq(inboxToken), off.res, ctxFor({ muc: [line(1)] }));
    assert.equal(off.state.status, 503);
    assert.match(String((off.state.body as { message: string }).message), /XEON_NHAT_KY_THU_MUC/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the door only answers its own path and method", async () => {
  const { license } = await licensed();
  const door = new LandingLogController({ store: null, license, logger: new MemoryLogger() });
  const { res } = fakeRes();
  assert.equal(await door.handle(fakeReq("x"), res, { method: "GET", path: "/nhat-ky/gom", ip: "", readJson: async () => null } as never), false);
  assert.equal(await door.handle(fakeReq("x"), res, { method: "POST", path: "/nhat-ky", ip: "", readJson: async () => null } as never), false);
});
