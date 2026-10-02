/**
 * THE AGENT SEES THE CUSTOMER'S PHOTOS (02/10/2026). Measured on 30 real photos, twice each: an agent
 * that only read the system's note on a photo answered 72% right; the same note PLUS the photo,
 * 87%, none wrong. Tier 1: a made-up industry and a made-up shop (vases, no shoe, no brand) — the
 * mechanism must not depend on either. The words come from the real tier 1 (`loi-chung/agent-chung.json`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ImageFetcher, ImageIntake, LOOK_TOOL, SalesAgent, TurnContextBuilder, composeSystemPrompt, crossCheckFingerprint, systemCapabilities,
  type AgentToolBox, type AgentVision, type ChatCallOptions, type ChatMessage, type ChatModelPort, type HistoryLine
} from "@sp/xeon";
import { ConversationLedger, loadCommonAgent, loadDialogueConfig, loadLedgerTexts, type PackAgent } from "@sp/brain";
import "./industries.mts";

const NOW = new Date("2026-10-02T04:00:00.000Z");
const clock = { now: () => NOW };
const logger = { info: () => undefined, warn: () => undefined };
const CHUNG = loadCommonAgent();
const PHOTO = CHUNG.xemAnh!;

/** A model answering from a script; records what it was shown AND how it was called. */
function scriptedModel(answers: string[]): ChatModelPort & { seen: ChatMessage[][]; opts: (ChatCallOptions | undefined)[] } {
  const seen: ChatMessage[][] = [];
  const opts: (ChatCallOptions | undefined)[] = [];
  return {
    seen, opts,
    ready: () => true,
    complete: async (messages, options) => {
      seen.push(messages.map((m) => ({ ...m })));
      opts.push(options);
      const next = answers.shift();
      return next === undefined ? { ok: false, viSao: "het kich ban", transient: false } : { ok: true, text: next, model: "gia" };
    }
  };
}

/** A vase shop's playbook: one stock tool, nothing about any real trade. */
const VASE_AGENT: PackAgent = {
  khoi: [{ id: "vai-tro", tieuDe: "Vai tro", shopSua: false, loiDan: "Ban ban binh gom." }],
  mauHoSo: {} as PackAgent["mauHoSo"],
  mustHumanPattern: "", handoffReplyPattern: "",
  tools: [{ name: "tra_kho", handler: "landing", landingMethod: "findStock", moTa: "{\"tool\":\"tra_kho\",\"args\":{\"ten\":\"...\"}} — tim hang con.", tracksAmounts: true, tracksLinks: true }]
};
const SHOP_PHOTO = "https://cdn.shopgia.vn/bg3.png";
const STOCK = [{ ma: "BG3", ten: "Bình Gốm 3 men xanh", anh: SHOP_PHOTO, link: "https://shopgia.vn/product/bg3", cac_size: [] }];
const tools: AgentToolBox = { findStock: async () => STOCK, policy: async () => "", bankAccount: async () => ({}) };
const CUSTOMER = "https://scontent.test/khach.jpg";
const EARLIER = "https://scontent.test/khach-truoc.jpg";
const HISTORY: HistoryLine[] = [
  { who: "khach", text: "[khách gửi ảnh]", images: 1, imageUrls: [EARLIER] },
  { who: "bot", text: "Dạ bác cần tìm mẫu nào ạ?", images: 0 },
  { who: "khach", text: "shop có mẫu này không", images: 0, imageUrls: [CUSTOMER] }
];

function seeing(): AgentVision & { looked: [string, string][] } {
  const looked: [string, string][] = [];
  return {
    looked,
    photos: [{ url: CUSTOMER, dataUrl: "data:image/jpeg;base64,KHACH" }],
    look: async (url, kind) => { looked.push([url, kind]); return `data:image/jpeg;base64,${kind === "khach" ? "TRUOC" : "SHOP"}`; }
  };
}

