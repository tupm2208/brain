/**
 * TurnContextBuilder — tier 1 of Sales Desk, step 1 (24/09/2026): the labelled transcript, the
 * reply note, the product a PERSON sent, the burst text and the dialogue frame, built from what
 * the landing's `conversation.recent` returns and the memory kept between turns.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { TurnContextBuilder, renderHistory } from "@sp/xeon";
import { loadDialogueConfig, loadLedgerTexts } from "@sp/brain";
import "./industries.mts";

const NOW = new Date("2026-09-24T10:00:00.000Z");
const minutesAgo = (m: number): string => new Date(NOW.getTime() - m * 60_000).toISOString();
const builder = new TurnContextBuilder({ dialogue: loadDialogueConfig("giay-chay"), ledgerTexts: loadLedgerTexts(), brands: ["adidas", "nike"] });

type Line = { maTin?: string; chieu: "den" | "di"; boi: string; chu: string; soAnh: number; luc: string; anh?: string[]; traLoiTin?: string };
const line = (l: Line): Line => l;

test("page lines carry three labels: the bot's own sentence, a person's, and 'unknown' for an old line without author", () => {
  const recent = { tin: [
    line({ maTin: "m1", chieu: "den", boi: "khach", chu: "boston 13 còn không", soAnh: 0, luc: minutesAgo(30) }),
    line({ maTin: "m2", chieu: "di", boi: "bo-nao", chu: "Dạ còn ạ, bên em có hỗ trợ đổi size", soAnh: 0, luc: minutesAgo(29) }),
    line({ maTin: "m3", chieu: "di", boi: "", chu: "còn nhé", soAnh: 0, luc: minutesAgo(28) }),
    line({ maTin: "m4", chieu: "di", boi: "Minh", chu: "Anh lấy size 42 nhé", soAnh: 0, luc: minutesAgo(20) }),
    line({ maTin: "m5", chieu: "den", boi: "khach", chu: "ok", soAnh: 0, luc: minutesAgo(0) })
  ] };
  const ctx = builder.build({ tenant: "toprun", conversationId: "facebook:1", message: { maTin: "m5", chu: "ok", luc: minutesAgo(0) }, recent, state: null, now: NOW });
  assert.deepEqual(ctx.history.map((h) => h.who), ["khach", "bot", "khong_ro", "nguoi", "khach"]);
  const text = renderHistory(ctx.history, NOW.toISOString());
  assert.match(text, /PAGE \(bot tu dong — co the sai, khong phai nguon su that\): Dạ còn ạ/);
  assert.match(text, /PAGE \(chua chac nguoi that go — khong phai nguon su that\): còn nhé/);
  assert.match(text, /PAGE \(nguoi truc\): Anh lấy size 42/);
  // The last customer line is the message being answered, exactly once.
  assert.equal(ctx.history.filter((h) => h.text === "ok").length, 1);
  // The frame: the person asked to confirm; "ok" agrees.
  assert.ok(ctx.frame);
  assert.equal(ctx.frame.answer, "agree");
});

test("a product a PERSON sent in the last 30 minutes is the product in focus; the bot's own link is not", () => {
  const recent = { tin: [
    line({ maTin: "m1", chieu: "den", boi: "khach", chu: "có đôi nào êm không", soAnh: 0, luc: minutesAgo(40) }),
    line({ maTin: "m2", chieu: "di", boi: "bo-nao", chu: "Dạ bác xem Cloudfoam ạ https://toprun.site/?p=IG1025", soAnh: 0, luc: minutesAgo(39) }),
    line({ maTin: "m3", chieu: "di", boi: "Minh", chu: "Anh xem đôi này https://toprun.site/?p=JP9252 nhé", soAnh: 0, luc: minutesAgo(10) }),
    line({ maTin: "m4", chieu: "den", boi: "khach", chu: "đôi này size 42 còn không", soAnh: 0, luc: minutesAgo(0) })
  ] };
  const ctx = builder.build({
    tenant: "toprun", conversationId: "facebook:1", message: { maTin: "m4", chu: "đôi này size 42 còn không", luc: minutesAgo(0) }, recent, state: null, now: NOW,
    lexicon: { products: [{ code: "JP9252", name: "Adizero Boston 13" }, { code: "IG1025", name: "Cloudfoam" }] }
  });
  assert.equal(ctx.focusedProduct?.code, "JP9252");
  assert.equal(ctx.focusedProduct?.by, "human_page");
});

test("the customer replies to a photo message: that photo is this turn's photo and the note says so", () => {
  const recent = { tin: [
    line({ maTin: "m1", chieu: "den", boi: "khach", chu: "", soAnh: 1, luc: minutesAgo(5), anh: ["https://cdn.example/a.jpg"] }),
    line({ maTin: "m2", chieu: "di", boi: "bo-nao", chu: "Dạ bác cho em xin tên mẫu ạ", soAnh: 0, luc: minutesAgo(4) }),
    line({ maTin: "m3", chieu: "den", boi: "khach", chu: "đôi này còn size 40 không", soAnh: 0, luc: minutesAgo(0), traLoiTin: "m1" })
  ] };
  const ctx = builder.build({ tenant: "toprun", conversationId: "facebook:1", message: { maTin: "m3", chu: "đôi này còn size 40 không", luc: minutesAgo(0), traLoiTin: "m1" }, recent, state: null, now: NOW });
  assert.deepEqual(ctx.photos.map((p) => p.url), ["https://cdn.example/a.jpg"]);
  assert.match(ctx.replyNote, /KHÁCH ĐANG TRẢ LỜI \(reply\) VÀO TIN CỦA CHÍNH KHÁCH/);
  assert.equal(ctx.history.at(-1)?.note, ctx.replyNote);
  assert.deepEqual(ctx.history.at(-1)?.imageUrls, ["https://cdn.example/a.jpg"]);
  // The photo line shows the placeholder until a label is known; a known label replaces it.
  assert.equal(ctx.history[0]?.text, "[khách gửi ảnh]");
  const labelled = builder.build({
    tenant: "toprun", conversationId: "facebook:1", message: { maTin: "m3", chu: "đôi này còn size 40 không", luc: minutesAgo(0), traLoiTin: "m1" }, recent, now: NOW,
    state: { tenant: "toprun" as never, conversationId: "facebook:1" as never, turns: [], imageLabels: { m1: "[ảnh: JP9252 Adizero Boston 13]" } }
  });
  assert.equal(labelled.history[0]?.text, "[ảnh: JP9252 Adizero Boston 13]");
  assert.equal(labelled.focusedProduct?.code, "JP9252");
  assert.equal(labelled.focusedProduct?.by, "reply_to");
});

test("burst text joins the customer's messages since the page's last sentence", () => {
  const recent = { tin: [
    line({ maTin: "m1", chieu: "di", boi: "bo-nao", chu: "Dạ bác cần gì ạ", soAnh: 0, luc: minutesAgo(3) }),
    line({ maTin: "m2", chieu: "den", boi: "khach", chu: "shop ơi", soAnh: 0, luc: minutesAgo(2) }),
    line({ maTin: "m3", chieu: "den", boi: "khach", chu: "tìm giày chạy", soAnh: 0, luc: minutesAgo(1) }),
    line({ maTin: "m4", chieu: "den", boi: "khach", chu: "size 42", soAnh: 0, luc: minutesAgo(0) })
  ], hoiThoai: { daChaoAi: true, dienThoaiDaCho: false } };
  const ctx = builder.build({ tenant: "toprun", conversationId: "facebook:1", message: { maTin: "m4", chu: "size 42", luc: minutesAgo(0) }, recent, state: null, now: NOW });
  assert.equal(ctx.burstText, "shop ơi | tìm giày chạy | size 42");
  assert.equal(ctx.daChaoAi, true);
  assert.equal(ctx.dienThoaiDaCho, false);
});
