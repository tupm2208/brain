/**
 * The developer app's "Data deletion request" and "Deauthorize" callbacks (02/10/2026): Meta names a
 * person by their app-scoped id in a `signed_request`; Xeon finds the pages that person's login
 * connected, stops routing them, asks the shop's landing to forget their tokens, and answers with a
 * confirmation code and a status page. Real socket, fake Meta, fake landing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  APP_USERS_FILE, LicenseLedger, LicenseService, ManualClock, MemoryLogger, MetaAppUserBook, MetaController, MetaDataDeletion, MetaForwarder,
  MetaGraphClient, ActivityLog, createXeonServer, generateSigningKey, signRequest, signedRequestFromBody, verifySignedRequest, verifyTicket, type FetchLike
} from "@sp/xeon";

const T0 = new Date("2026-10-02T08:00:00.000Z");
const MODULES = ["hang-kho", "don-khach", "gian-hang", "hop-thu", "chatbot-cskh"];
const CORE = ["hang-kho", "don-khach", "gian-hang"];
const APP_SECRET = "bi-mat-app-meta-thu";
/** App-scoped ids of the fake people — they must never appear in the store file. */
const PERSON_P = "1029384756102938";
const PERSON_Q = "5647382910564738";
/** Login code -> user token -> person; a token whose `/me` fails is `tk-loi-id`. */
const CODES: Record<string, string> = { "ma-p": "tk-p", "ma-q": "tk-q", "ma-loi-id": "tk-loi-id" };
const PEOPLE: Record<string, string> = { "tk-p": PERSON_P, "tk-q": PERSON_Q };
const PAGES: Record<string, { id: string; name: string }> = { "tk-trang-a": { id: "trang-a", name: "Trang A" } };

interface LandingCall { origin: string; path: string; body: Record<string, unknown>; token: string }