test("the agent sees the photo with the transcript, every call ends with the reminder in JSON mode, and the protocol offers xem_anh", async () => {
  const model = scriptedModel(["{\"reply\":\"Dạ em thấy giống mẫu Bình Gốm 3 ạ, bác xác nhận giúp em nhé?\"}"]);
  const agent = new SalesAgent({ model, logger, clock, sleep: async () => undefined });
  const vision = seeing();
  const out = await agent.run({ agent: VASE_AGENT, chung: CHUNG, site: "https://shopgia.vn", history: HISTORY, tools, vision, xemAnh: { anh: [CUSTOMER] } });
  assert.equal(out.ok, true, JSON.stringify(out));
  const call = model.seen[0]!;
  assert.deepEqual(call[1]!.images, ["data:image/jpeg;base64,KHACH"], "the photo rides on the transcript message");
  assert.deepEqual(call[1]!.imageCaptions, [PHOTO.chuThichAnh]);
  assert.equal(call.at(-1)!.content, PHOTO.nhacSauAnh, "the reminder is the last message of every call");
  assert.equal(model.opts[0]?.json, true, "JSON mode while pictures are in the call");
  assert.match(call[0]!.content, /2\. \{"tool":"xem_anh"/, "the look-again tool follows the pack's own tools");
});

test("xem_anh opens a product photo a stock result showed and an earlier customer photo — never an address the model made up", async () => {
  const model = scriptedModel([
    "{\"tool\":\"tra_kho\",\"args\":{\"ten\":\"binh gom\"}}",
    `{"tool":"xem_anh","args":{"url":"${SHOP_PHOTO}"}}`,
    `{"tool":"xem_anh","args":{"url":"${EARLIER}"}}`,
    "{\"tool\":\"xem_anh\",\"args\":{\"url\":\"https://la.test/khac.png\"}}",
    "{\"reply\":\"Dạ em thấy giống mẫu Bình Gốm 3 men xanh ạ, bác xác nhận giúp em nhé?\"}"
  ]);
  const agent = new SalesAgent({ model, logger, clock, sleep: async () => undefined });
  const vision = seeing();
  const out = await agent.run({ agent: VASE_AGENT, chung: CHUNG, site: "https://shopgia.vn", history: HISTORY, tools, vision, xemAnh: { anh: [CUSTOMER] } });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(vision.looked, [[SHOP_PHOTO, "catalog"], [EARLIER, "khach"]], "the made-up address is never fetched");
  const last = model.seen.at(-1)!;
  const shown = last.filter((m) => m.role === "user" && (m.images ?? []).length > 0 && /KET QUA xem_anh/.test(m.content));
  assert.deepEqual(shown.map((m) => m.images), [["data:image/jpeg;base64,SHOP"], ["data:image/jpeg;base64,TRUOC"]]);
  assert.ok(last.some((m) => /KET QUA xem_anh: chi xem duoc anh/.test(m.content)), "the refusal says what may be opened");
  // The trace (and so the dossier) keeps addresses, never the pictures.
  const looks = out.trace.filter((t) => t.tool === LOOK_TOOL);
  assert.equal(looks.length, 3);
  assert.ok(looks.every((t) => !/base64/.test(t.result ?? "")));
});

test("no vision: the turn runs exactly as before — no picture, no reminder, no JSON mode, no xem_anh", async () => {
  const model = scriptedModel(["{\"tool\":\"xem_anh\",\"args\":{\"url\":\"x\"}}", "{\"reply\":\"Dạ bác cho em xin tên mẫu ạ\"}"]);
  const agent = new SalesAgent({ model, logger, clock, sleep: async () => undefined });
  const out = await agent.run({ agent: VASE_AGENT, chung: CHUNG, site: "https://shopgia.vn", history: HISTORY, tools });
  assert.equal(out.ok, true);
  assert.equal(model.seen[0]![1]!.images, undefined);
  assert.notEqual(model.seen[0]!.at(-1)!.content, PHOTO.nhacSauAnh);
  assert.equal(model.opts[0]?.json, undefined);
  assert.doesNotMatch(model.seen[0]![0]!.content, /"tool":"xem_anh"/);
  assert.match(model.seen[1]!.at(-1)!.content, /Cong cu khong ton tai/);
});

test("the dossier's prompt shows the look-again tool for a turn that saw photos; the capability line is tier 1's", () => {
  const input = { agent: VASE_AGENT, chung: CHUNG, site: "https://shopgia.vn", history: HISTORY, xemAnh: { anh: [CUSTOMER] } };
  assert.match(composeSystemPrompt(input), /"tool":"xem_anh"/);
  assert.doesNotMatch(composeSystemPrompt({ ...input, xemAnh: undefined }), /"tool":"xem_anh"/);
  const lines = systemCapabilities({ open: [], visionReady: true, photoLine: PHOTO.nangLuc });
  assert.ok(lines.includes(PHOTO.nangLuc));
  assert.ok(!lines.some((l) => /he thong DA doc anh truoc luot/.test(l)), "one photo line, not two that disagree");
  assert.ok(systemCapabilities({ open: [], visionReady: true }).some((l) => /he thong DA doc anh truoc luot/.test(l)));
});

// ---- the fingerprint against the reading ---------------------------------------------------------

const names: Record<string, string> = { BG3: "Bình Gốm 3 men xanh", BG2: "Bình Gốm 2", DM1: "Đĩa Men 1 lam", DM2: "Đĩa Men 2 nâu" };
const named = (ma: string): string => names[ma] ?? "";
const vaseRead = { brand: "Gốm Việt", model: "Bình Gốm", tuKhoa: "binh gom", code: "" };

test("fingerprint 'looks a little like': kept only for codes whose name carries the line read; nothing read → nothing kept", () => {
  const notes: string[] = [];
  const weak = { ket: "hoi_lai", viSao: "weak_catalog_image", luaChon: ["DM1", "DM2"] };
  assert.equal(crossCheckFingerprint(weak, named, vaseRead, (w) => notes.push(w)), null, "plates for a vase photo: noise");
  assert.match(notes.join(" "), /bo 2 ma "hoi giong"/);
  const mixed = { ket: "hoi_lai", viSao: "shared_catalog_image", luaChon: ["BG3", "DM1", "BG2"] };
  assert.deepEqual(crossCheckFingerprint(mixed, named, vaseRead, () => undefined), { ket: "hoi_lai", luaChon: [{ ma: "BG3", ten: names["BG3"] }, { ma: "BG2", ten: names["BG2"] }] });
  assert.equal(crossCheckFingerprint(mixed, named, { brand: "", model: "", tuKhoa: "", code: "" }, () => undefined), null);
  // The second reading's line counts too.
  const twoReadings = { ...vaseRead, docKhac: { brand: "Gốm Việt", model: "Đĩa Men", tuKhoa: "dia men", color: "" } };
  assert.equal((crossCheckFingerprint(weak, named, twoReadings, () => undefined) as { luaChon: unknown[] }).luaChon.length, 2);
  // A code read on the photo that the fingerprint contradicts: both stay, the customer decides.
  const conflict = { ket: "hoi_lai", viSao: "ocr_fingerprint_conflict", luaChon: ["DM1", "BG3"] };
  assert.equal((crossCheckFingerprint(conflict, named, vaseRead, () => undefined) as { luaChon: unknown[] }).luaChon.length, 2);
});

test("fingerprint match: stands when it agrees with the line read (or nothing was read); against the line read it is only a 'maybe'; a code READ stands", () => {
  const pin = (ma: string, viSao = "catalog_gallery_fingerprint") => ({ ket: "tu_tin", ma, viSao });
  assert.deepEqual(crossCheckFingerprint(pin("BG3"), named, vaseRead, () => undefined), { ket: "tu_tin", ma: "BG3", ten: names["BG3"] });
  assert.deepEqual(crossCheckFingerprint(pin("DM1"), named, { brand: "", model: "", tuKhoa: "", code: "" }, () => undefined), { ket: "tu_tin", ma: "DM1", ten: names["DM1"] });
  const notes: string[] = [];
  assert.deepEqual(crossCheckFingerprint(pin("DM1"), named, vaseRead, (w) => notes.push(w)), { ket: "hoi_lai", luaChon: [{ ma: "DM1", ten: names["DM1"] }] });
  assert.match(notes[0]!, /lech dong doc duoc/);
  assert.deepEqual(crossCheckFingerprint(pin("DM1", "ocr_code_in_catalog"), named, vaseRead, () => undefined), { ket: "tu_tin", ma: "DM1", ten: names["DM1"] }, "text beats looks");
  assert.equal(crossCheckFingerprint({ ket: "khong_biet" }, named, vaseRead, () => undefined), null);
});

// ---- the intake, worded for an agent that sees ----------------------------------------------------

const PNG = Buffer.from("89504e470d0a1a0a0000", "hex");
const VASES = [
  { ma: "BG3-XANH", ten: "Bình Gốm 3 men xanh", anh: "https://cdn.shopgia.vn/bg3-xanh.png", link: "https://shopgia.vn/product/bg3-xanh" },
  { ma: "BG2-XANH", ten: "Bình Gốm 2 men xanh", anh: "https://cdn.shopgia.vn/bg2-xanh.png", link: "https://shopgia.vn/product/bg2-xanh" }
];
const READ_VASE = JSON.stringify({ loai: "san_pham", brand: "Gốm Việt", model: "Bình Gốm", tuKhoa: "binh gom", color: "xanh lục", code: "", confidence: 0.9 });

function intakeWith(compare: string[], o: { agentSees?: boolean; khopAnh?: unknown } = {}) {
  const binding = {
    gateway: {
      tools: {
        available: () => (o.khopAnh !== undefined ? ["catalog.find", "catalog.matchImage"] : ["catalog.find"]),
        call: async (ten: string) => (ten === "catalog.matchImage" ? { ok: true, data: o.khopAnh } : { ok: true, data: { ketQua: VASES } })
      }
    }
  };
  const vision = scriptedModel([READ_VASE, READ_VASE, ...compare]);
  const fetcher = new ImageFetcher({
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) }),
    sleep: async () => undefined,
    shrink: async (picture, px) => Buffer.concat([Buffer.from(`nho${px}`), picture])
  });
  const intake = new ImageIntake({ vision, fetcher, logger, clock });
  return intake.read({
    tenant: "shopgia", binding: binding as never, photos: [{ url: CUSTOMER, at: NOW.toISOString() }], conversationId: "facebook:1",
    text: { heThong: "doc anh", huongDan: [], nhan: {} }, compareText: { heThong: "so anh", huongDan: [], nhan: {} }, agentSees: o.agentSees
  });
}

