/**
 * The customer's photo laid beside the shop's own catalogue photos (01/10/2026). Tier 1: a made-up
 * industry and a made-up shop (no shoe, no brand) — the mechanism must not depend on either. Real
 * case behind it: a store photo of one version read as the previous version by every model tried,
 * while comparing it with the shop's photos picked the right version every time.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ImageFetcher, ImageIntake, lineWithoutVersion, linesAgree, pickCandidates, type ChatMessage, type ChatModelPort } from "@sp/xeon";

const NOW = new Date("2026-10-01T07:00:00.000Z");
const PNG = Buffer.from("89504e470d0a1a0a0000", "hex");

/** A model answering from a script; records what it was shown. */
function scriptedModel(answers: string[]): ChatModelPort & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen,
    ready: () => true,
    complete: async (messages) => {
      seen.push(messages.map((m) => ({ ...m })));
      const next = answers.shift();
      return next === undefined ? { ok: false, viSao: "het kich ban", transient: false } : { ok: true, text: next, model: "gia" };
    }
  };
}

/** A shop selling "Bình Gốm" vases: versions 2 and 3 of one line, in two glazes. */
const ITEMS = [
  { ma: "BG3-XANH", ten: "Bình Gốm 3 men xanh", anh: "/anh/bg3-xanh.png", link: "https://shopgia.vn/product/bg3-xanh" },
  { ma: "BG3-TRANG", ten: "Bình Gốm 3 men trắng", anh: "https://cdn.shopgia.vn/bg3-trang.png", link: "https://shopgia.vn/product/bg3-trang" },
  { ma: "BG2-XANH", ten: "Bình Gốm 2 men xanh", anh: "https://cdn.shopgia.vn/bg2-xanh.png", link: "https://shopgia.vn/product/bg2-xanh" },
  { ma: "BG2-XANH-B", ten: "Bình Gốm 2 men xanh", anh: "https://cdn.shopgia.vn/bg2-xanh.png", link: "https://shopgia.vn/product/bg2-xanh-b" },
  { ma: "KHONG-ANH", ten: "Bình Gốm 1", anh: "", link: "https://shopgia.vn/product/khong-anh" }
];

const READ_TEXT = { heThong: "doc anh", huongDan: [], nhan: {} };
const COMPARE_TEXT = { heThong: "so anh", huongDan: ["nganh gia: phien ban = so sau ten dong"], nhan: {} };

/** "Đĩa Men" plates: another line of the same maker, for a photo read once as a vase and once as a plate. */
const PLATES = [
  { ma: "DM1-LAM", ten: "Đĩa Men 1 lam", anh: "https://cdn.shopgia.vn/dm1-lam.png", link: "https://shopgia.vn/product/dm1-lam" },
  { ma: "DM1-NAU", ten: "Đĩa Men 1 nâu", anh: "https://cdn.shopgia.vn/dm1-nau.png", link: "https://shopgia.vn/product/dm1-nau" }
];
const READ_VASE = JSON.stringify({ loai: "san_pham", brand: "Gốm Việt", model: "Bình Gốm", tuKhoa: "binh gom", color: "xanh lục", code: "", confidence: 0.9 });
const READ_PLATE = JSON.stringify({ loai: "san_pham", brand: "Gốm Việt", model: "Đĩa Men", tuKhoa: "dia men", color: "lam", code: "", confidence: 0.9 });

/**
 * `compare`: one answer used for both runs, or one per run (the comparison runs twice side by side).
 * The photo is read twice too: `readAnswer` for both readings, or `readAnswers` one per reading.
 */
function setup(compare: string | string[], o: { tools?: string[]; reference?: boolean; compareText?: typeof COMPARE_TEXT | undefined; readAnswer?: string; readAnswers?: string[] } = {}) {
  const toolCalls: { ten: string; input: Record<string, unknown> }[] = [];
  const fetched: string[] = [];
  const binding = {
    gateway: {
      tools: {
        available: () => o.tools ?? ["catalog.find"],
        call: async (ten: string, input: Record<string, unknown>) => {
          toolCalls.push({ ten, input });
          if (ten !== "catalog.find") return { ok: false, error: { message: "khong co" } };
          return { ok: true, data: { ketQua: String(input["ten"]).startsWith("dia") ? PLATES : ITEMS } };
        }
      }
    }
  };
  const vision = scriptedModel([
    ...(o.readAnswers ?? [o.readAnswer ?? READ_VASE, o.readAnswer ?? READ_VASE]),
    ...(Array.isArray(compare) ? compare : [compare, compare])
  ]);
  const fetcher = new ImageFetcher({
    fetch: async (url) => { fetched.push(url); return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) }; },
    sleep: async () => undefined,
    shrink: async (picture) => Buffer.concat([Buffer.from("nho"), picture])
  });
  const intake = new ImageIntake({ vision, fetcher, logger: { info: () => undefined, warn: () => undefined }, clock: { now: () => NOW } });
  const read = () => intake.read({
    tenant: "shopgia", binding: binding as never, photos: [{ url: "https://scontent.test/khach.jpg", at: NOW.toISOString() }],
    conversationId: "facebook:1", text: READ_TEXT, reference: o.reference,
    ...("compareText" in o ? { compareText: o.compareText } : { compareText: COMPARE_TEXT })
  });
  return { read, vision, toolCalls, fetched };
}

