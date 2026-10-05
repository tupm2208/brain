/**
 * 05/10/2026 — phiếu Desk nhóm SỐ ĐO (26/09 cổng size thay mọi size, 26/09 chỉ báo dài chân xin đủ
 * thông số, 22/09 "size 2x" trần là cm tem, 06/09 số đo không gõ cm, 01/09 cổng kiểm cặp size↔cm↔UK).
 *
 * Tầng 1 thử bằng NGÀNH GIẢ (quần áo trẻ em theo chiều cao + cân nặng): cơ chế đọc số đo, xin đủ số
 * đo, chỉ sửa câu quy đổi không dính gì tới giày. Tầng 2 nạp gói `giay-chay` thật và chạy bảng Ca kiểm.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import "./fixtures.mts";

// ---------------------------------------------------------------- tier 1: an invented industry

const KIDS = B.parseSizeAdvice({
  rows: [
    { size: "2Y", caoCm: 92, canKg: [11, 13] }, { size: "3Y", caoCm: 98, canKg: [13, 15] }, { size: "4Y", caoCm: 104, canKg: [15, 17] },
    { size: "5Y", caoCm: 110, canKg: [17, 19] }, { size: "6Y", caoCm: 116, canKg: [19, 22] }, { size: "7Y", caoCm: 122, canKg: [22, 25] }
  ],
  tuVan: {
    soDo: [
      { id: "cao", ten: "chiều cao", cot: "caoCm", kieu: "moc", nhan: "chieu cao|cao", donVi: { cm: 1 }, khoang: [60, 170], khongDonVi: true, macDinh: true },
      { id: "can", ten: "cân nặng", cot: "canKg", kieu: "dai", nhan: "can nang|nang", donVi: { kg: 1 }, khoang: [5, 60], khongDonVi: true, rongTu: 2, doLaiTu: 3 }
    ],
    sauSo: "^\\s*(tuoi|thang|k\\b|%)",
    bienTheRieng: "\\bsize\\s*\\d",
    khongDo: "khong (biet|can) (bao nhieu|can)",
    he: [{ id: "be", ten: "quần áo bé", khi: "", can: ["cao", "can"], dich: [0, 0] }],
    heMacDinh: "be"
  }
}, "test/quan-ao-be");

test("tầng 1 (ngành giả quần áo bé): bộ soi tuVan nhận cấu hình hợp lệ và báo đúng trường khi sai", () => {
  assert.deepEqual(KIDS.problems, []);
  const bad = B.parseSizeAdvice({ rows: [{ size: "S", cao: 100 }], tuVan: { soDo: [{ id: "x", ten: "x", cot: "khongCo", kieu: "moc", nhan: "x" }], he: [{ id: "h", ten: "h", can: ["y"] }] } }, "gia");
  assert.ok(bad.problems.some((p) => /khongCo/.test(p)), bad.problems.join("\n"));
  assert.ok(bad.problems.some((p) => /khong co so do "y"/.test(p)), bad.problems.join("\n"));
});

test("tầng 1: đọc số đo có / không đơn vị, bỏ số tuổi, bỏ số đứng cạnh size riêng của khách", () => {
  const reader = new B.MeasureReader(KIDS.config);
  assert.deepEqual(reader.read(["bé nhà mình cao 100"]).values, { cao: 100 });
  assert.deepEqual(reader.read(["bé 3 tuổi, cao 100cm, nặng 16kg"]).values, { cao: 100, can: 16 });
  assert.deepEqual(reader.read(["cao 100 tuổi"]).values, {}, "100 tuổi không phải chiều cao");
  assert.deepEqual(reader.read(["bé cao 100 mặc size 4"]).values, {}, "khách tự nói size thì số không đơn vị cạnh đó không phải số đo");
  // Later lines add to earlier ones.
  assert.deepEqual(reader.read(["bé cao 100cm", "nặng 16 ạ"]).values, { cao: 100, can: 16 });
});

test("tầng 1: thiếu số đo ngành cần → chưa nêu biến thể; đủ thì tra bảng, lên tối đa một nấc, lệch xa thì nhắc đo lại", () => {
  const reader = new B.MeasureReader(KIDS.config);
  const advisor = new B.SizeAdvisor(KIDS.config);
  const only = advisor.advise(reader.read(["bé cao 100"]), { context: "" })!;
  assert.equal(only.status, "thieu");
  assert.equal(only.size, "");
  assert.deepEqual(only.missing, ["cân nặng"]);
  assert.deepEqual(only.acceptable, []);
  const full = advisor.advise(reader.read(["bé cao 100cm nặng 16kg"]), { context: "" })!;
  assert.equal(full.status, "du");
  assert.equal(full.size, "4Y");
  const heavy = advisor.advise(reader.read(["cao 100, nặng 20"]), { context: "" })!;
  assert.equal(heavy.size, "5Y", "cân nặng hai nấc trên chỉ đẩy lên một nấc");
  assert.equal(heavy.wide, true);
  const odd = advisor.advise(reader.read(["cao 100, nặng 24"]), { context: "" })!;
  assert.deepEqual(odd.recheck, ["cân nặng"]);
  const cannot = advisor.advise(reader.read(["bé cao 100", "mình không biết bao nhiêu cân"]), { context: "" })!;
  assert.equal(cannot.status, "khong-do");
  assert.equal(cannot.size, "4Y");
});

/** A reply gate config for the invented industry: every word is ITS data. */
function kidsGate(): B.ReplyGateConfig {
  const cfg = B.emptyReplyGateConfig();
  cfg.sizeChart = {
    ...cfg.sizeChart,
    mentionsSize: "size\\s*\\d|\\d\\s*y\\b", sizeInReply: "(?:size|mac)\\s*(\\d{1,2}y)()", conversion: "(?<!\\p{L})(cao|nặng)(?!\\p{L})",
    botVariant: "(?:size|mặc)\\s*(\\d{1,2}Y)()", customerVariant: "(?<![\\d])(\\d{1,2}Y)()",
    adviceVerb: "(?<!\\p{L})(?:nên|mặc|lấy)(?!\\p{L})", stockWord: "(?<!\\p{L})(?:còn|hết)(?!\\p{L})",
    askMeasures: "Dạ {khach} cho shop xin thêm {thieu} của bé để chọn đúng size ạ.", askMeasuresShort: "", askedBefore: "", alreadyAsks: "xin them", linkLine: "", askBack: "Dạ {khach} cho shop xin thêm thông tin của bé ạ."
  };
  return cfg;
}

