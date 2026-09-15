/**
 * THE POST WRITER — `POST /viet-bai`, over a real socket, with a fake model.
 *
 * Every test here runs without an API key and without spending a cent: the model sits behind a
 * port, which is the whole reason a rule like "a sold-out size never reaches the prompt" can be
 * tested at all.
 *
 * Two promises this file guards:
 *   1. The merchant is derived from the INBOX TOKEN, never from the body — shop A must not be
 *      able to spend shop B's quota, exactly as on `/tin-den`.
 *   2. The prompt says only what the brief said. Xeon holds no copy of a shop's writing rules,
 *      and must not grow one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  LicenseLedger, LicenseService, ManualClock, MemoryLogger, WriteController, buildPrompt,
  generateSigningKey, readDraft, type TextModelPort, type TextOutcome, type TextRequest, type WriteBriefBody
} from "@sp/xeon";

const T0 = new Date("2026-09-15T08:00:00.000Z");
const NEXT_YEAR = "2027-09-15T00:00:00.000Z";

/** A model that never opens a socket: it records what it was asked and answers what the test set. */
class FakeModel implements TextModelPort {
  readonly asked: TextRequest[] = [];
  private answer: TextOutcome;
  private on: boolean;
  // Plain fields, not parameter properties: `node --test` strips types only and rejects those.
  constructor(answer: TextOutcome, on = true) {
    this.answer = answer;
    this.on = on;
  }
  ready(): boolean { return this.on; }
  power(on: boolean): void { this.on = on; }
  async complete(request: TextRequest): Promise<TextOutcome> {
    this.asked.push(request);
    return this.answer;
  }
  reply(answer: TextOutcome): void { this.answer = answer; }
}

const DRAFT = { caption: "BA ĐÔI ĐÁNG CÂN NHẮC cho người mới chạy...", chuAnh: "BA ĐÔI ĐÁNG CÂN NHẮC", comment: "Xem thêm ở https://shop.test/giay, inbox em nhé" };

/**
 * Drives the controller DIRECTLY, with no listener.
 *
 * Opening a socket here crashed libuv on Windows at process teardown (`UV_HANDLE_CLOSING` in
 * `async.c`) under the runner's `--test-force-exit`, failing a file whose every assertion passed,
 * about one run in three. The HTTP plumbing itself — routing, body limits, headers — already has
 * its own coverage in `http-server.test.mts`; what this file is about is the DOOR's rules: who may
 * ask, whose merchant it is, and what happens to a bad answer. None of that needs a port.
 */
async function buildDesk(model: TextModelPort) {
  const clock = new ManualClock(T0);
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["chatbot-cskh"], coreModules: ["hang-kho"] });
  const logger = new MemoryLogger();
  const controller = new WriteController({ model, license, logger });

  const first = await license.issueKey({ shop: "toprun", tenShop: "TopRun", hetHan: NEXT_YEAR });
  const second = await license.issueKey({ shop: "shop2", tenShop: "Shop Hai", hetHan: NEXT_YEAR });
  const landingOne = await license.registerLanding({ key: first.key, diaChi: "https://shop.test" });
  const landingTwo = await license.registerLanding({ key: second.key, diaChi: "https://shop2.test" });
  assert.ok(landingOne.ok && landingTwo.ok);

  /** Posts a brief and returns what the controller wrote back. */
  const ask = async (brief: unknown, token: string | null): Promise<{ status: number; body: Record<string, any> }> => {  // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields
    let status = 0;
    let body: Record<string, any> = {};  // eslint-disable-line @typescript-eslint/no-explicit-any -- as above
    const req = { headers: token === null ? {} : { authorization: `Bearer ${token}` } } as unknown as IncomingMessage;
    const res = {
      writeHead(code: number) { status = code; return this; },
      end(text: string) { body = text ? JSON.parse(text) : {}; }
    } as unknown as ServerResponse;
    const handled = await controller.handle(req, res, {
      method: "POST", path: "/viet-bai", ip: "1.1.1.1",
      readJson: async () => brief as Record<string, unknown>
    });
    assert.equal(handled, true, "cua nay phai nhan yeu cau POST /viet-bai");
    return { status, body };
  };
  return { ask, logger, tokenOne: landingOne.maNhanTin, tokenTwo: landingTwo.maNhanTin };
}

const BRIEF: WriteBriefBody = {
  dangBai: "so_sanh",
  huongDan: "Điểm chung, khác nhau từng chỗ, ai nên chọn dòng nào.",
  chuDe: "Giày cho người mới chạy",
  mon: [
    { ma: "A1", ten: "Giày chạy A1", hang: "Nike", gia: 2890000, size: ["41", "42"] },
    { ma: "HET", ten: "Giày hết hàng", hang: "Asics", gia: 1990000, size: [] }
  ],
  luat: {
    captionToiThieu: 900, captionToiDa: 2200, hookChuHoaToiThieu: 4, hookChuHoaToiDa: 10,
    cam: ["không nhắc giá tiền trong bài", "không nhắc hàng có sẵn"],
    gocLink: "https://shop.test"
  }
};

// ---------- the prompt, with no server at all ----------

test("the prompt restates the SHOP's rules — Xeon keeps no copy of them", () => {
  const prompt = buildPrompt(BRIEF);
  assert.match(prompt.user, /ít nhất 900 và nhiều nhất 2200 ký tự/);
  assert.match(prompt.user, /4–10 chữ VIẾT HOA/);
  assert.match(prompt.user, /không nhắc giá tiền trong bài/);
  assert.match(prompt.user, /https:\/\/shop\.test/);
  assert.match(prompt.user, /Điểm chung, khác nhau từng chỗ/, "hướng dẫn dạng bài là của shop, không phải của Xeon");

  // A different shop's rules produce a different prompt from the same code.
  const other = buildPrompt({ ...BRIEF, luat: { captionToiThieu: 300, cam: ["không dùng emoji"], gocLink: "https://shop2.test" } });
  assert.match(other.user, /không dùng emoji/);
  assert.doesNotMatch(other.user, /không nhắc giá tiền/);
});