test("same version, same colour: searched by the line name, the photo beside each distinct catalogue photo, the note says 'looks like' and asks the customer to confirm", async () => {
  const { read, vision, toolCalls, fetched } = setup(JSON.stringify({ cungPhienBan: [0, 1], trungMau: [0], moTa: "cung dang co bau", chacChan: 0.9 }));
  const r = (await read())!;
  assert.deepEqual(toolCalls.map((c) => [c.ten, c.input["ten"]]), [["catalog.find", "binh gom"]]);
  // A relative photo address is resolved against the item's page; the shared photo and the photo-less item are left out.
  assert.ok(fetched.includes("https://shopgia.vn/anh/bg3-xanh.png"), fetched.join(" "));
  const compareCall = vision.seen[2]!;
  assert.equal(compareCall[1]!.images?.length, 4, "the customer's photo + three distinct catalogue photos");
  assert.ok(compareCall[1]!.images!.every((u) => u.startsWith("data:image/jpeg;base64,")), "shrunk before sending");
  assert.equal(compareCall[1]!.imageCaptions?.[1], "UNG VIEN 0: BG3-XANH — Bình Gốm 3 men xanh", "each label sits right before its picture");
  assert.match(compareCall[0]!.content, /nganh gia: phien ban/, "the industry's words reach the comparison");
  assert.deepEqual(r.soSanh?.trungMau.map((c) => c.ma), ["BG3-XANH"]);
  assert.deepEqual(r.chot, { ket: "hoi_lai", luaChon: [{ ma: "BG3-XANH", ten: "Bình Gốm 3 men xanh" }] }, "never a confident pick from a comparison");
  assert.match(r.note ?? "", /SO VỚI ẢNH CATALOG CỦA SHOP: giống BG3-XANH .*cùng mẫu, cùng màu/);
  assert.match(r.note ?? "", /XÁC NHẬN/);
});

test("same version, other colour → the note says the shop has it in other colours, never the customer's colour", async () => {
  const { read } = setup(JSON.stringify({ cungPhienBan: [0, 1], trungMau: [], moTa: "" }));
  const r = (await read())!;
  assert.deepEqual(r.soSanh?.cungPhienBan.map((c) => c.ma), ["BG3-XANH", "BG3-TRANG"]);
  assert.match(r.note ?? "", /cùng mẫu \(cùng đời\/phiên bản\) với BG3-XANH .*KHÔNG mã nào cùng màu ảnh khách \(xanh lục\)/);
});

test("no catalogue item of that version → the note says so and forbids naming a version the photo does not print", async () => {
  const { read } = setup(JSON.stringify({ cungDong: [0, 2], cungPhienBan: [], trungMau: [], moTa: "khac than" }));
  const r = (await read())!;
  assert.equal(r.chot, null);
  assert.equal(r.dongChuaChac, false);
  assert.match(r.note ?? "", /đã đặt cạnh 3 mẫu trong kho; cùng dòng nhưng khác đời\/bản: BG3-XANH .*KHÔNG mẫu nào cùng mẫu\/cùng đời/);
  assert.match(r.note ?? "", /KHÔNG tự gọi tên đời\/phiên bản/);
});

test("a colour match the model left out of the version list still counts as a version match; out-of-range indexes are ignored", async () => {
  const { read } = setup(JSON.stringify({ cungPhienBan: [7], trungMau: [2] }));
  const r = (await read())!;
  assert.deepEqual(r.soSanh?.cungPhienBan.map((c) => c.ma), ["BG2-XANH"]);
});

test("no comparison: a size-reference photo, a landing without catalog.find, an industry without the prompt — the note keeps 'version not certain'", async () => {
  for (const o of [{ reference: true }, { tools: [] as string[] }, { compareText: undefined }]) {
    const { read, vision, toolCalls } = setup("{}", o);
    const r = (await read())!;
    assert.equal(r.soSanh, null, JSON.stringify(o));
    assert.equal(vision.seen.length, 2, "only the two reading calls");
    assert.equal(toolCalls.length, 0);
    if (o.reference !== true) assert.match(r.note ?? "", /Đời\/phiên bản nhìn từ ảnh là CHƯA CHẮC/);
  }
});