const kidSources = (over: Partial<B.GateSources> = {}): B.GateSources => ({
  shopSaid: "", customerSaid: "", policy: "", hoSo: null, found: [], stockFacts: null,
  lookups: { orderLooked: false }, links: {}, pronoun: "chị", uncertainProduct: false, site: "be.example", tenShop: "Shop Bé", ...over
});

test("tầng 1: thiếu số đo → câu khuyên size bị cắt và hỏi số còn thiếu; câu báo hàng giữ nguyên (không dính giày)", () => {
  const reader = new B.MeasureReader(KIDS.config);
  const hint = new B.SizeAdvisor(KIDS.config).advise(reader.read(["bé cao 100"]), { context: "" })!;
  const gate = new B.ReplyGate(kidsGate());
  const r = gate.run("Dạ bé cao 100cm thì chị nên lấy size 5Y ạ. Mẫu này còn size 3Y và 4Y.", kidSources({ customerSaid: "bé cao 100", sizeHint: hint }));
  assert.ok(r.trace.some((t) => t.startsWith("size_needs_measures:5Y")), r.trace.join(" "));
  assert.doesNotMatch(r.reply, /5Y/);
  assert.match(r.reply, /xin thêm cân nặng/);
  assert.match(r.reply, /còn size 3Y và 4Y/);
});