test("a size that is not in stock never reaches the prompt", () => {
  const prompt = buildPrompt(BRIEF);
  assert.match(prompt.user, /A1: Giày chạy A1 \(Nike\), giá 2\.890\.000đ, còn size 41, 42/);
  assert.match(prompt.user, /HET: .*hiện không còn size nào/, "hết hàng phải nói rõ, để bài không hứa size");
});

test("the errors of the previous round are carried into the retry — that is the `tối ưu` step", () => {
  const plain = buildPrompt(BRIEF);
  assert.doesNotMatch(plain.user, /Bản trước bị chấm HỎNG/);

  const retry = buildPrompt({ ...BRIEF, loiLanTruoc: ['Vi phạm nhắc hàng có sẵn: "có sẵn"', "Caption 640 ký tự, cần ít nhất 900."] });
  assert.match(retry.user, /Bản trước bị chấm HỎNG/);
  assert.match(retry.user, /có sẵn/);
  assert.match(retry.user, /640 ký tự/);
});

test("reading the answer: plain JSON, a fenced block, or JSON with a sentence around it", () => {
  assert.deepEqual(readDraft(JSON.stringify(DRAFT)), DRAFT);
  assert.deepEqual(readDraft("```json\n" + JSON.stringify(DRAFT) + "\n```"), DRAFT);
  assert.deepEqual(readDraft(`Đây là bài ạ:\n${JSON.stringify(DRAFT)}\nAnh xem giúp em.`), DRAFT);
  assert.equal(readDraft("không phải JSON"), null);
  assert.equal(readDraft(JSON.stringify({ chuAnh: "x" })), null, "không có caption thì không phải một bài");
  assert.equal(readDraft(""), null);
});

// ---------- the door ----------

test("the merchant comes from the INBOX TOKEN, never from the body", async () => {
  const fake = new FakeModel({ ok: true, text: JSON.stringify(DRAFT), model: "claude-opus-5" });
  const { ask, tokenOne } = await buildDesk(fake);
  assert.equal((await ask(BRIEF, null)).status, 401, "khong co ma thi khong viet");
  assert.equal((await ask(BRIEF, "ma-bia-ra")).status, 401);

  // Shop one asking with shop two's name on the body is refused, not served.
  const impersonating = await ask({ ...BRIEF, tenant: "shop2" }, tokenOne);
  assert.equal(impersonating.status, 403);
  assert.equal(fake.asked.length, 0, "mot yeu cau bi tu choi khong duoc ton mot luot goi mo hinh");

  const fine = await ask(BRIEF, tokenOne);
  assert.equal(fine.status, 200);
  assert.equal(fine.body!["ok"], true);
  assert.equal(fine.body!["ban"]["caption"], DRAFT.caption);
  assert.equal(fine.body!["ban"]["chuAnh"], DRAFT.chuAnh);
  assert.equal(fine.body!["model"], "claude-opus-5");
});

test("no key on Xeon: the door says so plainly instead of returning an empty draft", async () => {
  const off = new FakeModel({ ok: false, viSao: "khong bao gio goi" }, false);
  const { ask, tokenOne } = await buildDesk(off);
  const r = await ask(BRIEF, tokenOne);
  assert.equal(r.status, 503);
  assert.equal(r.body!["error"], "chua_co_mo_hinh");
  assert.match(String(r.body!["message"]), /chưa cấu hình/);
  assert.equal(off.asked.length, 0);
});

test("a model that refuses, and an answer that is not a post, are reported — not stored as a draft", async () => {
  const fake = new FakeModel({ ok: false, viSao: "Mô hình từ chối viết bài này." });
  const { ask, tokenOne } = await buildDesk(fake);
  const refused = await ask(BRIEF, tokenOne);
  assert.equal(refused.status, 502);
  assert.equal(refused.body!["error"], "mo_hinh_tu_choi");

  fake.reply({ ok: true, text: "xin chào, hôm nay trời đẹp", model: "claude-opus-5" });
  const garbled = await ask(BRIEF, tokenOne);
  assert.equal(garbled.status, 502);
  assert.equal(garbled.body!["error"], "ban_nhap_khong_doc_duoc");
});

test("a brief with more products than an album can hold is refused before the model is called", async () => {
  const fake = new FakeModel({ ok: true, text: JSON.stringify(DRAFT), model: "claude-opus-5" });
  const { ask, tokenOne } = await buildDesk(fake);
  const many = { ...BRIEF, mon: Array.from({ length: 13 }, (_v, i) => ({ ma: `M${i}`, ten: `Món ${i}` })) };
  const r = await ask(many, tokenOne);
  assert.equal(r.status, 400);
  assert.equal(r.body!["error"], "qua_nhieu_mon");
  assert.equal(fake.asked.length, 0);
});

test("the answer is asked for as structured JSON, so a draft is three fields and not a wall of text", async () => {
  const fake = new FakeModel({ ok: true, text: JSON.stringify(DRAFT), model: "claude-opus-5" });
  const { ask, tokenOne } = await buildDesk(fake);
  await ask(BRIEF, tokenOne);
  const schema = fake.asked[0]?.schema as { required?: string[] } | undefined;
  assert.deepEqual(schema?.required, ["caption", "chuAnh", "comment"]);
});