test("lineWithoutVersion drops the brand and every number; pickCandidates keeps one photo once, distinct names first, ten at most", () => {
  assert.equal(lineWithoutVersion("Bình Gốm 3", "Gốm Việt"), "binh gom", "a brand word inside the line name stays");
  assert.equal(lineWithoutVersion("Gốm Việt Bình Gốm 3", "Gốm Việt"), "binh gom", "a leading brand goes");
  assert.equal(lineWithoutVersion("Air Zoom Pegasus 41", "Nike"), "air zoom pegasus");
  const many = Array.from({ length: 14 }, (_, i) => ({ ma: `M${i}`, ten: i % 2 === 0 ? "Dòng A" : `Dòng B${i}`, anh: `https://x.vn/${i}.png`, link: "https://x.vn/p" }));
  const picked = pickCandidates(many);
  assert.equal(picked.length, 10);
  assert.deepEqual(picked.slice(0, 8).map((c) => c.ten), ["Dòng A", "Dòng B1", "Dòng B3", "Dòng B5", "Dòng B7", "Dòng B9", "Dòng B11", "Dòng B13"]);
  assert.deepEqual(pickCandidates(ITEMS).map((c) => c.ma), ["BG3-XANH", "BG3-TRANG", "BG2-XANH"]);
});

test("the two runs disagree → nothing is 'the same item'; what one run chose is only 'maybe' and the note says NOT CERTAIN", async () => {
  const { read } = setup([JSON.stringify({ cungPhienBan: [0], trungMau: [0] }), JSON.stringify({ cungPhienBan: [1], trungMau: [] })]);
  const r = (await read())!;
  assert.deepEqual(r.soSanh?.cungPhienBan, []);
  assert.deepEqual(r.soSanh?.coTheLa.map((c) => c.ma).sort(), ["BG3-TRANG", "BG3-XANH"]);
  assert.equal(r.soSanh?.chacChan, false);
  assert.match(r.note ?? "", /CHƯA CHẮC — có thể gần với/);
  assert.match(r.note ?? "", /KHÔNG khẳng định shop có hay không có/);
  assert.equal(r.chot?.ket, "hoi_lai", "the customer is asked, never a pick");
});

test("catalogue self-check: 'the same item' holding codes of two versions (by the catalogue names) → the photo cannot tell them apart, all become 'maybe'", async () => {
  const { read } = setup(JSON.stringify({ cungPhienBan: [0, 2], trungMau: [] }));
  const r = (await read())!;
  assert.deepEqual(r.soSanh?.cungPhienBan, []);
  assert.deepEqual(r.soSanh?.lanDoi.sort(), ["2", "3"]);
  assert.match(r.note ?? "", /ảnh không phân biệt được các đời\/bản: (3 \/ 2|2 \/ 3)/);
});

test("text beats looks: a version number READ on the photo rules out candidates carrying another number", async () => {
  const readAnswer = JSON.stringify({ loai: "san_pham", brand: "Gốm Việt", model: "Bình Gốm 2", tuKhoa: "binh gom", color: "xanh lục", code: "", confidence: 0.9 });
  const { read } = setup(JSON.stringify({ cungPhienBan: [0, 1, 2], trungMau: [0, 2] }), { readAnswer });
  const r = (await read())!;
  assert.deepEqual(r.soSanh?.cungPhienBan.map((c) => c.ma), ["BG2-XANH"], "version 3 is out, whatever the looks said");
  assert.deepEqual(r.soSanh?.trungMau.map((c) => c.ma), ["BG2-XANH"]);
});

test("coverage: candidates that are not of the line read on the photo never support 'the shop has none'", async () => {
  const readAnswer = JSON.stringify({ loai: "san_pham", brand: "Gốm Việt", model: "Bình Sứ", tuKhoa: "binh", color: "trắng", code: "", confidence: 0.9 });
  const { read } = setup(JSON.stringify({ cungPhienBan: [], trungMau: [] }), { readAnswer });
  const r = (await read())!;
  assert.equal(r.soSanh?.chacChan, false);
  assert.doesNotMatch(r.note ?? "", /KHÔNG mẫu nào cùng mẫu\/cùng đời/);
  assert.match(r.note ?? "", /CHƯA XÁC NHẬN/, "the pictures did not confirm the line either");
});

test("the line itself: none of the shop's photos of the line read shows that line → the line name is a guess, never said or remembered", async () => {
  const { read } = setup(JSON.stringify({ cungDong: [], cungPhienBan: [], trungMau: [] }));
  const r = (await read())!;
  assert.equal(r.soSanh?.dongXacNhan, false);
  assert.equal(r.soSanh?.chacChan, false, "never 'the shop has none of that version' over a line nobody confirmed");
  assert.equal(r.dongChuaChac, true);
  assert.match(r.note ?? "", /đọc ảnh đoán là .*Bình Gốm.*CHƯA XÁC NHẬN/);
  assert.match(r.note ?? "", /KHÔNG mẫu nào cùng dòng với ảnh khách/);
  assert.match(r.note ?? "", /KHÔNG gọi tên dòng trên với khách/);
  assert.doesNotMatch(r.note ?? "", /cùng dòng nhưng khác đời/);
});