test("tầng 1: đủ số đo → chỉ câu quy đổi bị sửa về bảng, câu báo hàng bên cạnh giữ nguyên", () => {
  const reader = new B.MeasureReader(KIDS.config);
  const hint = new B.SizeAdvisor(KIDS.config).advise(reader.read(["bé cao 100cm nặng 16kg"]), { context: "" })!;
  const gate = new B.ReplyGate(kidsGate());
  const r = gate.run("Dạ bé cao 100cm thì mặc size 7Y ạ. Mẫu váy hồng size 7Y bên shop còn.", kidSources({ customerSaid: "bé cao 100cm nặng 16kg", sizeHint: hint }));
  assert.equal(r.reply, "Dạ bé cao 100cm thì mặc size 4Y ạ. Mẫu váy hồng size 7Y bên shop còn.");
});

// ---------------------------------------------------------------- tier 2: the real shoe pack

const ADVICE = B.loadSizeAdvice("giay-chay");
const reader = new B.MeasureReader(ADVICE);
const advisor = new B.SizeAdvisor(ADVICE);
const gate = new B.ReplyGate(B.loadReplyGateConfig("giay-chay"));
const hintOf = (lines: string[], context: string, brand = "", brandRows: B.BrandChartRow[] | null = null): B.SizeHint | null => advisor.advise(reader.read(lines), { context, brand, brandRows });

/** Puma's chart as the landing hands it (tag = 25 + US − 7, cm column of brand-charts.ts). */
const PUMA: B.BrandChartRow[] = [
  ["38", 24, 5], ["38.5", 24.5, 5.5], ["39", 25, 6], ["40", 25.5, 6.5], ["40.5", 26, 7], ["41", 26.5, 7.5], ["42", 27, 8], ["42.5", 27.5, 8.5], ["43", 28, 9], ["44", 28.5, 9.5]
].map(([label, link, uk]) => ({ label: String(label), link: Number(link), alt: { uk: String(uk) } }));
/** Nike's (EU 42 = US 8.5 = tag 26.5 = UK 7.5). */
const NIKE: B.BrandChartRow[] = [
  ["40", 25, 6], ["40.5", 25.5, 6.5], ["41", 26, 7], ["42", 26.5, 7.5], ["42.5", 27, 8], ["43", 27.5, 8.5], ["44", 28, 9]
].map(([label, link, uk]) => ({ label: String(label), link: Number(link), alt: { uk: String(uk) } }));

const sources = (over: Partial<B.GateSources> = {}): B.GateSources => ({
  shopSaid: "", customerSaid: "", policy: "", hoSo: null, found: [], stockFacts: null,
  lookups: { orderLooked: false }, links: {}, pronoun: "anh", uncertainProduct: false,
  site: "shop.example", tenShop: "Shop Giày", brandWords: ["adidas", "nike", "puma", "asics"], ...over
});

test("gói giày nạp được tuVan: 16 hàng, ba số đo, ba hệ (sân / chạy / phổ thông)", () => {
  assert.equal(ADVICE.rows.length, 16);
  assert.deepEqual(ADVICE.measures.map((m) => m.id), ["dai", "rong", "chuVi"]);
  assert.deepEqual(ADVICE.systems.map((s) => s.id), ["san", "chay", "pho"]);
});

test("phiếu 06/09: số đo chân không gõ cm vẫn nhận; số kèm size / tuổi / nghìn thì không", () => {
  assert.equal(reader.read(["Mình vẫn chân bé 25.5"]).values["dai"], 25.5);
  assert.equal(reader.read(["Mình vẫn chân bé 25,5"]).values["dai"], 25.5);
  assert.equal(reader.read(["chân 25.5cm giày sân"]).values["dai"], 25.5);
  assert.equal(reader.read(["mình chân 25.5 size 42"]).values["dai"], undefined);
  assert.equal(reader.read(["chân 28 tuổi rồi"]).values["dai"], undefined);
  assert.equal(reader.read(["chân 25k"]).values["dai"], undefined);
  assert.deepEqual(reader.read(["chân 25cm, rộng 10.3cm, chu vi 24.9cm"]).values, { dai: 25, rong: 10.3, chuVi: 249 });
  assert.deepEqual(reader.read(["dài 250mm rộng 103mm chu vi 249mm"]).values, { dai: 25, rong: 10.3, chuVi: 249 });
  assert.deepEqual(reader.read(["vòng chân 249mm"]).values, { chuVi: 249 });
  assert.deepEqual(reader.read(["mình đi 40 phút mỗi ngày", "có 42 đôi không"]).values, {});
  assert.equal(reader.read(["chạy 5-10km, chân dài 25cm"]).values["dai"], 25);
});

