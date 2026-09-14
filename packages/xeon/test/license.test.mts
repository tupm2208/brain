/**
 * Licensing on Xeon: every decision of 14/09/2026 has a test that keeps it.
 * No network, no merchant machine. The ledger is written to a temporary directory to test restarts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_MACHINE_LIMIT, LICENSE_KEY_PATTERN, LicenseLedger, LicenseService, MACHINE_TICKET_TTL_MS, ManualClock,
  SERVICE_TICKET_TTL_MS, SigningKeyStore, generateSigningKey, machineDisplayId, signText, signTicket, verifyText, verifyTicket,
  type SigningKeyPair
} from "@sp/xeon";

const T0 = new Date("2026-09-14T08:00:00.000Z");
const MODULES = ["hang-kho", "don-khach", "gian-hang", "van-chuyen", "hop-thu", "chatbot-cskh", "mua-ho"];
const CORE = ["hang-kho", "don-khach", "gian-hang"];

async function buildService({ directory = null, clock = new ManualClock(T0), signingKey = generateSigningKey() }: {
  directory?: string | null; clock?: ManualClock; signingKey?: SigningKeyPair;
} = {}) {
  const ledger = await LicenseLedger.open({ directory });
  const license = new LicenseService({ ledger, signingKey, clock, xeonAddress: "https://xeon.toprun.vn", sellableModules: MODULES, coreModules: CORE });
  return { license, clock, signingKey, ledger };
}

const MACHINE = (n: number) => ({ maMay: `may-${n}-${"x".repeat(20)}`, tenMay: `Máy ${n}` });
const NEXT_YEAR = "2027-01-01T00:00:00.000Z";

test("issue a key: TR-XXXX-XXXX-XXXX-XXXX shape, duplicate shop refused, unknown module refused", async () => {
  const { license } = await buildService();
  const { key, shop } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: NEXT_YEAR });
  assert.match(key, LICENSE_KEY_PATTERN);
  assert.equal(shop, "toprun");
  await assert.rejects(() => license.issueKey({ shop: "toprun", tenShop: "x", hetHan: NEXT_YEAR }), /da co key dang dung/);
  await assert.rejects(() => license.issueKey({ shop: "shop2", tenShop: "x", manh: ["khong-co"], hetHan: NEXT_YEAR }), /Manh khong co/);
  await assert.rejects(() => license.issueKey({ shop: "shop3", tenShop: "x", hetHan: "2020-01-01T00:00:00.000Z" }), /tuong lai/);
  assert.equal(license.viewKey(key)!.soMay, DEFAULT_MACHINE_LIMIT);
  assert.deepEqual(license.viewKey(key)!.manh, [...CORE, "chatbot-cskh"].sort(), "core modules are always on");
});

test("three machines get in, the fourth is 'full' with the seated names; a known machine is not added twice", async () => {
  const { license } = await buildService();
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", hetHan: NEXT_YEAR });
  for (const n of [1, 2, 3]) {
    const r = await license.checkMachine({ key, ...MACHINE(n) });
    assert.equal(r.ok, true, `machine ${n} must get in`);
    if (r.ok) assert.ok(r.ve.startsWith("VM1."));
  }
  const fourth = await license.checkMachine({ key, ...MACHINE(4) });
  assert.equal(fourth.ok, false);
  if (!fourth.ok && fourth.viSao === "da_day") {
    assert.deepEqual(fourth.may.map((m) => m.tenMay), ["Máy 1", "Máy 2", "Máy 3"]);
    assert.ok(!("maMay" in fourth.may[0]!), "the full machine id must not leak");
  } else assert.fail("expected da_day");

  const again = await license.checkMachine({ key, ...MACHINE(2) });
  assert.equal(again.ok, true);
  assert.equal(license.viewKey(key)!.may.length, 3);
});

test("first machine is on duty; duty can move; removing the duty machine passes duty on; removal frees a seat", async () => {
  const { license } = await buildService();
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", hetHan: NEXT_YEAR });
  const m1 = await license.checkMachine({ key, ...MACHINE(1) });
  const m2 = await license.checkMachine({ key, ...MACHINE(2) });
  await license.checkMachine({ key, ...MACHINE(3) });
  assert.equal(m1.ok && m1.truc, true);
  assert.equal(m2.ok && m2.truc, false);
  assert.deepEqual(license.isOnDuty({ key, maMay: MACHINE(2).maMay }), { ok: true, truc: false });

  const id2 = machineDisplayId(MACHINE(2).maMay);
  assert.equal(license.viewKey(key)!.may[1]!.id, id2, "the display id is a short hash of the machine id");
  assert.equal((await license.setDutyMachine({ key, mayId: id2 })).ok, true);
  assert.deepEqual(license.isOnDuty({ key, maMay: MACHINE(2).maMay }), { ok: true, truc: true });
  assert.deepEqual(license.isOnDuty({ key, maMay: MACHINE(1).maMay }), { ok: true, truc: false });

  const removed = await license.removeMachine({ key, mayId: id2 });
  assert.equal(removed.ok, true);
  if (removed.ok) {
    assert.equal(removed.may.length, 2);
    assert.equal(removed.may.find((m) => m.truc)!.tenMay, "Máy 1", "duty passes to the first remaining machine");
  }
  assert.equal((license.isOnDuty({ key, maMay: MACHINE(2).maMay }) as { viSao: string }).viSao, "may_khong_co");

  assert.equal((await license.checkMachine({ key, ...MACHINE(4) })).ok, true, "one removal frees a seat for the fourth machine");
  assert.equal((await license.removeMachine({ key, mayId: "zzzzzz" }) as { viSao: string }).viSao, "may_khong_co");
});

test("wrong / locked / expired key: refused with a reason; unlocking and extending let the machine back in", async () => {
  const { license, clock } = await buildService();
  assert.equal((await license.checkMachine({ key: "TR-AAAA-AAAA-AAAA-AAAA", ...MACHINE(1) }) as { viSao: string }).viSao, "key_khong_co");
  assert.equal((await license.checkMachine({ key: "khong-phai-key", ...MACHINE(1) }) as { viSao: string }).viSao, "key_khong_co");

  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2026-10-01T00:00:00.000Z" });
  assert.equal((await license.checkMachine({ key, maMay: "ngan", tenMay: "x" }) as { viSao: string }).viSao, "ma_may_sai");

  await license.lockKey(key, "chua tra tien");
  const locked = await license.checkMachine({ key, ...MACHINE(1) });
  assert.equal((locked as { viSao: string }).viSao, "key_bi_khoa");
  assert.equal((locked as { lyDo: string }).lyDo, "chua tra tien");
  assert.equal(license.viewKey(key)!.trangThai, "bi_khoa");
  await license.unlockKey(key);
  assert.equal((await license.checkMachine({ key, ...MACHINE(1) })).ok, true);

  clock.advance(30 * 24 * 3600 * 1000);
  const expired = await license.checkMachine({ key, ...MACHINE(1) });
  assert.equal((expired as { viSao: string }).viSao, "key_het_han");
  assert.equal(license.viewKey(key)!.trangThai, "het_han");
  await license.extendKey(key, "2027-06-01T00:00:00.000Z");
  assert.equal((await license.checkMachine({ key, ...MACHINE(1) })).ok, true);
});

test("a key typed in lower case with spaces is still accepted", async () => {
  const { license } = await buildService();
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", hetHan: NEXT_YEAR });
  assert.equal((await license.checkMachine({ key: ` ${key.toLowerCase()} `, ...MACHINE(1) })).ok, true);
});

test("machine ticket: verifiable with the public key, carries shop/machine/modules/duty; one changed character fails; expires after 7 hours; unknown key id is refused", async () => {
  const { license, clock, signingKey } = await buildService();
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["van-chuyen"], hetHan: NEXT_YEAR });
  const checked = await license.checkMachine({ key, ...MACHINE(1) });
  assert.ok(checked.ok);
  const { ve, hetLuc } = checked;
  assert.equal(hetLuc, T0.getTime() + MACHINE_TICKET_TTL_MS);

  const publicKeyForKeyId = (id: string) => (id === signingKey.keyId ? signingKey.khoaCongPem : null);
  const d = verifyTicket(ve, { publicKeyForKeyId, now: clock.now() });
  assert.equal(d.hopLe, true);
  if (d.hopLe) {
    assert.equal(d.than.vai, "quan-tri");
    assert.equal(d.than.shop, "toprun");
    assert.equal(d.than.maMay, MACHINE(1).maMay);
    assert.equal(d.than.truc, true);
    assert.deepEqual(d.than.manh, [...CORE, "van-chuyen"].sort());
    assert.equal(d.than.keyId, signingKey.keyId);
  }

  // Change one character of the body (the shop) -> bad signature.
  const [prefix, body, signature] = ve.split(".");
  const tampered = Buffer.from(Buffer.from(body!, "base64url").toString("utf8").replace('"toprun"', '"shop-b"'), "utf8").toString("base64url");
  assert.equal((verifyTicket(`${prefix}.${tampered}.${signature}`, { publicKeyForKeyId, now: clock.now() }) as { viSao: string }).viSao, "chu_ky_sai");
  assert.equal((verifyTicket("VM1.abc", { publicKeyForKeyId, now: clock.now() }) as { viSao: string }).viSao, "sai_hinh_dang");
  assert.equal((verifyTicket("xyz", { publicKeyForKeyId, now: clock.now() }) as { viSao: string }).viSao, "sai_hinh_dang");

  // Unknown key id (the landing does not know this key).
  assert.equal((verifyTicket(ve, { publicKeyForKeyId: () => null, now: clock.now() }) as { viSao: string }).viSao, "khong_biet_khoa");
  // Another key under the same key id -> bad signature.
  const other = generateSigningKey();
  assert.equal((verifyTicket(ve, { publicKeyForKeyId: () => other.khoaCongPem, now: clock.now() }) as { viSao: string }).viSao, "chu_ky_sai");

  clock.advance(MACHINE_TICKET_TTL_MS - 1000);
  assert.equal(verifyTicket(ve, { publicKeyForKeyId, now: clock.now() }).hopLe, true, "still alive with one second left");
  clock.advance(2000);
  assert.equal((verifyTicket(ve, { publicKeyForKeyId, now: clock.now() }) as { viSao: string }).viSao, "het_han");
});

test("a ticket from the future (clock skew over 5 minutes) is refused; small skew passes", () => {
  const signingKey = generateSigningKey();
  const t = T0.getTime();
  const ticket = signTicket({ vai: "quan-tri", shop: "s", tenShop: "S", maMay: "m", tenMay: "M", manh: [], truc: false, phatLuc: t + 10 * 60 * 1000, hetLuc: t + 8 * 3600 * 1000 }, signingKey);
  const check = (at: number) => verifyTicket(ticket, { publicKeyForKeyId: () => signingKey.khoaCongPem, now: new Date(at) });
  assert.equal((check(t) as { viSao: string }).viSao, "chua_toi_gio");
  assert.equal(check(t + 6 * 60 * 1000).hopLe, true);
  assert.throws(() => signTicket({ vai: "la" as never, shop: "s", tenShop: "", maMay: "", tenMay: "", manh: [], truc: false, phatLuc: t, hetLuc: t + 1 }, signingKey), /vai/);
  assert.throws(() => signTicket({ vai: "quan-tri", shop: "s", tenShop: "", maMay: "", tenMay: "", manh: [], truc: false, phatLuc: t, hetLuc: t }, signingKey), /hetLuc/);
});

test("landing registration: bad address refused; success returns the public key and an inbox token; the token maps to the shop; re-registering kills the old token", async () => {
  const { license, signingKey } = await buildService();
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", hetHan: NEXT_YEAR });
  assert.equal((await license.registerLanding({ key, diaChi: "ftp://x" }) as { viSao: string }).viSao, "dia_chi_sai");
  assert.equal((await license.registerLanding({ key, diaChi: "https://toprun.site/admin" }) as { viSao: string }).viSao, "dia_chi_sai");
  assert.equal((await license.registerLanding({ key: "TR-AAAA-AAAA-AAAA-AAAA", diaChi: "https://toprun.site" }) as { viSao: string }).viSao, "key_khong_co");

  const first = await license.registerLanding({ key, diaChi: "https://toprun.site/" });
  assert.ok(first.ok);
  assert.equal(first.shop, "toprun");
  assert.equal(first.keyId, signingKey.keyId);
  assert.equal(first.khoaCongPem, signingKey.khoaCongPem);
  assert.equal(first.diaChiXeon, "https://xeon.toprun.vn");
  assert.match(first.maNhanTin, /^nt-[A-Za-z0-9_-]{20,}$/);
  assert.equal(license.tenantForInboxToken(first.maNhanTin), "toprun");
  assert.equal(license.tenantForInboxToken("nt-khong-co"), null);
  assert.equal(license.tenantForInboxToken(""), null);
  assert.equal(license.viewKey(key)!.landing!.diaChi, "https://toprun.site", "trailing slash removed");
  assert.ok(!JSON.stringify(license.viewKey(key)).includes(first.maNhanTin), "viewKey must not leak the inbox token");
  assert.ok(!JSON.stringify(license.listKeys()).includes(first.maNhanTin));

  const second = await license.registerLanding({ key, diaChi: "https://toprun.site" });
  assert.ok(second.ok);
  assert.notEqual(second.maNhanTin, first.maNhanTin);
  assert.equal(license.tenantForInboxToken(first.maNhanTin), null, "the old token is dead");
  assert.equal(license.tenantForInboxToken(second.maNhanTin), "toprun");
});

test("the brain serves only: valid key + chatbot module + registered landing; the service ticket lives 1 hour", async () => {
  const { license, clock, signingKey } = await buildService();
  assert.equal((license.serviceEligibility("toprun") as { viSao: string }).viSao, "khong_co_key");

  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", manh: ["hop-thu"], hetHan: "2026-10-01T00:00:00.000Z" });
  assert.equal((license.serviceEligibility("toprun") as { viSao: string }).viSao, "chua_mua_chatbot");
  await license.setModules(key, ["hop-thu", "chatbot-cskh"]);
  assert.equal((license.serviceEligibility("toprun") as { viSao: string }).viSao, "landing_chua_dang_ky");
  await license.registerLanding({ key, diaChi: "https://toprun.site" });
  const eligible = license.serviceEligibility("toprun");
  assert.ok(eligible.ok);
  assert.equal(eligible.diaChi, "https://toprun.site");

  const { ve, hetLuc } = license.issueServiceTicket("toprun");
  assert.equal(hetLuc, T0.getTime() + SERVICE_TICKET_TTL_MS);
  const d = verifyTicket(ve, { publicKeyForKeyId: () => signingKey.khoaCongPem, now: clock.now() });
  assert.ok(d.hopLe);
  assert.equal(d.than.vai, "dich-vu");
  assert.equal(d.than.shop, "toprun");

  await license.lockKey(key, "x");
  assert.equal((license.serviceEligibility("toprun") as { viSao: string }).viSao, "khong_co_key");
  assert.throws(() => license.issueServiceTicket("toprun"), /khong co key/);
  await license.unlockKey(key);
  clock.advance(60 * 24 * 3600 * 1000);
  assert.equal((license.serviceEligibility("toprun") as { viSao: string }).viSao, "key_het_han");
});

test("the ledger is written to disk and reloaded: after a restart Xeon still knows the machines and the inbox token", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xeon-license-"));
  const signingKey = new SigningKeyStore(directory).loadOrCreate();
  assert.equal(signingKey.created, true);
  const a = await buildService({ directory, signingKey });
  const { key } = await a.license.issueKey({ shop: "toprun", tenShop: "TopRun", hetHan: NEXT_YEAR });
  await a.license.checkMachine({ key, ...MACHINE(1) });
  const registered = await a.license.registerLanding({ key, diaChi: "https://toprun.site" });
  assert.ok(registered.ok);

  const reloadedKey = new SigningKeyStore(directory).loadOrCreate();
  assert.equal(reloadedKey.created, false);
  assert.equal(reloadedKey.keyId, signingKey.keyId, "reloads the same key");
  const b = await buildService({ directory, signingKey: reloadedKey });
  assert.equal(b.license.viewKey(key)!.may.length, 1);
  assert.equal(b.license.tenantForInboxToken(registered.maNhanTin), "toprun");
  const r = await b.license.checkMachine({ key, ...MACHINE(1) });
  assert.equal(r.ok, true);
  assert.equal(b.license.viewKey(key)!.may.length, 1, "the machine is not recorded twice");

  // The private key lives in its own file, never inside the ledger.
  const ledgerText = fs.readFileSync(path.join(directory, "license.json"), "utf8");
  assert.ok(!ledgerText.includes("PRIVATE KEY"));
  assert.ok(fs.existsSync(path.join(directory, "xeon.ky.key.pem")));
  fs.rmSync(directory, { recursive: true, force: true });
});

test("a ledger file with the wrong shape refuses to open and is never overwritten", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xeon-license-hong-"));
  fs.writeFileSync(path.join(directory, "license.json"), JSON.stringify({ gi: 1 }));
  await assert.rejects(() => LicenseLedger.open({ directory }), /khong dung hinh dang/);
  assert.equal(fs.readFileSync(path.join(directory, "license.json"), "utf8"), JSON.stringify({ gi: 1 }));
  fs.rmSync(directory, { recursive: true, force: true });
});

test("signing key: sign then verify; another key fails; a broken signature does not throw", () => {
  const k = generateSigningKey();
  const s = signText(k.khoaRiengPem, "xin chao");
  assert.equal(verifyText(k.khoaCongPem, "xin chao", s), true);
  assert.equal(verifyText(k.khoaCongPem, "xin chao!", s), false);
  assert.equal(verifyText(generateSigningKey().khoaCongPem, "xin chao", s), false);
  assert.equal(verifyText("khong phai pem", "xin chao", s), false);
  assert.equal(verifyText(k.khoaCongPem, "xin chao", "@@@"), false);
  assert.match(k.keyId, /^ky-[A-Za-z0-9_-]{16}$/);
});

test("a machine leaving on its own frees a seat; the duty passes on; leaving twice is 'may_khong_co'", async () => {
  const { license } = await buildService();
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", hetHan: NEXT_YEAR });
  for (const n of [1, 2, 3]) await license.checkMachine({ key, ...MACHINE(n) });
  assert.equal((await license.checkMachine({ key, ...MACHINE(4) }) as { viSao: string }).viSao, "da_day");
  const left = await license.leaveMachine({ key, maMay: MACHINE(1).maMay });
  assert.deepEqual(left, { ok: true, conLai: 2 });
  assert.equal(license.viewKey(key)!.may.find((m) => m.truc)!.tenMay, "Máy 2", "duty passes to the next machine");
  assert.equal((await license.checkMachine({ key, ...MACHINE(4) })).ok, true, "a seat for the fourth machine");
  assert.equal((await license.leaveMachine({ key, maMay: MACHINE(1).maMay }) as { viSao: string }).viSao, "may_khong_co");
  assert.equal((await license.leaveMachine({ key: "TR-AAAA-AAAA-AAAA-AAAA", maMay: MACHINE(1).maMay }) as { viSao: string }).viSao, "key_khong_co");
});