async function setup({ appSecret = APP_SECRET, landingDown = false } = {}) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "xeon-xoa-"));
  const clock = new ManualClock(T0);
  const signingKey = generateSigningKey();
  const license = new LicenseService({ ledger: await LicenseLedger.open(), signingKey, clock, xeonAddress: "https://xeon.test", sellableModules: MODULES, coreModules: CORE });
  const logger = new MemoryLogger();
  const shopA = await license.issueKey({ shop: "shop-a", tenShop: "Shop A", manh: ["hop-thu"], hetHan: "2027-01-01T00:00:00.000Z" });
  const regA = await license.registerLanding({ key: shopA.key, diaChi: "https://a.test" });
  if (!regA.ok) throw new Error("landing registration failed");

  const landingCalls: LandingCall[] = [];
  const network = { landingDown };
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const reply = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload });
    if (u.hostname === "graph.facebook.com") {
      const token = u.searchParams.get("access_token") ?? "";
      if (u.pathname.endsWith("/oauth/access_token")) {
        const userToken = CODES[u.searchParams.get("code") ?? ""];
        return userToken ? reply({ access_token: userToken }) : reply({ error: { message: "Invalid code" } }, 400);
      }
      if (u.pathname.endsWith("/me/accounts")) return token in PEOPLE || token === "tk-loi-id" ? reply({ data: [{ id: "trang-a", name: "Trang A", access_token: "tk-trang-a" }] }) : reply({ error: { message: "bad" } }, 400);
      if (u.pathname.endsWith("/me")) {
        if (PEOPLE[token]) return reply({ id: PEOPLE[token] });
        if (PAGES[token]) return reply(PAGES[token]);
        return reply({ error: { message: "Invalid OAuth access token." } }, 400);
      }
      if (u.pathname.endsWith("/subscribed_apps")) return reply({ success: true });
      return reply({ error: { message: "khong biet" } }, 404);
    }
    if (network.landingDown) throw new Error("mat mang");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    landingCalls.push({ origin: u.origin, path: u.pathname, body, token: String(init.headers["Authorization"] ?? "").replace(/^Bearer /, "") });
    return reply({ ok: true, daQuen: body["trang"], daMatKetNoi: [], khongCo: [] });
  };

  const book = new MetaAppUserBook({ secret: appSecret, clock, logger, dataDirectory });
  const activityLog = new ActivityLog({ clock });
  const dataDeletion = new MetaDataDeletion({ book, license, clock, logger, fetch, activityLog });
  const server = createXeonServer({
    activityLog,
    controllers: [
      new MetaController({
        license, forwarder: new MetaForwarder({ license, clock, logger, fetch }), graph: new MetaGraphClient({ fetch }),
        appSecret, verifyToken: "v", appId: "app-thu", xeonAddress: "https://xeon.test", logger, activityLog, dataDeletion
      })
    ]
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (p: string, { method = "GET", body, token, contentType = "application/json" }: { method?: string; body?: unknown; token?: string; contentType?: string } = {}) => {
    const h: Record<string, string> = { "Content-Type": contentType };
    if (token) h["Authorization"] = `Bearer ${token}`;
    const init: RequestInit = { method, headers: h };
    if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
    const real = await globalThis.fetch(`${origin}${p}`, init);
    const text = await real.text();
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
    return { status: real.status, text, body: json, headers: real.headers };
  };

  /** The whole Facebook Login: start, Meta's redirect with `code`, the landing collects. */
  const login = async (code: string, collect = true) => {
    const start = await call("/meta/dang-nhap", { method: "POST", token: regA.maNhanTin, body: {} });
    const state = String(start.body!["maPhien"]);
    const back = await call(`/meta/dang-nhap/xong?state=${state}&code=${code}`);
    assert.equal(back.status, 200, back.text);
    if (!collect) return state;
    const got = await call(`/meta/dang-nhap/ket-qua?maPhien=${state}`, { token: regA.maNhanTin });
    assert.equal(got.body!["xong"], true);
    // What the landing then does (`/api/hop-thu/ket-noi-facebook/xong`): route the pages at Xeon.
    await call("/meta/trang", { method: "POST", token: regA.maNhanTin, body: { trang: [{ ma: "trang-a", token: "tk-trang-a" }] } });
    return state;
  };
  /** Meta's form-encoded callback body. */
  const callback = (route: string, userId: string, { secret = appSecret || APP_SECRET, algorithm = "HMAC-SHA256" } = {}) =>
    call(route, { method: "POST", contentType: "application/x-www-form-urlencoded", body: `signed_request=${encodeURIComponent(signRequest({ algorithm, expires: 0, issued_at: 1790928000, user_id: userId }, secret))}` });
  const storeText = () => (fs.existsSync(path.join(dataDirectory, APP_USERS_FILE)) ? fs.readFileSync(path.join(dataDirectory, APP_USERS_FILE), "utf8") : "");

  return {
    call, login, callback, storeText, book, license, signingKey, clock, logger, landingCalls, network, activityLog, dataDirectory, inboxA: regA.maNhanTin,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

// ------------------------------------------------------------------------------ signed_request

test("signed_request: Meta's own shape verifies and yields the app-scoped id; the algorithm is case-insensitive", () => {
  const good = verifySignedRequest(signRequest({ algorithm: "HMAC-SHA256", expires: 0, issued_at: 1790928000, user_id: PERSON_P }, APP_SECRET), APP_SECRET);
  assert.deepEqual(good, { ok: true, value: { userId: PERSON_P, issuedAt: 1790928000, expires: 0 } });
  const lower = verifySignedRequest(signRequest({ algorithm: "hmac-sha256", user_id: PERSON_P }, APP_SECRET), APP_SECRET);
  assert.equal(lower.ok, true);
  const numeric = verifySignedRequest(signRequest({ algorithm: "HMAC-SHA256", user_id: 42 }, APP_SECRET), APP_SECRET);
  assert.ok(numeric.ok && numeric.value.userId === "42", "a numeric user_id is read as text");
});

test("signed_request: wrong secret, wrong algorithm, malformed, missing user_id, oversized and no secret are all refused", () => {
  const signed = signRequest({ algorithm: "HMAC-SHA256", user_id: PERSON_P }, APP_SECRET);
  const why = (sr: string | null, secret = APP_SECRET) => { const r = verifySignedRequest(sr, secret); return r.ok ? "ok" : r.viSao; };
  assert.equal(why(signRequest({ algorithm: "HMAC-SHA256", user_id: PERSON_P }, "khoa-cua-ke-gia")), "sai_chu_ky");
  assert.equal(why(signRequest({ algorithm: "HMAC-SHA1", user_id: PERSON_P }, APP_SECRET)), "sai_thuat_toan");
  assert.equal(why(signRequest({ user_id: PERSON_P }, APP_SECRET)), "sai_thuat_toan");
  assert.equal(why(signRequest({ algorithm: "HMAC-SHA256" }, APP_SECRET)), "thieu_user_id");
  assert.equal(why(signRequest({ algorithm: "HMAC-SHA256", user_id: "" }, APP_SECRET)), "thieu_user_id");
  assert.equal(why(signRequest({ algorithm: "HMAC-SHA256", user_id: "<script>" }, APP_SECRET)), "thieu_user_id");
  assert.equal(why("khong-co-dau-cham"), "sai_dinh_dang");
  assert.equal(why(`${signed}.them`), "sai_dinh_dang");
  assert.equal(why(`a b.${signed.split(".")[1]}`), "sai_dinh_dang");
  // A correctly signed payload that is not JSON: the signature passes, the payload does not.
  const notJson = Buffer.from("khong phai json").toString("base64url");
  assert.equal(why(`${crypto.createHmac("sha256", APP_SECRET).update(notJson).digest("base64url")}.${notJson}`), "sai_dinh_dang");
  // The signature part tampered by one character.
  const [s0, p0] = signed.split(".") as [string, string];
  assert.equal(why(`${s0.slice(0, -1)}${s0.endsWith("A") ? "B" : "A"}.${p0}`), "sai_chu_ky");
  assert.equal(why("x".repeat(9000) + "." + p0), "qua_dai");
  assert.equal(why(""), "thieu_signed_request");
  assert.equal(why(null), "thieu_signed_request");
  assert.equal(why(signed, ""), "chua_cau_hinh");
});

test("signed_request: read from Meta's form body or from JSON; anything else is none", () => {
  const sr = signRequest({ algorithm: "HMAC-SHA256", user_id: PERSON_P }, APP_SECRET);
  assert.equal(signedRequestFromBody(Buffer.from(`signed_request=${encodeURIComponent(sr)}`), "application/x-www-form-urlencoded"), sr);
  assert.equal(signedRequestFromBody(Buffer.from(JSON.stringify({ signed_request: sr })), "application/json"), sr);
  assert.equal(signedRequestFromBody(Buffer.from(JSON.stringify({ signed_request: sr })), ""), sr, "JSON is recognised without its header");
  assert.equal(signedRequestFromBody(Buffer.from(""), "application/x-www-form-urlencoded"), null);
  assert.equal(signedRequestFromBody(Buffer.from("{khong-hop-le"), "application/json"), null);
  assert.equal(signedRequestFromBody(Buffer.from(JSON.stringify({ signed_request: 5 })), "application/json"), null);
});

// ------------------------------------------------------------------------------ login records a key, never the id

test("login: the person is recorded as a keyed hash when the landing collects the pages — the raw id, name and tokens never reach the file", async () => {
  const x = await setup();
  try {
    const state = await x.login("ma-p", false);
    assert.equal(x.book.personCount(), 0, "not collected yet = the landing holds nothing of this person");
    await x.call(`/meta/dang-nhap/ket-qua?maPhien=${state}`, { token: x.inboxA });
    assert.equal(x.book.personCount(), 1);

    const text = x.storeText();
    const file = JSON.parse(text) as { nguoi: Record<string, { theoShop: Record<string, { trang: string[] }> }> };
    const key = x.book.keyOf(PERSON_P);
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(file.nguoi), [key]);
    assert.deepEqual(file.nguoi[key]!.theoShop["shop-a"]!.trang, ["trang-a"]);
    for (const secret of [PERSON_P, "tk-p", "tk-trang-a", "Trang A", APP_SECRET]) assert.ok(!text.includes(secret), `${secret} must never be stored`);

    // The same person connecting again keeps one record.
    await x.login("ma-p");
    assert.equal(x.book.personCount(), 1);
  } finally { await x.close(); }
});

test("login: Meta not giving the person's id never breaks the login — it is logged and nothing is recorded", async () => {
  const x = await setup();
  try {
    await x.login("ma-loi-id");
    assert.equal(x.book.personCount(), 0);
    assert.ok(x.logger.warnings.some((w) => w.includes("khong doc duoc id nguoi dung")));
    assert.equal(x.license.shopForPage("trang-a"), "shop-a", "the page is connected all the same");
  } finally { await x.close(); }
});

// ------------------------------------------------------------------------------ the deletion callback

test("deletion callback end to end: the page stops routing, the landing forgets its token, the person is gone, Meta gets url + code, the status page tells it", async () => {
  const x = await setup();
  try {
    await x.login("ma-p");
    assert.equal(x.license.shopForPage("trang-a"), "shop-a");

    const r = await x.callback("/meta/xoa-du-lieu", PERSON_P);
    assert.equal(r.status, 200, r.text);
    const code = String(r.body!["confirmation_code"]);
    assert.match(code, /^[A-Z0-9]{12}$/);
    assert.deepEqual(r.body, { url: `https://xeon.test/meta/xoa-du-lieu/trang-thai?ma=${code}`, confirmation_code: code });

    assert.equal(x.license.shopForPage("trang-a"), null, "Xeon no longer routes the page");
    const told = x.landingCalls.filter((c) => c.path === "/api/hop-thu/quen-trang");
    assert.equal(told.length, 1);
    assert.equal(told[0]!.origin, "https://a.test");
    assert.deepEqual(told[0]!.body, { trang: ["trang-a"], lyDo: "nguoi-cap-quyen-go-app" });
    const ticket = verifyTicket(told[0]!.token, { publicKeyForKeyId: () => x.signingKey.khoaCongPem, now: x.clock.now() });
    assert.ok(ticket.hopLe && ticket.than.shop === "shop-a" && ticket.than.vai === "dich-vu", "a service ticket naming the shop");

    assert.equal(x.book.personCount(), 0, "the person's record is deleted");
    assert.ok(!x.storeText().includes(x.book.keyOf(PERSON_P)));
    assert.deepEqual(x.book.request(code), { loai: "xoa-du-lieu", nhanLuc: T0.toISOString(), xongLuc: T0.toISOString(), trangThai: "da-xoa", soTrang: 1 });

    const page = await x.call(`/meta/xoa-du-lieu/trang-thai?ma=${code}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.ok(page.text.includes(code));
    assert.ok(page.text.includes("Đã xoá xong."));
    assert.ok(page.text.includes("02/10/2026 15:00 (giờ Việt Nam)"));
    assert.match(page.text, /Số kết nối trang đã gỡ<\/th><td>1</);
    assert.ok(page.text.includes("không bao giờ lưu tên, email hay mật khẩu Facebook"));
    assert.ok(page.text.includes("Data deletion request"));
    for (const name of ["shop-a", "trang-a", PERSON_P, "a.test"]) assert.ok(!page.text.includes(name), `${name} must not show on a public page`);
    assert.equal((await x.call(`/meta/xoa-du-lieu/trang-thai?ma=${code.toLowerCase()}`)).status, 200, "the code is read case-insensitively");

    const unknown = await x.call("/meta/xoa-du-lieu/trang-thai?ma=KHONGCOMANAY1");
    assert.equal(unknown.status, 404);
    assert.ok(unknown.text.includes("Không tìm thấy yêu cầu"));
    assert.equal((await x.call("/meta/xoa-du-lieu/trang-thai?ma=<script>")).status, 404);
    assert.ok(!(await x.call("/meta/xoa-du-lieu/trang-thai?ma=%3Cb%3E")).text.includes("<b>"), "nothing from the query is echoed raw");

    const logged = x.activityLog.recent({ loai: "meta-xoa" });
    assert.ok(logged.length >= 1);
    assert.ok(!JSON.stringify(logged).includes(PERSON_P), "the activity log never carries the person's id");
    assert.ok(!x.logger.infos.concat(x.logger.warnings).some((l) => l.includes(PERSON_P)));
  } finally { await x.close(); }
});

test("a person nobody recorded (e.g. pages connected before 02/10/2026): still 200 with a code, status 'khong-co-du-lieu', nothing touched", async () => {
  const x = await setup();
  try {
    await x.license.connectPages("shop-a", [{ ma: "trang-a", ten: "A" }]);
    const r = await x.callback("/meta/xoa-du-lieu", "9999999999");
    assert.equal(r.status, 200);
    const code = String(r.body!["confirmation_code"]);
    assert.equal(x.book.request(code)!.trangThai, "khong-co-du-lieu");
    assert.equal(x.book.request(code)!.soTrang, 0);
    assert.equal(x.license.shopForPage("trang-a"), "shop-a");
    assert.equal(x.landingCalls.filter((c) => c.path === "/api/hop-thu/quen-trang").length, 0);
    const page = await x.call(`/meta/xoa-du-lieu/trang-thai?ma=${code}`);
    assert.ok(page.text.includes("Không có dữ liệu nào cần xoá"));
  } finally { await x.close(); }
});

test("deauthorize callback: same undo, plain 200; a deletion request afterwards finds nothing left", async () => {
  const x = await setup();
  try {
    await x.login("ma-p");
    const r = await x.callback("/meta/go-app", PERSON_P);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
    assert.equal(x.license.shopForPage("trang-a"), null);
    assert.equal(x.landingCalls.filter((c) => c.path === "/api/hop-thu/quen-trang").length, 1);
    assert.equal(x.book.personCount(), 0);

    const later = await x.callback("/meta/xoa-du-lieu", PERSON_P);
    assert.equal(x.book.request(String(later.body!["confirmation_code"]))!.trangThai, "khong-co-du-lieu");
  } finally { await x.close(); }
});

test("a login still waiting for its landing is dropped when its person removes the app", async () => {
  const x = await setup();
  try {
    const state = await x.login("ma-p", false);
    await x.call(`/meta/dang-nhap/ket-qua?maPhien=${state}`, { token: x.inboxA });
    const waiting = await x.login("ma-p", false);
    await x.callback("/meta/go-app", PERSON_P);
    assert.equal((await x.call(`/meta/dang-nhap/ket-qua?maPhien=${waiting}`, { token: x.inboxA })).status, 404, "the tokens of that login are not handed over afterwards");
  } finally { await x.close(); }
});

test("a page reconnected through ANOTHER person's login belongs to that person: the first one removing the app leaves it connected", async () => {
  const x = await setup();
  try {
    await x.login("ma-p");
    await x.login("ma-q");
    const r = await x.callback("/meta/xoa-du-lieu", PERSON_P);
    assert.equal(x.book.request(String(r.body!["confirmation_code"]))!.trangThai, "khong-co-du-lieu", "P's record no longer covers the page");
    assert.equal(x.license.shopForPage("trang-a"), "shop-a");
    await x.callback("/meta/xoa-du-lieu", PERSON_Q);
    assert.equal(x.license.shopForPage("trang-a"), null);
  } finally { await x.close(); }
});

test("the landing unreachable: Xeon still disconnects and forgets the person; the status says the shop's server has not confirmed", async () => {
  const x = await setup();
  try {
    await x.login("ma-p");
    x.network.landingDown = true;
    const r = await x.callback("/meta/xoa-du-lieu", PERSON_P);
    assert.equal(r.status, 200);
    const code = String(r.body!["confirmation_code"]);
    assert.deepEqual({ ...x.book.request(code)!, nhanLuc: "", xongLuc: "" }, { loai: "xoa-du-lieu", nhanLuc: "", xongLuc: "", trangThai: "landing-chua-nhan", soTrang: 1 });
    assert.equal(x.license.shopForPage("trang-a"), null);
    assert.equal(x.book.personCount(), 0);
    assert.ok(x.logger.warnings.some((w) => w.includes("chua xac nhan quen token")));
    assert.ok((await x.call(`/meta/xoa-du-lieu/trang-thai?ma=${code}`)).text.includes("chưa xác nhận đã xoá mã truy cập trang"));
  } finally { await x.close(); }
});

test("a bad signature or body is 400 and changes nothing; JSON bodies are accepted too", async () => {
  const x = await setup();
  try {
    await x.login("ma-p");
    assert.equal((await x.callback("/meta/xoa-du-lieu", PERSON_P, { secret: "khoa-cua-ke-gia" })).status, 400);
    assert.equal((await x.callback("/meta/go-app", PERSON_P, { algorithm: "HMAC-SHA1" })).status, 400);
    assert.equal((await x.call("/meta/xoa-du-lieu", { method: "POST", contentType: "application/x-www-form-urlencoded", body: "khac=1" })).status, 400);
    assert.equal((await x.call("/meta/xoa-du-lieu", { method: "POST", contentType: "application/x-www-form-urlencoded", body: "signed_request=" + "a".repeat(20_000) })).status, 400, "oversized");
    assert.equal(x.license.shopForPage("trang-a"), "shop-a");
    assert.equal(x.book.personCount(), 1);
    assert.ok(x.logger.warnings.some((w) => w.includes("tu choi signed_request (sai_chu_ky)")));

    const sr = signRequest({ algorithm: "HMAC-SHA256", user_id: PERSON_P }, APP_SECRET);
    const r = await x.call("/meta/xoa-du-lieu", { method: "POST", body: { signed_request: sr } });
    assert.equal(r.status, 200);
    assert.equal(x.license.shopForPage("trang-a"), null);
  } finally { await x.close(); }
});

test("without the app secret both callbacks answer 503", async () => {
  const x = await setup({ appSecret: "" });
  try {
    assert.equal((await x.callback("/meta/xoa-du-lieu", PERSON_P)).status, 503);
    assert.equal((await x.callback("/meta/go-app", PERSON_P)).status, 503);
  } finally { await x.close(); }
});

test("requests are kept at least 90 days and the file survives a restart", async () => {
  const x = await setup();
  try {
    const r = await x.callback("/meta/xoa-du-lieu", "123");
    const code = String(r.body!["confirmation_code"]);
    x.clock.advance(100 * 24 * 60 * 60 * 1000);
    await x.callback("/meta/xoa-du-lieu", "456");
    const reopened = new MetaAppUserBook({ secret: APP_SECRET, clock: x.clock, logger: x.logger, dataDirectory: x.dataDirectory });
    assert.equal(reopened.request(code)?.trangThai, "khong-co-du-lieu", "a 100-day-old request is still there");
  } finally { await x.close(); }
});
