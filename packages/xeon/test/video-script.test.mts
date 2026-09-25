/**
 * Đ9 VIDEO SCRIPT (21/09/2026) — the one part of making a video that stays on Xeon.
 *
 * The rules in `script-prompt.ts` are copied WORD FOR WORD from `toprun-video-studio`, where each
 * line is a mistake somebody watched a model make. These tests pin the ones that cost the most:
 * a greeting wasting the three seconds that decide whether anyone stays, a price read out over a
 * screen already showing it, and the tool's own words leaking into what a customer hears.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  LicenseLedger, LicenseService, MemoryLogger, VideoScriptController, VideoScriptDesk,
  KnowledgePackRegistry, buildVideoScriptPrompt, generateSigningKey, hasMoney, nganhWords, parseScript, validateScript,
  type ChatMessage, type ChatModelPort, type VideoScript
} from "@sp/xeon";

const T0 = new Date("2026-09-21T09:00:00.000Z");
const clock = { now: () => T0 };
const SHOP = { tenShop: "TopRun", nganh: "giày chạy bộ" };
const CODES = ["JP9252", "GX8152"];

const GOOD: VideoScript = {
  hookWords: ["Hai đôi", "dưới hai triệu", "chạy được ngay"],
  hookRead: "Hai đôi này dưới hai triệu mà chạy đường dài vẫn êm.",
  criteria: ["đế êm", "nhẹ chân"],
  criteriaRead: "Em chọn theo đế êm và nhẹ chân.",
  notes: { JP9252: "Hợp bác nào chạy dài, đế dày êm chân.", GX8152: "Nhẹ hơn, hợp chạy tốc độ." },
  ctaLine1: "Nhắn em", ctaLine2: "số đo dài chân", ctaRead: "Bác nhắn số đo dài chân em tư vấn size."
};

function scriptedModel(answers: (string | { loi: string; transient?: boolean })[]): ChatModelPort & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen,
    ready: () => true,
    complete: async (messages) => {
      seen.push(messages.map((m) => ({ ...m })));
      const next = answers.shift();
      if (next === undefined) return { ok: false, viSao: "het kich ban", transient: false };
      if (typeof next !== "string") return { ok: false, viSao: next.loi, transient: next.transient === true };
      return { ok: true, text: next, model: "gia/mo-hinh-thu" };
    }
  };
}

// ---- the prompt ---------------------------------------------------------------------------------

test("lời dẫn mang đúng số khung, tên shop, và số liệu thật để HIỂU chứ không để đọc lại", () => {
  const built = buildVideoScriptPrompt(
    { main: "2 đôi dưới 2 triệu", caption: "bài gốc", codes: CODES },
    { JP9252: { code: "JP9252", name: "BOSTON 13", salePrice: "1.890.000", sizes: [{ size: "42", qty: 3 }] } },
    SHOP
  );
  assert.match(built.system, /TopRun, một shop bán giày chạy bộ/);
  // Mỗi mã một khung: nói "ba đôi" mà hình chạy hai khung là người xem thấy sai ngay.
  assert.match(built.user, /đúng 2 khung sản phẩm/);
  assert.match(built.user, /BOSTON 13/);
  assert.match(built.user, /KHÔNG đọc lại giá/);
  assert.match(built.user, /notes" phải có đủ 2 mã: JP9252, GX8152/);
});

test("mã đã bỏ khỏi video thì bài phải viết lại như chưa từng có nó", () => {
  const built = buildVideoScriptPrompt(
    { caption: "bài gốc nhắc 3 đôi", codes: CODES, maBo: [{ code: "HQ1349", name: "PEGASUS", lyDo: "hết hàng" }] },
    {}, SHOP
  );
  assert.match(built.user, /ĐÃ BỎ KHỎI VIDEO/);
  assert.match(built.user, /HQ1349 \(PEGASUS\): hết hàng/);
  assert.match(built.user, /TUYỆT ĐỐI không nhắc tên chúng/);
  assert.match(built.user, /chỉ có 2 món ngay từ đầu/);
});

// ---- the checker --------------------------------------------------------------------------------

test("kịch bản đạt thì qua sạch", () => {
  const check = validateScript(GOOD, CODES);
  assert.equal(check.ok, true, check.errors.join("; "));
});

test("bắt đúng ba lỗi đắt nhất: lời chào, đọc lại giá, và từ nội bộ", () => {
  const chao = validateScript({ ...GOOD, hookRead: "Chào các bác, hôm nay em giới thiệu hai đôi." }, CODES);
  assert.equal(chao.ok, false);
  assert.ok(chao.errors.some((e) => /ba giay dau khong duoc phi/.test(e)));

  const gia = validateScript({ ...GOOD, notes: { ...GOOD.notes, JP9252: "Đôi này chỉ 1.890.000đ thôi ạ." } }, CODES);
  assert.equal(gia.ok, false);
  assert.ok(gia.errors.some((e) => /doc lai gia/.test(e)));

  const noiBo = validateScript({ ...GOOD, criteriaRead: "Đôi đắt nhất batch này." }, CODES);
  assert.equal(noiBo.ok, false);
  assert.ok(noiBo.errors.some((e) => /tu noi bo "batch"/.test(e)));
});

test("thiếu nhận xét cho một mã là lỗi — trên hình vẫn có khung của nó", () => {
  const check = validateScript({ ...GOOD, notes: { JP9252: "Hợp chạy dài." } }, CODES);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => /Thieu nhan xet cho ma GX8152/.test(e)));
});

test("cụm chữ trên màn hình quá 4 từ là lỗi; criteria lệch chỉ là cảnh báo", () => {
  const dai = validateScript({ ...GOOD, hookWords: ["một hai ba bốn năm", "hai"] }, CODES);
  assert.ok(dai.errors.some((e) => /dai qua 4 tu/.test(e)));

  const it = validateScript({ ...GOOD, criteria: ["một mục thôi"] }, CODES);
  assert.equal(it.ok, true, "không chặn — chỉ nhắc");
  assert.ok(it.warnings.some((w) => /criteria nen co 2-3 muc/.test(w)));
});

test("parseScript moi JSON ra khỏi hàng rào ``` và lời dẫn của model", () => {
  assert.deepEqual(parseScript('Dạ đây ạ:\n```json\n{"hookRead":"x"}\n```'), { hookRead: "x" });
  assert.deepEqual(parseScript('{"hookRead":"y"}'), { hookRead: "y" });
  assert.equal(parseScript("không có JSON nào"), null);
});

test("hasMoney đọc được tiền viết theo mọi kiểu người Việt hay viết", () => {
  // Ba kiểu đầu là chỗ bản gốc của công cụ BỎ SÓT: `` là ASCII nên sau "đ" không bao giờ khớp.
  // Sửa ở bản chép này (xem ghi chú trong script-prompt.ts); công cụ gốc để nguyên.
  for (const t of ["1.890.000đ", "1890000 đ", "giá 500.000 đồng", "890k", "1,2 triệu", "2 trieu"]) {
    assert.equal(hasMoney(t), true, t);
  }
  assert.equal(hasMoney("size 42"), false);
  assert.equal(hasMoney("chạy 10 km"), false, "km không phải nghìn");
});

test("nganhWords lấy chữ ngành từ `kien-thuc.json`, không từ bảng gõ cứng", () => {
  const packs = new KnowledgePackRegistry();
  assert.equal(nganhWords("giay-chay", packs), "giày chạy bộ");
  assert.equal(nganhWords("khong-biet", packs), "hàng", "gói lạ vẫn ra câu đọc được");
  assert.equal(nganhWords("giay-chay"), "hàng", "không có sổ ngành thì không bịa tên ngành");
});

// ---- the loop -----------------------------------------------------------------------------------

test("kịch bản chưa đạt thì model được BÁO ĐÚNG LỖI và viết lại, không phải bảo 'hay hơn đi'", async () => {
  const xau = JSON.stringify({ ...GOOD, hookRead: "Chào các bác, em giới thiệu hai đôi này." });
  const model = scriptedModel([xau, JSON.stringify(GOOD)]);
  const desk = new VideoScriptDesk({ model, logger: new MemoryLogger(), clock });
  const out = await desk.write({ shop: "toprun", tenShop: "TopRun", nganh: "giày chạy bộ", bai: { caption: "x", codes: CODES } });

  assert.equal(out.ok, true);
  assert.equal(out.ok && out.vong, 2);
  // Vòng hai phải nói RÕ lỗi của vòng một.
  const fix = model.seen[1]!.at(-1)!.content;
  assert.match(fix, /chưa đạt/);
  assert.match(fix, /ba giay dau khong duoc phi/);
});

test("ba vòng vẫn chưa đạt thì dừng và trả về đúng những lỗi còn lại", async () => {
  const xau = JSON.stringify({ ...GOOD, notes: { JP9252: "ok" } });
  const desk = new VideoScriptDesk({ model: scriptedModel([xau, xau, xau]), logger: new MemoryLogger(), clock });
  const out = await desk.write({ shop: "toprun", tenShop: "TopRun", nganh: "giày chạy bộ", bai: { caption: "x", codes: CODES } });
  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.viSao, "kich_ban_chua_dat");
  assert.ok(out.ok === false && out.loi.some((e) => /GX8152/.test(e)));
});

test("cổng model hỏng KHÔNG bị đổ cho bài viết", async () => {
  const desk = new VideoScriptDesk({ model: scriptedModel([{ loi: "401 khoa sai" }]), logger: new MemoryLogger(), clock });
  const out = await desk.write({ shop: "toprun", tenShop: "TopRun", nganh: "x", bai: { caption: "x", codes: CODES } });
  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.viSao, "401 khoa sai", "nói thẳng là cổng hỏng, không phải 'kịch bản chưa đạt'");
});

test("bài không có mã nào thì từ chối ngay, không tốn một lượt gọi model", async () => {
  const model = scriptedModel([JSON.stringify(GOOD)]);
  const desk = new VideoScriptDesk({ model, logger: new MemoryLogger(), clock });
  const out = await desk.write({ shop: "toprun", tenShop: "TopRun", nganh: "x", bai: { caption: "x", codes: [] } });
  assert.equal(out.ok, false);
  assert.equal(model.seen.length, 0);
});

// ---- the door -----------------------------------------------------------------------------------

function fakeRes() {
  const state = { status: 0, body: null as any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads wire fields
  const res = { statusCode: 0, writeHead(s: number) { state.status = s; return res; }, end(t?: string) { state.body = t === undefined ? null : JSON.parse(t); }, setHeader() {} };
  return { res: res as unknown as ServerResponse, state };
}
const fakeReq = (token: string) => ({ headers: { authorization: `Bearer ${token}` } } as unknown as IncomingMessage);
const ctxFor = (body: unknown) => ({ method: "POST", path: "/video/kich-ban", ip: "1.2.3.4", readJson: async () => body } as never);

async function licensed() {
  const ledger = await LicenseLedger.open();
  const license = new LicenseService({ ledger, signingKey: generateSigningKey(), clock, sellableModules: ["hang-kho", "chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "toprun", tenShop: "TopRun", nganh: "giay-chay", manh: ["chatbot-cskh"], hetHan: "2027-01-01T00:00:00.000Z" });
  const reg = await license.registerLanding({ key, diaChi: "https://shop.vn" });
  if (!reg.ok) throw new Error(reg.viSao);
  return { license, inboxToken: reg.maNhanTin };
}

test("cửa lấy shop từ MÃ NHẬN TIN, tên shop từ sổ license — không đọc từ thân yêu cầu", async () => {
  const { license, inboxToken } = await licensed();
  const model = scriptedModel([JSON.stringify(GOOD)]);
  const door = new VideoScriptController({ desk: new VideoScriptDesk({ model, logger: new MemoryLogger(), clock }), license, logger: new MemoryLogger(), packs: new KnowledgePackRegistry() });

  const { res, state } = fakeRes();
  await door.handle(fakeReq(inboxToken), res, ctxFor({ baiGoc: { caption: "x", codes: CODES }, tenShop: "Shop Giả Mạo" }));
  assert.equal(state.status, 200);
  assert.deepEqual(state.body.daLam, ["kich-ban"]);
  // Tên trong lời dẫn là tên trong sổ, không phải tên landing tự khai.
  assert.match(model.seen[0]![0]!.content, /TopRun, một shop bán giày chạy bộ/);
  assert.ok(!model.seen[0]![0]!.content.includes("Giả Mạo"));
});

test("mã lạ là 401; bài không mã là 400; chưa cấu hình cổng AI thì NÓI RÕ bên nào thiếu", async () => {
  const { license, inboxToken } = await licensed();
  const desk = new VideoScriptDesk({ model: scriptedModel([JSON.stringify(GOOD)]), logger: new MemoryLogger(), clock });
  const door = new VideoScriptController({ desk, license, logger: new MemoryLogger() });

  const bad = fakeRes();
  await door.handle(fakeReq("ma-bia"), bad.res, ctxFor({ baiGoc: { codes: CODES } }));
  assert.equal(bad.state.status, 401);

  const trong = fakeRes();
  await door.handle(fakeReq(inboxToken), trong.res, ctxFor({ baiGoc: { caption: "x", codes: [] } }));
  assert.equal(trong.state.status, 400);

  const tat = fakeRes();
  const off = new VideoScriptController({
    desk: new VideoScriptDesk({ model: { ready: () => false, complete: async () => ({ ok: false, viSao: "x", transient: false }) }, logger: new MemoryLogger(), clock }),
    license, logger: new MemoryLogger()
  });
  await off.handle(fakeReq(inboxToken), tat.res, ctxFor({ baiGoc: { codes: CODES } }));
  assert.equal(tat.state.status, 503);
  assert.match(String(tat.state.body.message), /XEON_AI_CHAT_URL/);
});