test("an agent that sees: the photo is prepared at its size, and an unconfirmed line is something to check — not 'say you do not recognise it'", async () => {
  const none = JSON.stringify({ cungDong: [], cungPhienBan: [], trungMau: [] });
  const r = (await intakeWith([none, none], { agentSees: true }))!;
  assert.match(r.looks[0]!.xem ?? "", /^data:image\/jpeg;base64,/);
  assert.equal(Buffer.from(r.looks[0]!.xem!.split(",")[1]!, "base64").subarray(0, 7).toString(), "nho1600");
  assert.equal(r.dongChuaChac, true);
  assert.match(r.note ?? "", /KHÔNG mẫu nào cùng dòng với ảnh khách/);
  assert.match(r.note ?? "", /Ảnh thật ĐÍNH KÈM trong tin: tự nhìn kiểm lại/);
  assert.doesNotMatch(r.note ?? "", /nói em chưa nhận ra/);
  // The one-shot draft behind the agent never sees the photo: it gets the note worded for a blind reader.
  assert.match(r.noteBlind ?? "", /nói em chưa nhận ra chắc mẫu trong ảnh/);
  // The same photo for an agent that does not see: no copy, the old order stands.
  const old = (await intakeWith([none, none]))!;
  assert.equal(old.looks[0]!.xem, undefined);
  assert.match(old.note ?? "", /nói em chưa nhận ra chắc mẫu trong ảnh/);
});

