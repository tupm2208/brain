/**
 * NGƯỜI PHIÊN DỊCH (22/09/2026) — a shop owner says how they want content made, and Xeon fills in
 * the workshop's form.
 *
 * The three properties that make this safe to put in front of someone who has never written a
 * prompt: the form travels with the request (Xeon keeps no copy), silence stays silent (a field
 * nobody mentioned is not invented), and what came back is a SUGGESTION — the landing stores it
 * only after a person approves. Every model here is a script: no network, no key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ContentController, ContentDeskService, LicenseLedger, LicenseService, ManualClock, MemoryLogger, ProfileTranslator,
  currentUsage, generateSigningKey, understandPrompt, type TextModelPort, type TextOutcome, type TextRequest
} from "@sp/xeon";

const T0 = new Date("2026-09-22T08:00:00.000Z");
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

class ScriptModel implements TextModelPort {
  readonly asked: TextRequest[] = [];
  readonly agents: string[] = [];
  private readonly answer: string;
  private readonly on: boolean;
  constructor(answer: string, on = true) {
    this.answer = answer;
    this.on = on;
  }
  ready(): boolean { return this.on; }
  async complete(request: TextRequest): Promise<TextOutcome> {
    this.asked.push(request);
    this.agents.push(String(currentUsage()?.agent ?? ""));
    return { ok: true, text: this.answer, model: "script" };
  }
}

/** The form, as the landing describes it (a slice of the real `FIELD_GUIDE`). */
const FIELDS = [
  { duong: "mucTieu", nhan: "Mục tiêu tháng này", kieu: "chu", giaiThich: "Một trong: can-bang, xa-sale, day-hang-hot, phu-hang-moi." },
  { duong: "chamDiem.giamGia", nhan: "Coi trọng hàng đang giảm giá", kieu: "muc", giaiThich: "Món giảm sâu thì lên bài trước.", toiThieu: 0, toiDa: 5 },
  { duong: "luatBai.captionToiThieu", nhan: "Caption ngắn nhất", kieu: "so", giaiThich: "Bài ngắn hơn mức này bị chặn.", toiThieu: 100, toiDa: 5000 },
  { duong: "luatBai.cumCam", nhan: "Cụm từ không bao giờ được viết", kieu: "bang", giaiThich: "Gõ cụm như khi nói chuyện." }
];

const ANSWER = JSON.stringify({
  hoSo: { mucTieu: "xa-sale", luatBai: { captionToiThieu: 400, cumCam: [{ id: "hua_khoi", nhan: "hứa khỏi bệnh", cum: ["khỏi hẳn", "chữa khỏi"] }] } },
  hieuLa: ["Tháng này shop ưu tiên hàng giảm giá.", "Bài viết ngắn hơn, tối thiểu 400 ký tự.", "Không được hứa khỏi bệnh."],
  chuaRo: ["Shop muốn đăng mấy bài một ngày?"]
});

async function build(model: TextModelPort) {
  const clock = new ManualClock(T0);
  const license = new LicenseService({ ledger: await LicenseLedger.open(), signingKey: generateSigningKey(), clock, sellableModules: ["chatbot-cskh"], coreModules: ["hang-kho"] });
  const shop = await license.issueKey({ shop: "toprun", tenShop: "TopRun", hetHan: "2027-09-15T00:00:00.000Z" });
  const landing = await license.registerLanding({ key: shop.key, diaChi: "https://shop.test" });
  assert.ok(landing.ok);
  const controller = new ContentController({ desk: new ContentDeskService({ model }), translator: new ProfileTranslator({ model }), license, logger: new MemoryLogger() });
  const call = async (path: string, body: unknown, token: string | null = landing.maNhanTin): Promise<{ status: number; body: Body }> => {
    let status = 0;
    let out: Body = {};
    const req = { headers: token === null ? {} : { authorization: `Bearer ${token}` } } as unknown as IncomingMessage;
    const res = { writeHead(code: number) { status = code; return this; }, end(t: string) { out = t ? JSON.parse(t) : {}; } } as unknown as ServerResponse;
    assert.equal(await controller.handle(req, res, { method: "POST", path, ip: "1.1.1.1", readJson: async () => body as Record<string, unknown> }), true);
    return { status, body: out };
  };
  return { call };
}