test("phiếu 26/09: giày chạy chỉ có dài chân → CHƯA chốt size, xin rộng + chu vi; không cộng vì chạy dài", () => {
  const h = hintOf(["chân dài 25cm, chạy 5-10km, tìm giày chạy adidas"], "chân dài 25cm, chạy 5-10km, tìm giày chạy adidas", "adidas")!;
  assert.equal(h.status, "thieu");
  assert.equal(h.size, "");
  assert.deepEqual(h.missing, ["rộng", "chu vi vòng chân"]);
  const ctx = "giày chạy";
  assert.equal(hintOf(["chân 25cm, rộng 10.3cm, chu vi 24.9cm"], ctx)!.size, "42");
  assert.equal(hintOf(["chân 25cm, rộng 10.3cm, chu vi 24.9cm"], ctx)!.link, 26.5);
  assert.equal(hintOf(["chân 25cm, rộng 10.6cm, chu vi 25.2cm"], ctx)!.size, "42 2/3", "rộng bè lên 1 nấc");
  assert.equal(hintOf(["chân 25cm, rộng 9.9cm, chu vi 24.5cm"], ctx)!.size, "41 1/3", "thon lùi 1 nấc");
  const wide = hintOf(["chân 25cm, rộng 10.3cm, chu vi 26.2cm"], ctx)!;
  assert.equal(wide.size, "42 2/3");
  assert.equal(wide.wide, true, "chu vi vượt dải hai hàng trên → gợi ý bản wide");
  assert.deepEqual(hintOf(["chân 25cm, rộng 9.0cm, chu vi 24.9cm"], ctx)!.recheck, ["rộng"], "rộng lệch 4 nấc → đo lại");
  const cannot = hintOf(["chân 25cm", "mình không đo được"], ctx)!;
  assert.equal(cannot.status, "khong-do");
  assert.equal(cannot.size, "42", "mốc chuẩn 42 (không phải 42 2/3)");
  const puma = hintOf(["chân 25cm, rộng 10.3cm, chu vi 24.9cm"], ctx, "puma", PUMA)!;
  assert.equal(puma.size, "41", "Puma: tem 26,5 = 41");
  assert.equal(puma.link, 26.5);
  const nikeNoChart = hintOf(["chân 25cm, rộng 10.3cm, chu vi 24.9cm"], ctx, "nike", null)!;
  assert.equal(nikeNoChart.noChart, true);
  assert.equal(nikeNoChart.size, "", "hãng chưa có bảng → không quy ra nhãn size");
});

test("phiếu 06/09: giày sân chân 25.5 → 41 1/3–42; chưa rõ loại giày → chấp nhận đáp án mọi hệ, không nêu size", () => {
  const court = hintOf(["Mình vẫn chân bé 25.5"], "giày pickleball")!;
  assert.equal(court.status, "du");
  assert.equal(court.sizeLow, "41 1/3");
  assert.equal(court.size, "42");
  assert.deepEqual(court.acceptable, ["41 1/3", "42"]);
  const unknown = hintOf(["chân 25cm"], "")!;
  assert.equal(unknown.status, "chua-ro-he");
  assert.equal(unknown.size, "");
  for (const s of ["42", "40 2/3", "41 1/3"]) assert.ok(unknown.acceptable.includes(s), `${s} trong ${unknown.acceptable.join(",")}`);
  assert.equal(hintOf(["chân bé 25.5"], "giày chạy")!.status, "thieu", "giày chạy: số đo không đơn vị vẫn nhận nhưng chưa sinh size");
});