test("one run alone sees the line → not confirmed (the two runs must agree)", async () => {
  const { read } = setup([JSON.stringify({ cungDong: [0] }), JSON.stringify({ cungDong: [] })]);
  const r = (await read())!;
  assert.equal(r.soSanh?.dongXacNhan, false);
  assert.equal(r.dongChuaChac, true);
});

test("two readings name different lines → both lines are searched and shown, and the pictures decide which reading was right", async () => {
  // Pool order: the readings' pools taken in turn — 0 BG3-XANH, 1 DM1-LAM, 2 BG3-TRANG, 3 DM1-NAU, 4 BG2-XANH.
  const { read, toolCalls, vision } = setup(JSON.stringify({ cungDong: [1, 3], cungPhienBan: [], trungMau: [] }), { readAnswers: [READ_VASE, READ_PLATE] });
  const r = (await read())!;
  assert.deepEqual(toolCalls.map((c) => c.input["ten"]), ["binh gom", "dia men"]);
  assert.equal(vision.seen[2]![1]!.images?.length, 6, "the photo + five catalogue photos of both lines");
  assert.equal(r.soSanh?.docKhop, 1);
  assert.deepEqual(r.soSanh?.cungDong.map((c) => c.ma), ["DM1-LAM", "DM1-NAU"]);
  assert.equal(r.read.model, "Đĩa Men", "the confirmed reading is what the photo shows");
  assert.equal(r.dongChuaChac, false);
  assert.doesNotMatch(r.note ?? "", /CHƯA XÁC NHẬN|lần đọc thứ hai/);
  assert.match(r.note ?? "", /cùng dòng nhưng khác đời\/bản: DM1-LAM/);
});

test("two readings disagree and nothing can compare them → the note shows both as guesses and asks the customer", async () => {
  const { read } = setup("{}", { readAnswers: [READ_VASE, READ_PLATE], compareText: undefined });
  const r = (await read())!;
  assert.equal(r.soSanh, null);
  assert.equal(r.dongChuaChac, true);
  assert.match(r.note ?? "", /đọc ảnh đoán là .*Bình Gốm.*lần đọc thứ hai lại ra Gốm Việt Đĩa Men.*CHƯA XÁC NHẬN/);
  assert.match(r.note ?? "", /xin khách tên mẫu hoặc mã/);
});

test("the two readings: a receipt seen by either wins; a code either caught is kept; one failed reading leaves the other", async () => {
  const receipt = JSON.stringify({ loai: "bien_lai", amount: 350000, text: "chuyen khoan thanh cong" });
  const r = (await setup("{}", { readAnswers: [READ_VASE, receipt] }).read())!;
  assert.equal(r.loai, "bien_lai");
  const coded = JSON.stringify({ loai: "san_pham", brand: "Gốm Việt", model: "Bình Gốm", tuKhoa: "binh gom", color: "", code: "bg3-xanh", confidence: 0.9 });
  const r2 = (await setup(JSON.stringify({ cungDong: [0], cungPhienBan: [0], trungMau: [0] }), { readAnswers: [READ_VASE, coded] }).read())!;
  assert.equal(r2.read.code, "BG3-XANH");
  const r3 = (await setup(JSON.stringify({ cungDong: [0], cungPhienBan: [0], trungMau: [0] }), { readAnswers: [READ_VASE, "khong phai json"] }).read())!;
  assert.equal(r3.read.model, "Bình Gốm");
  assert.ok(r3.loi.some((l) => /JSON khong doc duoc/.test(l)));
});

test("linesAgree: one line name inside the other agrees; another line or another brand does not; a reading with no line agrees with anything", () => {
  const l = (brand: string, model: string, tuKhoa = "") => ({ brand, model, tuKhoa, color: "" });
  assert.equal(linesAgree(l("Gốm Việt", "Bình Gốm"), l("Gốm Việt", "Gốm Việt Bình Gốm 3")), true);
  assert.equal(linesAgree(l("Gốm Việt", "Bình Gốm Cao"), l("", "Bình Gốm")), true);
  assert.equal(linesAgree(l("Gốm Việt", "Bình Gốm"), l("Gốm Việt", "Đĩa Men")), false);
  assert.equal(linesAgree(l("Gốm Việt", "Bình Gốm"), l("Sứ Nam", "Bình Gốm")), false);
  assert.equal(linesAgree(l("Gốm Việt", "Bình Gốm"), l("", "")), true);
});
