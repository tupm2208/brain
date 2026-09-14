/**
 * The admin page and the machine page over a real socket.
 *
 * The pages are HTML + JS calling APIs; these tests check the APIs and that the JS only refers
 * to element ids that really exist in the HTML (no dead buttons).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AdminController, CONTENT_SECURITY_POLICY, LicenseLedger, LicenseService, ManualClock, MemoryLogger, PAGES_DIRECTORY,
  StaticPageStore, createXeonServer, generateSigningKey
} from "@sp/xeon";

const T0 = new Date("2026-09-14T08:00:00.000Z");
const CHOICES = [
  { id: "hang-kho", ten: "Hang hoa & kho", loi: true }, { id: "don-khach", ten: "Don hang", loi: true },
  { id: "gian-hang", ten: "Gian hang", loi: true }, { id: "chatbot-cskh", ten: "Chatbot", loi: false },
  { id: "van-chuyen", ten: "Van chuyen", loi: false }
];
const PASSWORD = "mat-khau-cua-anh-dung";

async function startServer({ adminPassword = PASSWORD }: { adminPassword?: string } = {}) {
  const clock = new ManualClock(T0);
  const signingKey = generateSigningKey();
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({
    ledger, signingKey, clock, sellableModules: CHOICES.map((m) => m.id), coreModules: CHOICES.filter((m) => m.loi).map((m) => m.id)
  });
  const logger = new MemoryLogger();
  const server = createXeonServer({
    controllers: [new AdminController({ license, pages: new StaticPageStore(PAGES_DIRECTORY), adminPassword, moduleChoices: CHOICES, clock, logger })]
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = "";
  const call = async (p: string, { method = "GET", body, headers = {}, noCookie = false }: { method?: string; body?: unknown; headers?: Record<string, string>; noCookie?: boolean } = {}) => {
    const requestHeaders: Record<string, string> = { "Content-Type": "application/json", ...headers };
    if (cookie && !noCookie) requestHeaders["Cookie"] = cookie;
    const init: RequestInit = { method, headers: requestHeaders, redirect: "manual" };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(`${origin}${p}`, init);
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0]!;
    const type = response.headers.get("content-type") || "";
    const parsed = type.includes("json") ? await response.json() as Record<string, unknown> : await response.text();
    return { status: response.status, headers: response.headers, body: parsed };
  };
  const post = (p: string, body: unknown, extra: { noCookie?: boolean } = {}) => call(p, { method: "POST", body, headers: { "X-Yeu-Cau": "xeon" }, ...extra });
  return { call, post, license, clock, logger, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const json = (r: { body: unknown }) => r.body as Record<string, unknown>;

test("pages are served with a strict CSP; every byId(...) in the JS exists in the HTML", async () => {
  const { call, close } = await startServer();
  try {
    for (const [p, type] of [["/quan-tri", "text/html"], ["/quan-tri/app.js", "text/javascript"], ["/quan-tri/chung.css", "text/css"], ["/may", "text/html"], ["/may/app.js", "text/javascript"]] as const) {
      const r = await call(p);
      assert.equal(r.status, 200, p);
      assert.ok(r.headers.get("content-type")!.startsWith(type), p);
      assert.equal(r.headers.get("content-security-policy"), CONTENT_SECURITY_POLICY);
    }
    for (const [html, js] of [["admin.html", "admin.js"], ["machines.html", "machines.js"]] as const) {
      const h = fs.readFileSync(path.join(PAGES_DIRECTORY, html), "utf8");
      const j = fs.readFileSync(path.join(PAGES_DIRECTORY, js), "utf8");
      assert.ok(!/<script>|<style>|\son[a-z]+="|\sstyle="/.test(h), `${html}: no inline script/style/handler (the CSP blocks them)`);
      const ids = [...j.matchAll(/byId\("([a-z0-9-]+)"\)/g)].map((m) => m[1]!);
      assert.ok(ids.length > 5);
      for (const id of new Set(ids)) assert.ok(h.includes(`id="${id}"`), `${js} uses byId("${id}") but ${html} has no such element`);
    }
  } finally { await close(); }
});

test("admin: not logged in 401; missing X-Yeu-Cau 403; wrong password 401 and counted; right password sets an HttpOnly SameSite=Strict cookie", async () => {
  const { call, post, logger, close } = await startServer();
  try {
    assert.equal(json(await call("/quan-tri/api/toi"))["dangNhap"], false);
    assert.equal((await post("/quan-tri/api/key/danh-sach", {})).status, 401);
    assert.equal((await call("/quan-tri/api/dang-nhap", { method: "POST", body: { matKhau: PASSWORD } })).status, 403, "no custom header");

    const wrong = await post("/quan-tri/api/dang-nhap", { matKhau: "sai" });
    assert.equal(wrong.status, 401);
    assert.match(logger.warnings.at(-1)!, /dang nhap sai/);

    const login = await post("/quan-tri/api/dang-nhap", { matKhau: PASSWORD });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\/quan-tri/);
    assert.equal(json(await call("/quan-tri/api/toi"))["dangNhap"], true);
    assert.equal((await post("/quan-tri/api/key/danh-sach", {})).status, 200);

    await post("/quan-tri/api/dang-xuat", {});
    assert.equal((await post("/quan-tri/api/key/danh-sach", {})).status, 401, "logged out");
  } finally { await close(); }
});

test("ten wrong logins in 15 minutes give 429, even with the right password", async () => {
  const { post, clock, close } = await startServer();
  try {
    for (let i = 0; i < 10; i += 1) assert.equal((await post("/quan-tri/api/dang-nhap", { matKhau: "sai" })).status, 401);
    assert.equal((await post("/quan-tri/api/dang-nhap", { matKhau: PASSWORD })).status, 429);
    clock.advance(15 * 60 * 1000 + 1);
    assert.equal((await post("/quan-tri/api/dang-nhap", { matKhau: PASSWORD })).status, 200);
  } finally { await close(); }
});

test("the admin session expires after 12 hours", async () => {
  const { post, clock, close } = await startServer();
  try {
    await post("/quan-tri/api/dang-nhap", { matKhau: PASSWORD });
    clock.advance(11 * 3600 * 1000);
    assert.equal((await post("/quan-tri/api/key/danh-sach", {})).status, 200);
    clock.advance(2 * 3600 * 1000);
    assert.equal((await post("/quan-tri/api/key/danh-sach", {})).status, 401);
  } finally { await close(); }
});

test("an admin password shorter than 12 characters DISABLES the page (503) and /toi says bat=false", async () => {
  const { call, post, logger, close } = await startServer({ adminPassword: "ngan" });
  try {
    assert.match(logger.warnings[0]!, /DANG TAT/);
    assert.equal(json(await call("/quan-tri/api/toi"))["bat"], false);
    assert.equal((await post("/quan-tri/api/dang-nhap", { matKhau: "ngan" })).status, 503);
  } finally { await close(); }
});

test("the owner's full loop: issue -> list -> modules -> extend -> remove machine -> duty -> lock -> unlock", async () => {
  const { post, license, close } = await startServer();
  try {
    await post("/quan-tri/api/dang-nhap", { matKhau: PASSWORD });
    const bad = await post("/quan-tri/api/key/cap", { shop: "TopRun!", tenShop: "x", hetHan: "2027-01-01T00:00:00.000Z" });
    assert.equal(bad.status, 400);
    assert.match(String(json(bad)["message"]), /Ma shop/);

    const issued = await post("/quan-tri/api/key/cap", { shop: "toprun", tenShop: "TopRun", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z", soMay: 2 });
    assert.equal(issued.status, 200);
    assert.match(String(json(issued)["key"]), /^TR-/);
    assert.equal((json(issued)["chiTiet"] as { soMay: number }).soMay, 2);
    const key = String(json(issued)["key"]);

    const list = await post("/quan-tri/api/key/danh-sach", {});
    const keys = json(list)["key"] as { shop: string }[];
    assert.equal(keys.length, 1);
    assert.equal(keys[0]!.shop, "toprun");

    assert.equal(json(await post("/quan-tri/api/key/manh", { key, manh: ["chatbot-cskh", "van-chuyen"] }))["ok"], true);
    assert.deepEqual(license.viewKey(key)!.manh, ["chatbot-cskh", "don-khach", "gian-hang", "hang-kho", "van-chuyen"]);
    assert.equal((await post("/quan-tri/api/key/manh", { key, manh: ["la"] })).status, 400);
    assert.equal(json(await post("/quan-tri/api/key/gia-han", { key, hetHan: "2028-01-01T00:00:00.000Z" }))["ok"], true);
    assert.equal(license.viewKey(key)!.hetHan, "2028-01-01T00:00:00.000Z");

    await license.checkMachine({ key, maMay: "may-mot-xxxxxxxxxxxx", tenMay: "Máy 1" });
    await license.checkMachine({ key, maMay: "may-hai-xxxxxxxxxxxx", tenMay: "Máy 2" });
    const machines = license.viewKey(key)!.may;
    assert.equal(json(await post("/quan-tri/api/key/may-truc", { key, mayId: machines[1]!.id }))["ok"], true);
    assert.equal(license.viewKey(key)!.may[1]!.truc, true);
    const removed = json(await post("/quan-tri/api/key/da-may", { key, mayId: machines[1]!.id }));
    assert.equal(removed["ok"], true);
    const remaining = removed["may"] as { truc: boolean }[];
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]!.truc, true, "duty passes to the remaining machine");

    assert.equal(json(await post("/quan-tri/api/key/khoa", { key, lyDo: "test" }))["ok"], true);
    assert.equal(license.viewKey(key)!.trangThai, "bi_khoa");
    assert.equal(json(await post("/quan-tri/api/key/mo", { key }))["ok"], true);
    assert.equal(license.viewKey(key)!.trangThai, "dang_dung");
    assert.equal((await post("/quan-tri/api/key/khong-co", {})).status, 404);
  } finally { await close(); }
});

test("machine page: the key is the credential; view, remove, duty; wrong key 403; missing header 403; rate limited 429; no machine id leaks", async () => {
  const { call, post, license, clock, close } = await startServer();
  try {
    const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2027-01-01T00:00:00.000Z" });
    for (const n of [1, 2, 3]) await license.checkMachine({ key, maMay: `may-${n}-xxxxxxxxxxxxxxxx`, tenMay: `Máy ${n}` });

    assert.equal((await call("/may/api/xem", { method: "POST", body: { key } })).status, 403, "missing X-Yeu-Cau");
    assert.equal((await post("/may/api/xem", { key: "TR-AAAA-AAAA-AAAA-AAAA" })).status, 403);
    const view = await post("/may/api/xem", { key });
    assert.equal(view.status, 200);
    const machines = json(view)["may"] as { id: string; truc: boolean }[];
    assert.equal(json(view)["tenShop"], "TopRun");
    assert.equal(machines.length, 3);
    assert.equal(machines[0]!.truc, true);
    assert.ok(!JSON.stringify(view.body).includes("may-1-xxxx"), "the full machine id must not leak");

    const id3 = machines[2]!.id;
    assert.equal(json(await post("/may/api/truc", { key, mayId: id3 }))["ok"], true);
    assert.equal((license.isOnDuty({ key, maMay: "may-3-xxxxxxxxxxxxxxxx" }) as { truc: boolean }).truc, true);
    const removed = json(await post("/may/api/da", { key, mayId: machines[0]!.id }));
    assert.equal(removed["ok"], true);
    assert.equal((removed["may"] as unknown[]).length, 2);
    assert.equal((await license.checkMachine({ key, maMay: "may-4-xxxxxxxxxxxxxxxx", tenMay: "Máy 4" })).ok, true, "a fourth machine gets in after a removal");

    for (let i = 0; i < 27; i += 1) await post("/may/api/xem", { key });
    assert.equal((await post("/may/api/xem", { key })).status, 429);
    clock.advance(15 * 60 * 1000 + 1);
    assert.equal((await post("/may/api/xem", { key })).status, 200);
  } finally { await close(); }
});