test("lời kể thành các ô của form, kèm câu đọc lại cho người duyệt", async () => {
  const model = new ScriptModel(ANSWER);
  const { call } = await build(model);

  const r = await call("/noi-dung/hieu-y", {
    loKe: "Shop em xả hàng tồn tháng này, viết ngắn thôi, tuyệt đối đừng hứa khỏi bệnh.",
    bangMau: FIELDS,
    hoSoHienTai: { mucTieu: "can-bang" },
    mucTieu: [{ id: "xa-sale", ten: "Xả hàng đang sale" }],
    mau: [{ id: "nha-thuoc", ten: "Nhà thuốc" }]
  });

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body["hoSo"]["mucTieu"], "xa-sale");
  assert.equal(r.body["hoSo"]["luatBai"]["captionToiThieu"], 400);
  assert.equal((r.body["hieuLa"] as string[]).length, 3, "phải đọc lại bằng tiếng Việt, không chỉ trả JSON");
  assert.equal((r.body["chuaRo"] as string[])[0], "Shop muốn đăng mấy bài một ngày?", "chỗ chưa hiểu thì hỏi, không bịa để lấp");

  // Tiền mô hình phải vào đúng cột của mảng content.
  assert.deepEqual(model.agents, ["content_profile"]);
});

test("form đi theo yêu cầu: Xeon không giữ bản sao nào của danh sách ô", () => {
  const prompt = understandPrompt({ tenant: "toprun", loKe: "bán giày chạy", bangMau: FIELDS });
  for (const f of FIELDS) assert.ok(prompt.user.includes(f.duong), `ô ${f.duong} phải có trong lời nhắc`);
  assert.match(prompt.user, /Caption ngắn nhất/, "mô tả của landing được nói lại nguyên văn");
  assert.match(prompt.system, /chỉ điền ô nào lời kể thực sự nói tới/i, "im lặng không phải là một ý kiến");
  assert.match(prompt.user, /bán giày chạy/);
});

test("không có bảng mẫu, hoặc không có lời kể, thì từ chối thay vì đoán", async () => {
  const { call } = await build(new ScriptModel(ANSWER));
  assert.equal((await call("/noi-dung/hieu-y", { loKe: "  ", bangMau: FIELDS })).status, 400);
  assert.equal((await call("/noi-dung/hieu-y", { loKe: "bán giày", bangMau: [] })).status, 400);
});

test("mô hình trả về thứ không đọc được thì nói thẳng, không trả hồ sơ rỗng như thể đã hiểu", async () => {
  const { call } = await build(new ScriptModel("xin lỗi tôi không chắc"));
  const r = await call("/noi-dung/hieu-y", { loKe: "bán giày chạy, ưu tiên hàng sale", bangMau: FIELDS });
  assert.equal(r.status, 502);
  assert.equal(r.body["error"], "khong_doc_duoc");
});

test("chưa cấu hình mô hình: cửa nói thẳng, và màn hình vẫn khai tay được", async () => {
  const { call } = await build(new ScriptModel(ANSWER, false));
  const r = await call("/noi-dung/hieu-y", { loKe: "bán giày chạy", bangMau: FIELDS });
  assert.equal(r.status, 503);
  assert.equal(r.body["error"], "chua_co_mo_hinh");
});

test("shop đến từ MÃ NHẮN TIN, không phải từ thân yêu cầu", async () => {
  const { call } = await build(new ScriptModel(ANSWER));
  assert.equal((await call("/noi-dung/hieu-y", { loKe: "bán giày", bangMau: FIELDS }, null)).status, 401);
  assert.equal((await call("/noi-dung/hieu-y", { loKe: "bán giày", bangMau: FIELDS, tenant: "shop-khac" })).status, 403);
});
