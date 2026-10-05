/**
 * 05/10/2026 — phiếu Desk nhóm NHU CẦU / TƯ VẤN (06/09 hỏi đích danh vẫn bị hỏi mục đích, 03/09 nhu cầu
 * phổ thông bị đẩy giày sân / hồ sơ chạy bộ, 03/09 + 06/09 hồ sơ chạy bộ hỏi thừa hoặc không kích hoạt).
 *
 * Tầng 1 thử bằng NGÀNH GIẢ (nhà thuốc: thuốc cảm cho trẻ cần tuổi + cân nặng; vitamin là nhu cầu thường
 * ngày): hỏi đích danh không hỏi hồ sơ, đã biết / đã hỏi thì không hỏi lại, nhu cầu chuyên môn nhắc ở đâu
 * trong phiên cũng thắng nhu cầu thường ngày, cổng chỉ cắt mệnh đề hỏi. Tầng 2 nạp gói `giay-chay` thật
 * và chạy bảng Ca kiểm của ba phiếu.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import "./fixtures.mts";

// ---------------------------------------------------------------- tier 1: an invented industry

const PHARMACY = B.parseConsultProfile({
  hoSoTuVan: {
    hoiNhuCau: "mua (thuoc )?cho ai|(trieu chung|benh) (gi|the nao|ra sao)",
    boTruoc: "\\b(gia|ship)\\s*\\d+k?\\b",
    nhom: [
      {
        id: "tre-cam", ten: "thuốc cảm cho trẻ", kieu: "chuyen-mon",
        khi: "\\b(cam|sot|so mui|ho)\\b",
        truong: [
          { id: "tuoi", ten: "tuổi của bé", doc: "\\d{1,2}\\s*(tuoi|thang)", hoi: "(be|chau) (may|bao nhieu) (tuoi|thang)" },
          { id: "can", ten: "cân nặng", doc: "\\d{1,2}([.,]\\d)?\\s*(kg|ky|can)\\b", hoi: "(nang|can nang) (bao nhieu|may)", tuPhanTich: "weight" },
          { id: "diUng", ten: "dị ứng thuốc", batBuoc: false, doc: "di ung", hoi: "co di ung (thuoc )?gi khong" }
        ],
        suyRa: [{ id: "so-sinh", khi: "so sinh", dat: { tuoi: { noi: "sơ sinh" } } }]
      },
      { id: "thuong-ngay", ten: "chăm sóc thường ngày", kieu: "pho-thong", khi: "\\b(vitamin|bo sung|de khang)\\b", mucDich: "cham_soc_thuong_ngay" }
    ]
  }
}, "test/nha-thuoc");

const pharmacy = (customerLines: string[], o: { pageLines?: string[]; named?: boolean; analysis?: Record<string, unknown> } = {}): B.ConsultVerdict =>
  new B.ConsultProfiler(PHARMACY.config).assess({ customerLines, pageLines: o.pageLines ?? [], named: o.named === true, analysis: o.analysis ?? null });

test("tầng 1 (nhà thuốc giả): bộ soi hoSoTuVan nhận cấu hình hợp lệ và báo đúng trường khi sai", () => {
  assert.deepEqual(PHARMACY.problems, []);
  const bad = B.parseConsultProfile({ hoSoTuVan: { nhom: [
    { id: "a", ten: "a", kieu: "la", khi: "x" },
    { id: "b", ten: "b", kieu: "pho-thong", khi: "y" },
    { id: "c", ten: "c", kieu: "chuyen-mon", khi: "(", truong: [{ id: "t", ten: "t", doc: "x", hoi: "y" }], suyRa: [{ id: "s", khi: "z", dat: { khongCo: { noi: "x" } } }] }
  ] } }, "gia");
  assert.ok(bad.problems.some((p) => /kieu/.test(p)), bad.problems.join("\n"));
  assert.ok(bad.problems.some((p) => /mucDich/.test(p)), bad.problems.join("\n"));
  assert.ok(bad.problems.some((p) => /khi.*bieu thuc/.test(p)), bad.problems.join("\n"));
  assert.ok(bad.problems.some((p) => /khongCo/.test(p)), bad.problems.join("\n"));
  assert.ok(bad.problems.some((p) => /hoiNhuCau/.test(p)), bad.problems.join("\n"));
  assert.deepEqual(B.parseConsultProfile({ needs: [] }, "khong-co-khoi"), { config: B.emptyConsultProfileConfig(), problems: [] });
});

test("tầng 1: xin tư vấn chung → thiếu tuổi + cân nặng (chưa hỏi) → hỏi; câu hỏi nhu cầu không được hỏi nữa", () => {
  const v = pharmacy(["bé nhà em bị cảm sốt, mua thuốc gì ạ"]);
  assert.equal(v.status, "thieu");
  assert.equal(v.need?.id, "tre-cam");
  assert.deepEqual(v.missing.map((m) => m.id), ["tuoi", "can"], "dị ứng không bắt buộc");
  assert.ok(v.noAsk.includes(PHARMACY.config.askNeed));
});

test("tầng 1: khách hỏi ĐÍCH DANH (Panadol 500) → không hỏi hồ sơ, cũng không hỏi nhu cầu", () => {
  const v = pharmacy(["Panadol 500 cho bé bị sốt còn không"], { named: true });
  assert.equal(v.status, "dich-danh");
  for (const f of PHARMACY.config.needs[0]!.fields) assert.ok(v.noAsk.includes(f.ask), f.id);
  assert.ok(v.noAsk.includes(PHARMACY.config.askNeed));
});

test("tầng 1: biết từ lời khách, từ suy ra, từ LLM#1; đủ thì không hỏi thêm", () => {
  assert.equal(pharmacy(["bé 3 tuổi 14kg bị sốt"]).status, "du");
  const born = pharmacy(["con sơ sinh bị sổ mũi"], { analysis: { weight: "3,5kg" } });
  assert.equal(born.status, "du");
  assert.deepEqual(born.known.map((k) => `${k.id}:${k.by}`), ["tuoi:suy-ra", "can:phan-tich"]);
  // Read from the whole session, not the message alone: "14kg" two lines back still counts.
  assert.equal(pharmacy(["bé 3 tuổi bị ho", "14kg ạ", "ok"]).status, "du");
});

test("tầng 1: page ĐÃ HỎI trong phiên mà khách chưa trả lời rõ → không hỏi lại (mỗi thông tin một lần)", () => {
  const once = pharmacy(["bé bị sốt", "bé còn nhỏ lắm"], { pageLines: ["Dạ bé mấy tuổi rồi ạ?"] });
  assert.equal(once.status, "thieu", "cân nặng chưa hỏi lần nào");
  assert.deepEqual(once.asked.map((a) => a.id), ["tuoi"]);
  assert.deepEqual(once.missing.map((a) => a.id), ["can"]);
  assert.ok(once.noAsk.some((p) => new RegExp(p).test("be may tuoi roi a")));
  const both = pharmacy(["bé bị sốt", "không nhớ nữa"], { pageLines: ["Dạ bé mấy tuổi, nặng bao nhiêu kg ạ?"] });
  assert.equal(both.status, "da-hoi");
  assert.deepEqual(both.missing, []);
});

test("tầng 1: nhu cầu thường ngày → pho-thong (tra theo mục đích); nhu cầu chuyên môn nhắc ở bất kỳ đâu trong phiên thì thắng", () => {
  const daily = pharmacy(["mua vitamin tăng đề kháng cho bé"]);
  assert.equal(daily.status, "pho-thong");
  assert.equal(daily.need?.purpose, "cham_soc_thuong_ngay");
  for (const f of PHARMACY.config.needs[0]!.fields) assert.ok(daily.noAsk.includes(f.ask));
  assert.equal(pharmacy(["bé đang sốt nhẹ", "mua thêm vitamin bổ sung"]).need?.id, "tre-cam");
  assert.equal(pharmacy(["shop ơi"]).status, "chua-ro");
  assert.equal(pharmacy(["shop ơi", "ừ"], { pageLines: ["Dạ anh mua thuốc cho ai ạ?"] }).status, "da-hoi-nhu-cau");
});

test("tầng 1: cổng chỉ cắt MỆNH ĐỀ hỏi điều không được hỏi, giữ câu tồn/giá", () => {
  const v = pharmacy(["Panadol 500 còn không"], { named: true });
  const g = (reply: string) => new B.ReplyGate(B.loadReplyGateConfig("nha-thuoc"), [new B.ConsultAskRule()]).run(reply, { shopSaid: "", customerSaid: "", policy: "", hoSo: null, found: [], stockFacts: null, lookups: { orderLooked: false, tracking: null, exchange: null }, links: {}, consultNoAsk: v.noAsk });
  const out = g("Dạ Panadol 500 bên em còn hàng ạ, bé mấy tuổi rồi ạ? Mình lấy mấy hộp ạ?");
  assert.equal(out.reply, "Dạ Panadol 500 bên em còn hàng ạ. Mình lấy mấy hộp ạ?");
  assert.deepEqual(out.trace, ["consult_no_ask:1"]);
  assert.equal(g("Dạ còn hàng ạ.").trace.length, 0, "không có câu hỏi thì không đụng");
  assert.equal(g("Bé mấy tuổi, nặng bao nhiêu kg ạ?").reply, "", "câu chỉ có câu hỏi thì rỗng — đường ống chuyển lưới sau");
});

// ---------------------------------------------------------------- tier 2: the real running-shoe pack

const shoes = B.loadConsultProfile("giay-chay");
const aliases = B.loadMatchingConfig("giay-chay").groups.aliases;
const shoe = (customerLines: string[], o: { pageLines?: string[]; named?: boolean; analysis?: Record<string, unknown> } = {}): B.ConsultVerdict =>
  new B.ConsultProfiler(shoes).assess({ customerLines, pageLines: o.pageLines ?? [], named: o.named === true, analysis: o.analysis ?? null, groupAliases: aliases });
const known = (v: B.ConsultVerdict, id: string) => v.known.find((k) => k.id === id);
const asksIn = (v: B.ConsultVerdict, sentence: string): boolean => v.noAsk.some((p) => new RegExp(p).test(B.gateNormalize(sentence)));

test("tầng 2 (phiếu 06/09): hỏi đích danh mẫu + size → không hỏi chạy bộ hay đi chơi / cự ly / pace / chạy lâu chưa", () => {
  const v = shoe(["Adizero SL2 size 42,5"], { named: true });
  assert.equal(v.status, "dich-danh");
  for (const q of ["Dạ anh lấy chạy bộ hay đi chơi ạ?", "Anh thường chạy cự ly bao nhiêu ạ?", "Pace của anh tầm bao nhiêu ạ?", "Anh chạy lâu chưa ạ?", "Chị chơi sân cứng hay đất nện ạ?"]) assert.ok(asksIn(v, q), q);
  assert.ok(!asksIn(v, "Dạ mẫu Adizero SL 2 size 42 bên em còn 2 đôi, giá 2.490.000đ ạ."));
  assert.ok(!asksIn(v, "Dòng này nhẹ, hợp chạy tempo cự ly 5-10km ạ."), "câu mô tả có chữ cự ly không phải câu hỏi");
  assert.equal(shoe(["Tôi cần giày chạy bộ, bạn tư vấn giúp"]).status, "thieu", "chung chung vẫn hỏi hồ sơ");
});

test("tầng 2 (phiếu 03/09 phổ thông): đi học / thể dục / đa năng → pho-thong; nhắc môn hoặc pace/km thì không", () => {
  const ca = shoe(["Tìm giày nữ size 39 cho cháu đi học, thể dục, đa năng một tý có mẫu nào hợp lý gửi em xin ít mẫu có sẵn kèm giá nhé"]);
  assert.equal(ca.status, "pho-thong");
  assert.equal(ca.need?.purpose, "di_hoc_di_choi_da_nang");
  assert.ok(asksIn(ca, "Chị chạy pace bao nhiêu ạ?"));
  assert.notEqual(shoe(["tìm giày đi học và đánh pickleball"]).status, "pho-thong", "nhắc môn (từ đời thường của nhomHang)");
  assert.equal(shoe(["tìm giày đi học và đánh pickleball"]).need?.id, "giay-san");
  assert.equal(shoe(["giày chạy 10km pace 6"]).need?.id, "chay-bo");
  assert.equal(shoe(["giày đá banh cho con đi học"]).need?.id, "mon-khac");
  assert.equal(shoe(["giày đi học", "à cháu cũng hay đá bóng"]).need?.id, "mon-khac", "môn nhắc ở bất kỳ đâu trong phiên thắng");
  assert.equal(shoe(["cho anh hỏi Duramo còn size 42 không"], { named: true }).status, "dich-danh");
  assert.equal(shoe(["giày da bóng đi làm"]).need?.id, "pho-thong", "\"da bóng\" (da láng) không phải bóng đá");
});

test("tầng 2 (phiếu 03/09 + 06/09 hồ sơ chạy bộ): bảng Ca kiểm", () => {
  for (const said of ["pace tầm 6", "pace khoảng 6"]) {
    const v = shoe(["chạy 10km", said]);
    assert.equal(known(v, "tocDo")?.by, "khach", said);
    assert.equal(v.status, "du", said);
  }
  assert.equal(known(shoe(["chạy HM pace 4:30, size 42, cần đôi đua"]), "tocDo")?.said, "pace 4:30", "phút:giây đọc trọn");
  const easy = (lines: string[]) => known(shoe(lines), "tocDo")?.band === "p7plus";
  for (const s of ["Chạy 5 km thôi", "mình chạy nhẹ nhàng 5km buổi sáng", "đúng rồi mình chỉ chạy chậm nhẹ nhàng thôi", "chạy thể dục buổi sáng cho khỏe", "chạy 3km giảm cân", "chạy 5 km thôi, ship 500k được không"]) {
    assert.ok(easy([s]), s);
    assert.equal(shoe([s]).status, "du", s);
  }
  assert.equal(known(shoe(["chạy 5 km thôi, ship 500k được không"]), "cuLy")?.said, "5 km", "500k là tiền, không phải cự ly");
  for (const s of ["a chạy 5km", "chạy 10km", "chạy 5km thi đấu", "half marathon", "chạy 5k sub 25", "chạy nhẹ nhàng nhưng tuần có chạy giải 21k"]) {
    assert.ok(!easy([s]), s);
    const v = shoe([s]);
    assert.equal(v.status, "thieu", s);
    assert.deepEqual(v.missing.map((m) => m.id), ["tocDo"], s);
  }
  assert.ok(!easy(["chạy 5km pace 5"]));
  assert.equal(shoe(["chạy 5km pace 5"]).status, "du");
  assert.deepEqual(shoe(["giày chạy bộ size 40"]).missing.map((m) => m.id), ["cuLy", "tocDo"], "size không phải cự ly");
  // A short follow-up keeps the profile (read from the session), and pace asked once is not asked twice.
  assert.equal(shoe(["tư vấn giày chạy bộ", "chạy 5 km thôi", "ok"]).status, "du");
  const twice = shoe(["Chạy 5 km", "cũng bình thường thôi"], { pageLines: ["Dạ anh thường chạy pace bao nhiêu ạ?"] });
  assert.equal(twice.status, "da-hoi");
  assert.ok(asksIn(twice, "Anh chạy pace tầm bao nhiêu ạ?"));
  // LLM#1's reading counts as given.
  assert.equal(shoe(["giày chạy bộ"], { analysis: { distance: "10k", pace: "5:30" } }).status, "du");
});

test("tầng 2: ghi chú HO_SO_TU_VAN cho agent — đích danh / thiếu / đã hỏi / đủ", () => {
  const texts = B.loadNoteTexts("giay-chay");
  const named = B.FactNoteComposer.compose({ consult: { ...shoe(["Adizero SL2 size 42,5"], { named: true }), notAsked: ["cự ly", "tốc độ"] } }, texts);
  assert.match(named, /KHACH HOI DICH DANH MAU/);
  assert.match(named, /KHONG hoi "chạy bộ hay đi chơi", KHONG hoi cự ly, tốc độ/);
  assert.match(B.FactNoteComposer.compose({ consult: shoe(["a chạy 5km"]) }, texts), /da biet: cự ly .*= 5km\. con thieu: tốc độ/);
  assert.match(B.FactNoteComposer.compose({ consult: shoe(["Chạy 5 km", "bình thường"], { pageLines: ["Anh chạy pace bao nhiêu ạ?"] }) }, texts), /DA HOI tốc độ .* KHONG hoi lai/);
  assert.match(B.FactNoteComposer.compose({ consult: shoe(["Chạy 5 km thôi"]) }, texts), /DA DU .*KHONG hoi them muc dich, cu ly hay pace/);
  assert.equal(B.FactNoteComposer.compose({ consult: shoe(["shop ơi"]) }, texts), "", "chưa rõ thì không có khối");
});