test("phiếu 26/09 (cổng size thay mọi size): chỉ câu quy đổi bị sửa; câu báo hàng / liệt kê giữ nguyên", () => {
  const hint = hintOf(["chân dài 25cm, rộng 10.3cm, chu vi 24.9cm", "xin đôi 40"], "giày chạy")!;
  const cust = "chân dài 25cm, rộng 10.3cm, chu vi 24.9cm\nxin đôi 40";
  const r = gate.run("Dạ chân 25cm thì em gợi ý size 41 ạ. Mẫu Velocity màu đen size 40 (UK 6.5) đang đặt được.", sources({ customerSaid: cust, sizeHint: hint }));
  assert.equal(r.reply, "Dạ chân 25cm thì em gợi ý size 42 ạ. Mẫu Velocity màu đen size 40 (UK 6.5) đang đặt được.");
  assert.ok(r.trace.some((t) => t.startsWith("size_chart_fix:41->42")), r.trace.join(" "));
  const list = "Dạ chân 25cm thì size 42 ạ. Bên em còn size 41 1/3, 42 và 42 2/3.";
  assert.equal(gate.run(list, sources({ customerSaid: cust, sizeHint: hint })).reply, list);
  assert.equal(gate.run("Dạ chân 25cm thì size 44 ạ.", sources({ customerSaid: cust, sizeHint: hint })).reply, "Dạ chân 25cm thì size 42 ạ.");
});