test("the two runs disagree on the line → the note says NOT CERTAIN, never 'none is of that line'", async () => {
  const r = (await intakeWith([JSON.stringify({ cungDong: [0, 1] }), JSON.stringify({ cungDong: [] })], { agentSees: true }))!;
  assert.equal(r.soSanh?.dongBatDong, true);
  assert.match(r.note ?? "", /hai lần so KHÔNG thống nhất có cùng dòng/);
  assert.doesNotMatch(r.note ?? "", /KHÔNG mẫu nào cùng dòng/);
});

test("a pinned code is a fact for an agent that sees: it must not swap it for what it thinks it sees", async () => {
  const khopAnh = { chot: { ket: "tu_tin", ma: "BG3-XANH", viSao: "catalog_gallery_fingerprint" }, ungVien: [{ ma: "BG3-XANH", ten: "Bình Gốm 3 men xanh" }] };
  const r = (await intakeWith([], { agentSees: true, khopAnh }))!;
  assert.equal(r.chot?.ket, "tu_tin");
  assert.match(r.note ?? "", /Ảnh trùng ảnh catalog của mã BG3-XANH .* Mã này ĐÃ CHỐT: KHÔNG đổi sang mã khác/);
  // A fingerprint that names a plate for a vase photo: only a maybe, and the pictures decide.
  const plate = { chot: { ket: "tu_tin", ma: "DM1-LAM", viSao: "catalog_gallery_fingerprint" }, ungVien: [{ ma: "DM1-LAM", ten: "Đĩa Men 1 lam" }] };
  const same = JSON.stringify({ cungDong: [0], cungPhienBan: [0], trungMau: [0] });
  const r2 = (await intakeWith([same, same], { agentSees: true, khopAnh: plate }))!;
  assert.notEqual(r2.chot?.ket, "tu_tin");
  assert.ok(r2.loi.some((l) => /lech dong doc duoc/.test(l)));
  assert.match(r2.note ?? "", /SO VỚI ẢNH CATALOG CỦA SHOP: giống BG3-XANH/);
});

