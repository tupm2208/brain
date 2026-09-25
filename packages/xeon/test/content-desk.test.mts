/**
 * Đ8 — the Content desk on Xeon: three judges and one verdict, optimise against the critique,
 * weekly trend research, and the shop's writing style riding in the brief. Every model is a script:
 * no network, no key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ContentController, ContentDeskService, LicenseLedger, LicenseService, ManualClock, MemoryLogger, ProfileTranslator, buildPrompt, generateSigningKey,
  summarizeReview, currentUsage, type TextModelPort, type TextOutcome, type TextRequest
} from "@sp/xeon";

const T0 = new Date("2026-09-17T08:00:00.000Z");
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

class ScriptModel implements TextModelPort {
  readonly asked: TextRequest[] = [];
  readonly agents: string[] = [];
  private readonly answer: (request: TextRequest) => string;
  private readonly on: boolean;
  constructor(answer: (request: TextRequest) => string, on = true) {
    this.answer = answer;
    this.on = on;
  }
  ready(): boolean { return this.on; }
  async complete(request: TextRequest): Promise<TextOutcome> {
    this.asked.push(request);
    this.agents.push(String(currentUsage()?.agent ?? ""));
    return { ok: true, text: this.answer(request), model: "script" };
  }
}

const verdict = (score: number, ok = true, tag = "") => JSON.stringify({ score, verdict: ok ? "ĐẠT" : "CHƯA ĐẠT", findings: tag ? [{ tag, quote: "câu gốc", reason: "vì", fix: "câu mới" }] : [], summary: `chấm ${score}` });

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

const POST = { ma: "lo-1-1", gio: "10:00", trang: "TopRun", dangBai: "so_sanh", huongDan: "So sánh", chuDe: "Giới thiệu các dòng giày Hoka", caption: "BA ĐÔI ĐÁNG CÂN NHẮC cho người mới", chuAnh: "BA ĐÔI", comment: "https://shop.test/a inbox em", mon: [{ ma: "A1", ten: "Giày A1", size: ["42"] }] };

test("phản biện: three judges, pass only when all say ĐẠT and the lowest score is at least 7", async () => {
  const model = new ScriptModel((r) => (r.system.includes("chuyên gia") ? verdict(8) : r.system.includes("biên tập") ? verdict(6.5, true, "GIỌNG AI") : verdict(9)));
  const { call } = await build(model);
  const r = await call("/noi-dung/phan-bien", { bai: POST, loiLuat: ["Caption nhắc giá tiền: 500k"], phongCach: { ten: "Kể chuyện", luatViet: "Xưng em, gọi các bác" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body["dat"], false, "một người chấm 6.5 thì bài chưa đạt dù cả ba nói ĐẠT");
  assert.equal(r.body["giong"]["diem"], 6.5);
  assert.equal(r.body["giong"]["phatHien"][0]["nhan"], "GIỌNG AI");
  assert.equal(model.asked.length, 3);
  assert.ok(model.asked.every((q) => q.user.includes("Giới thiệu các dòng giày Hoka")), "cả ba người chấm phải thấy chủ đề gốc");
  const voice = model.asked.find((q) => q.system.includes("biên tập"))!;
  assert.match(voice.user, /Caption nhắc giá tiền: 500k/, "lỗi luật do MÁY của landing quét, người chấm chỉ được dẫn lại");
  assert.match(voice.user, /Xưng em, gọi các bác/, "phong cách của shop đi theo yêu cầu");
  assert.ok(model.agents.every((a) => a === "content_review"), "sổ token ghi đúng tác nhân");

  assert.equal(summarizeReview({ chuyenMon: { diem: 7, ketLuan: "ĐẠT", phatHien: [], tomTat: "" }, giong: { diem: 8, ketLuan: "ĐẠT", phatHien: [], tomTat: "" }, dangBai: { diem: 9, ketLuan: "ĐẠT", phatHien: [], tomTat: "" } }).dat, true);
});

test("tối ưu: the rewrite carries every finding and the rule errors; an empty answer is refused", async () => {
  const model = new ScriptModel(() => JSON.stringify({ caption: "BA ĐÔI ĐÁNG CÂN NHẮC bản mới", chuAnh: "BA ĐÔI" }));
  const { call } = await build(model);
  const review = { chuyenMon: { diem: 5, ketLuan: "CHƯA ĐẠT", phatHien: [{ nhan: "SAI", trich: "đế carbon", lyDo: "không có carbon", sua: "đế EVA" }], tomTat: "" }, giong: { diem: 8, ketLuan: "ĐẠT", phatHien: [], tomTat: "" }, dangBai: { diem: 8, ketLuan: "ĐẠT", phatHien: [], tomTat: "" }, dat: false, ghiChu: [] };
  const r = await call("/noi-dung/toi-uu", { bai: POST, phanBien: review, loiLuat: ["Hook viết hoa cả câu."] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body["caption"], "BA ĐÔI ĐÁNG CÂN NHẮC bản mới");
  assert.match(model.asked[0]!.user, /đế carbon/);
  assert.match(model.asked[0]!.user, /Hook viết hoa cả câu/);
  assert.match(model.asked[0]!.user, /Giới thiệu các dòng giày Hoka/, "tối ưu phải giữ đúng chủ đề gốc");

  const empty = await (await build(new ScriptModel(() => JSON.stringify({ caption: "", chuAnh: "" })))).call("/noi-dung/toi-uu", { bai: POST });
  assert.equal(empty.status, 502);
});

test("xu hướng: only the lines asked about come back, scores kept in 0–20", async () => {
  const model = new ScriptModel(() => JSON.stringify({ models: [
    { key: "adidas-samba", modelLine: "Samba", brand: "adidas", hotScore: 45, trendStatus: "rising", trendReason: "đang hot", story: "x", styling: ["quần jean"], sampleCaptions: [], confidence: 0.8 },
    { key: "bia-dat", modelLine: "Bịa", brand: "x", hotScore: 10, trendStatus: "stable", trendReason: "", story: "", styling: [], sampleCaptions: [], confidence: 0.5 }
  ] }));
  const { call } = await build(model);
  const r = await call("/noi-dung/xu-huong", { dong: [{ key: "adidas-samba", hang: "adidas", dong: "Samba", soMa: 3 }], boiCanh: "tháng 9/2026" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body["dong"].length, 1, "dòng mô hình tự bịa ra bị bỏ");
  assert.equal(r.body["dong"][0]["hotScore"], 20);
  assert.equal(model.agents[0], "content_trend");
});

test("the shop comes from the inbox token; no model = a sentence, not an empty verdict", async () => {
  const { call } = await build(new ScriptModel(() => verdict(8)));
  assert.equal((await call("/noi-dung/phan-bien", { bai: POST }, null)).status, 401);
  assert.equal((await call("/noi-dung/phan-bien", { bai: POST, tenant: "shop-khac" })).status, 403);
  const off = await (await build(new ScriptModel(() => "", false))).call("/noi-dung/phan-bien", { bai: POST });
  assert.equal(off.status, 503);
  assert.match(String(off.body["message"]), /chưa cấu hình/);
});

test("the writing brief carries the shop's style and the buying angle", () => {
  const prompt = buildPrompt({ dangBai: "so_sanh", mon: [], phongCach: { ten: "Viral review", baiMau: "Một đôi giày tốt không phải đôi được khen nhiều nhất" }, goc: { ten: "Người mới bắt đầu", huongDan: "Nói dễ hiểu" } });
  assert.match(prompt.user, /Viral review/);
  assert.match(prompt.user, /KHÔNG chép nguyên văn/);
  assert.match(prompt.user, /Người mới bắt đầu — Nói dễ hiểu/);
  assert.doesNotMatch(buildPrompt({ mon: [] }).user, /Phong cách viết/);
});