test("phiếu 26/09 (chỉ báo dài chân): cổng cắt vế quy size, bỏ size trong link lọc, chèn câu xin 3 thông số", () => {
  const cust = "chân dài 25cm, chạy 5-10km, tìm giày chạy adidas";
  const hint = hintOf([cust], cust, "adidas")!;
  const r = gate.run("Dạ chân 25cm thì anh đi size 42 2/3 (tem 27cm) là vừa ạ. Anh xem mẫu tại https://shop.example/?q=adizero&size=42%202%2F3#products", sources({ customerSaid: cust, sizeHint: hint }));
  assert.ok(r.trace.some((t) => t.startsWith("size_needs_measures:")), r.trace.join(" "));
  assert.doesNotMatch(r.reply, /42 2\/3|size=/);
  assert.match(r.reply, /3 thông số/);
  assert.match(r.reply, /https:\/\/shop\.example\/\?q=adizero#products/);
  // Stock talk listing sizes stays; "đi 40 phút" / "có 42 đôi" are not sizes.
  const list = "Dạ mẫu này bên em còn size 41 1/3, 42 và 42 2/3 ạ.";
  assert.equal(gate.run(list, sources({ customerSaid: cust, sizeHint: hint })).reply, list);
  const notSize = "Dạ bên em có 42 đôi mẫu này, anh đi 40 phút mỗi buổi thì đế êm là hợp ạ.";
  assert.equal(gate.run(notSize, sources({ customerSaid: cust, sizeHint: hint })).reply, notSize);
  // The exact label: the customer said 39.5, the bot says 39 → caught.
  const half = gate.run("Dạ chân 25cm thì anh lấy size 39 nhé.", sources({ customerSaid: `${cust}\nmình hay đi 39.5`, sizeHint: hint }));
  assert.ok(half.trace.some((t) => t.startsWith("size_needs_measures:39")), half.trace.join(" "));
  // Already asked once (the page said "3 thông số"): the short sentence.
  const again = gate.run("Dạ chân 25cm thì anh lấy size 42 nhé.", sources({ customerSaid: cust, sizeHint: hint, pageSaid: "Dạ anh đo giúp em đủ 3 thông số nhé" }));
  assert.match(again.reply, /rồi nhắn em/);
  // The customer's own size passes (they asked about it).
  assert.equal(gate.run("Dạ size 40 bên em còn ạ.", sources({ customerSaid: `${cust}\nsize 40 còn không`, sizeHint: hint })).trace.length, 0);
});

test("phiếu 06/09: khách giày sân 'chân bé 25.5' (không cm), bot nói 42 2/3 → cổng kéo về 42", () => {
  const cust = "Mình vẫn chân bé 25.5";
  const hint = hintOf([cust], "giày pickleball")!;
  const r = gate.run("Dạ chân 25.5 thì anh đi size 42 2/3 là vừa ạ.", sources({ customerSaid: cust, sizeHint: hint }));
  assert.equal(r.reply, "Dạ chân 25.5 thì anh đi size 42 là vừa ạ.");
  assert.equal(gate.run("Dạ chân 25.5 thì anh đi size 41 1/3 hoặc 42 ạ.", sources({ customerSaid: cust, sizeHint: hint })).trace.length, 0);
});

test("phiếu 01/09: cặp size ↔ cm tem phải khớp bảng của đúng hãng; số khách nói là gốc", () => {
  const ctx = "giày chạy puma";
  const puma = hintOf(["chân dài 25cm, rộng 10.3cm, chu vi 24.9cm"], ctx, "puma", PUMA)!;
  const pumaRows = advisor.variantRows("puma", PUMA);
  const cust = "chân dài 25cm, rộng 10.3cm, chu vi 24.9cm";
  const run = (reply: string, over: Partial<B.GateSources> = {}): B.ReplyGateResult => gate.run(reply, sources({ customerSaid: cust, sizeHint: puma, variantRows: pumaRows, variantBrand: "puma", ...over }));
  assert.equal(run("Dạ chân dài 25cm thì size 41 (tem 25.5cm) ạ.").reply, "Dạ chân dài 25cm thì size 41 (tem 26,5cm) ạ.");
  const fixed = run("Dạ chân dài 25cm thì bác đi size 44 (tem 28cm) ạ.");
  assert.equal(fixed.reply, "Dạ chân dài 25cm thì bác đi size 41 (tem 26,5cm) ạ.");
  assert.equal(run("Dạ chân dài 25cm thì size 41, hộp dài 30cm ạ.").reply, "Dạ chân dài 25cm thì size 41, hộp dài 30cm ạ.", "số đo hộp không đụng");
  // Unknown shoe type: every system's answer passes (40 = tag 25.5 is the everyday shoe's), and the pair is right.
  const unknown = hintOf(["chân dài 25cm"], "", "puma", PUMA)!;
  const snug = "Dạ chân dài 25cm thì size 40 (tem 25.5cm) đi hơi ôm ạ.";
  assert.equal(gate.run(snug, sources({ customerSaid: "chân dài 25cm", sizeHint: unknown, variantRows: pumaRows, variantBrand: "puma" })).reply, snug);
  // The bare "size 28" of the customer is the root: the size follows it; a cm the bot added follows the size.
  const table = advisor.variantRows("", null);
  const bare = (reply: string): string => gate.run(reply, sources({ customerSaid: "size 28 nhé", variantRows: table })).reply;
  assert.equal(bare("Dạ 28cm (44 2/3) bên em còn ạ."), "Dạ 28cm (44) bên em còn ạ.");
  assert.equal(bare("Dạ size 44 (28,5cm) bên em còn ạ."), "Dạ size 44 (28cm) bên em còn ạ.");
  // No cross-pairing over ")" and "hoặc".
  const two = "Dạ 44 (28cm) hoặc 44 2/3 (28,5cm) đều được ạ.";
  assert.equal(gate.run(two, sources({ customerSaid: "chân 26.5cm", variantRows: table })).reply, two);
});

test("phiếu 01/09: cặp size ↔ UK theo bảng hãng; gốc là UK / size khách nói; không rõ hãng, nhắc hãng khác, tên dòng thì không đụng", () => {
  const pumaRows = advisor.variantRows("puma", PUMA);
  const run = (reply: string, cust: string, over: Partial<B.GateSources> = {}): string => gate.run(reply, sources({ customerSaid: cust, variantRows: pumaRows, variantBrand: "puma", ...over })).reply;
  assert.equal(run("Dạ mẫu Velocity size 42 (tương đương UK 6.5) bên em đặt được ạ.", "mình lấy đôi 40"), "Dạ mẫu Velocity size 40 (tương đương UK 6.5) bên em đặt được ạ.");
  assert.equal(run("Dạ Puma size 42 (UK 8) ạ.", "còn không shop"), "Dạ Puma size 42 (UK 8) ạ.");
  const hint = hintOf(["chân dài 25cm, rộng 10.3cm, chu vi 24.9cm"], "giày chạy", "puma", PUMA)!;
  assert.equal(run("Dạ bác đi size 41 (UK 8) ạ.", "chân dài 25cm, rộng 10.3cm, chu vi 24.9cm", { sizeHint: hint }), "Dạ bác đi size 41 (UK 7.5) ạ.");
  assert.equal(run("Dạ UK 8 tương đương size 41 ạ.", "mình đi uk 8"), "Dạ UK 8 tương đương size 42 ạ.");
  assert.equal(run("Dạ Nike size 42 (UK 7.5) thì khác ạ.", "còn không"), "Dạ Nike size 42 (UK 7.5) thì khác ạ.", "nhắc hãng khác → không kiểm theo Puma");
  const nikeRows = advisor.variantRows("nike", NIKE);
  assert.equal(gate.run("Dạ Nike size 42 (UK 7.5) ạ.", sources({ customerSaid: "còn không", variantRows: nikeRows, variantBrand: "nike" })).reply, "Dạ Nike size 42 (UK 7.5) ạ.");
  const table = advisor.variantRows("", null);
  assert.equal(gate.run("Dạ size 42 (UK 6.5) ạ.", sources({ customerSaid: "còn không", variantRows: table })).reply, "Dạ size 42 (UK 6.5) ạ.", "không rõ hãng → không sửa UK");
  assert.equal(run("Dạ Pegasus 41 (UK 8) bên em hết ạ, con 40 tuổi đi cũng được.", "còn không"), "Dạ Pegasus 41 (UK 8) bên em hết ạ, con 40 tuổi đi cũng được.");
  assert.equal(advisor.variantRows("nike", null).length, 0, "hãng chưa có bảng → không có hàng nào để kiểm");
  assert.equal(run("Dạ dòng này có size 40–44 (UK 6.5–9.5) ạ.", "còn không"), "Dạ dòng này có size 40–44 (UK 6.5–9.5) ạ.", "khoảng size không phải cặp");
  assert.equal(run("Dạ size 42 (tem 27cm, UK 7) ạ.", "còn không"), "Dạ size 42 (tem 27cm, UK 8) ạ.", "số cm giữa cặp không làm đứt cặp; UK theo size");
});

test("phiếu 22/09 (phần 2): size do mô hình điền chỉ giữ khi KHÁCH đã nói; lời page chỉ tính khi khách vừa đồng ý ngắn", () => {
  assert.equal(B.variantSaidByCustomer("44 2/3", ["size 28 nhé", "còn màu đen không"]), false, "AI đọc lại câu bot '44 2/3' → không nhận");
  assert.equal(B.variantSaidByCustomer("44", ["size 44 nhé"]), true);
  assert.equal(B.variantSaidByCustomer("44 2/3", ["lấy 44,5 nhé"]), true, "khách nói nửa size = nấc 2/3");
  assert.equal(B.variantSaidByCustomer("44 2/3", ["44 rưỡi"]), true);
  assert.equal(B.variantSaidByCustomer("44 2/3", ["size 44"]), false);
  assert.equal(B.variantSaidByCustomer("43 1/3", ["ok"], "Dạ bác lấy size 43 1/3 nhé"), true, "khách đáp 'ok' câu page gợi size");
  assert.equal(B.variantSaidByCustomer("43 1/3", ["mẫu này có màu trắng không shop"], ""), false, "câu khác dài → không lấy size trong câu bot");
  assert.equal(B.variantSaidByCustomer("M", ["áo size m nhé"]), true);
});

test("phiếu 22/09 (phần 1): 'size 28' trần = cm tem; cm / tem / chân / tuổi / size EU thì không đổi", () => {
  const extractor = new B.EntityExtractor(B.loadEntityConfig("giay-chay"), B.entityLexiconOf(B.loadPack("giay-chay").lexicon, B.loadDialogueConfig("giay-chay")));
  assert.equal(extractor.extract("size 28 nhé").size, "44");
  assert.equal(extractor.extract("size 28,5").size, "44 2/3");
  assert.equal(extractor.extract("27 nhé").size, "42 2/3", "cả tin chỉ là số 2x = cm tem");
  assert.equal(extractor.extract("28,5 nha shop").size, "44 2/3");
  assert.equal(extractor.extract("28 tuổi").size, "");
  assert.equal(extractor.extract("27 đôi").size, "");
  assert.notEqual(extractor.extract("size 34").sizeSource, "bare_tag", "34 không phải số cm tem");
  assert.equal(extractor.extract("size 44").size, "44");
  assert.equal(extractor.extract("size 44").sizeSource, "explicit");
  assert.notEqual(extractor.extract("dài chân 28 thì size gì").size, "44");
  assert.notEqual(extractor.extract("tem 28").sizeNote.includes("khach noi"), true);
  assert.equal(extractor.extract("size 28 cho bé").size, "28");
  // Bổ sung 05/10/2026: the tag number itself rides along (`sizeTag`), so the stock tool can convert it with the
  // ITEM's brand chart; `size` stays the industry table's label, only a net. No tag reading = no `sizeTag`.
  assert.equal(extractor.extract("size 25").sizeTag, "25");
  assert.equal(extractor.extract("size 28,5").sizeTag, "28.5");
  assert.equal(extractor.extract("size 265").sizeTag, "26.5");
  assert.equal(extractor.extract("size 28 cho bé").sizeTag, undefined);
  assert.equal(extractor.extract("size 44").sizeTag, undefined);
});

test("ghi chú SIZE_TEM: quy theo bảng hãng thì nói hãng; hãng chưa có bảng thì nói rõ là QUY ĐỔI CHUNG", () => {
  const texts = B.loadNoteTexts("giay-chay");
  const brand = B.FactNoteComposer.compose({ customerPronoun: "anh", variantHint: { variant: "39", bareJp: true, raw: "25", tem: "25", brand: "puma" } }, texts);
  assert.match(brand, /size 39 \(tem 25cm\)/);
  assert.match(brand, /bang size cua hang puma/);
  const general = B.FactNoteComposer.compose({ customerPronoun: "anh", variantHint: { variant: "40", bareJp: true, raw: "25", tem: "25", brand: "hoka", general: true } }, texts);
  assert.match(general, /QUY DOI CHUNG[^\n]*hang hoka/);
  assert.match(general, /KHONG khang dinh/);
});

test("ghi chú SO_DO cho agent: thiếu số đo thì cấm nêu size; đủ thì nêu size + tem theo bảng", () => {
  const texts = B.loadNoteTexts("giay-chay");
  const cust = "chân dài 25cm, tìm giày chạy";
  const pending = B.FactNoteComposer.compose({ customerPronoun: "anh", sizeAdvice: hintOf([cust], cust)! }, texts);
  assert.match(pending, /CHUA DU SO DO CHAN/);
  assert.match(pending, /3 thong so/);
  const ready = B.FactNoteComposer.compose({ customerPronoun: "anh", sizeAdvice: hintOf(["chân 25cm, rộng 10.3cm, chu vi 24.9cm"], "giày chạy")! }, texts);
  assert.match(ready, /size 42 \(tem 26,5cm\)/);
  assert.match(ready, /CAM cong them vi chay dai/);
});