// ---- memory and transcript ------------------------------------------------------------------------

test("an unconfirmed line is remembered AS a guess, so a later 'guess it' has something to go on", () => {
  const ledger = new ConversationLedger(loadLedgerTexts());
  const image = ledger.recognizeImage({ visionOk: true, guess: { brand: "Gốm Việt", name: "Bình Gốm" } });
  assert.deepEqual(image, { kind: "guess", brand: "Gốm Việt", name: "Bình Gốm" });
  assert.equal(ledger.imageLabel(image!), "[ảnh: đoán là Gốm Việt Bình Gốm — chưa xác nhận]");
  assert.equal(ledger.recognizeImage({ visionOk: true })?.kind, "unknown", "nothing read stays 'not read'");
});

test("a photo the customer sent in the last half hour keeps its address in the transcript; an older one does not", () => {
  const builder = new TurnContextBuilder({ dialogue: loadDialogueConfig("giay-chay"), ledgerTexts: loadLedgerTexts(), brands: [] });
  const ago = (m: number): string => new Date(NOW.getTime() - m * 60_000).toISOString();
  const recent = { tin: [
    { maTin: "m0", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(90), anh: ["https://scontent.test/cu.jpg"] },
    { maTin: "m1", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: ago(3), anh: [EARLIER] },
    { maTin: "m2", chieu: "di", boi: "bo-nao", chu: "Dạ bác cần mẫu nào ạ?", soAnh: 0, luc: ago(2) },
    { maTin: "m3", chieu: "den", boi: "khach", chu: "cứ đoán đi", soAnh: 0, luc: ago(0) }
  ] };
  const ctx = builder.build({ tenant: "shopgia", conversationId: "facebook:1", message: { maTin: "m3", chu: "cứ đoán đi", luc: ago(0) }, recent, state: { imageLabels: { m1: "[ảnh: đoán là Bình Gốm — chưa xác nhận]" } } as never, now: NOW });
  assert.deepEqual(ctx.history[1]!.imageUrls, [EARLIER]);
  assert.equal(ctx.history[0]!.imageUrls, undefined, "ninety minutes ago is no longer 'the photo'");
  assert.equal(ctx.photos.length, 0, "an earlier photo is not re-read as this turn's photo");
  assert.equal(ctx.history[1]!.text, "[ảnh: đoán là Bình Gốm — chưa xác nhận]");
});
