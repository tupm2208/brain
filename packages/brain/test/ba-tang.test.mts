/**
 * BA TẦNG LÕI (24/09/2026): tầng 1 nền tảng, tầng 2 ngành, tầng 3 hồ sơ shop.
 *
 * Bài này canh ba lời hứa: (1) con số của một shop không bao giờ nằm trong tệp ngành — bộ soi chặn;
 * (2) ô chưa khai thì bot KHÔNG lấy mặc định ngành, lời dặn ghi rõ "chưa khai" và bảo chuyển người;
 * (3) shop tắt / viết lại khối mở thì lời dặn đổi theo, khối khoá thì không.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOP_PROFILE_FIELDS, emptyShopProfile, profileFieldSet, type ShopProfile } from "@sp/contract";
import {
  applyShopProfile, blocksForShop, checkBlocksFree, fillAgentText, notCarriedSentences, parseCommonAgent, parsePack, personInCharge, renderProfile,
  type AgentBlock
} from "@sp/brain";
import { runningShoesPack } from "./fixtures.mts";

const BLOCKS: AgentBlock[] = [
  { id: "mo", tieuDe: "Khoi mo", shopSua: true, loiDan: "Hoi cu ly va pace truoc." },
  { id: "khoa", tieuDe: "Khoi khoa", shopSua: false, loiDan: "Tem = dai chan + 1,5cm." }
];

function profileWith(patch: Partial<ShopProfile>): ShopProfile {
  return { ...emptyShopProfile(), ...patch };
}

test("bộ soi chặn con số của riêng một shop trong khối ngành; size và cm thì cho qua", () => {
  assert.equal(checkBlocksFree([{ id: "a", loiDan: "coc toi thieu 20% de giu don" }], "x").length, 1);
  assert.equal(checkBlocksFree([{ id: "a", loiDan: "hang ve 3-7 ngay" }], "x").length, 1);
  assert.equal(checkBlocksFree([{ id: "a", loiDan: "gia 2.890.000d" }], "x").length, 1);
  assert.deepEqual(checkBlocksFree([{ id: "a", loiDan: "size 42 2/3, tem = dai chan + 1,5cm, chay 5K hay 10K" }], "x"), []);
  // The shipped shoe pack passes — it carries placeholders, not TopRun's numbers.
  assert.deepEqual(checkBlocksFree(runningShoesPack.agent!.khoi, "giay-chay"), []);
});

test("chỗ trống điền từ hồ sơ; dòng [?path] chỉ giữ khi shop đã khai; ô trống thành '(chưa khai)'", () => {
  const empty = emptyShopProfile();
  const text = "Goi khach la {khach}.\n[?banHang.tiLeCoc] Coc {banHang.tiLeCoc}%.\nThoi gian: {banHang.thoiGianOrder}";
  assert.equal(fillAgentText(text, { site: "s", tenShop: "T", hoSo: empty }), "Goi khach la khách.\nThoi gian: (chưa khai)");
  const filled = profileWith({ xungHo: { khach: "bác", shop: "em" }, banHang: { ...empty.banHang, tiLeCoc: 20, thoiGianOrder: "3–7 ngày" } });
  assert.equal(fillAgentText(text, { site: "s", tenShop: "T", hoSo: filled }), "Goi khach la bác.\nCoc 20%.\nThoi gian: 3–7 ngày");
});

test("25/09/2026: câu chào AI và tên người phụ trách là ô của hồ sơ; {tenNguoiPhuTrach} điền tên shop khai, trống thì 'người phụ trách'", () => {
  const paths = SHOP_PROFILE_FIELDS.map((f) => f.path);
  assert.ok(paths.includes("cauChaoAi") && paths.includes("tenNguoiPhuTrach"), paths.join(","));
  const empty = emptyShopProfile();
  assert.equal(empty.cauChaoAi, "");
  assert.equal(empty.tenNguoiPhuTrach, "");
  assert.equal(profileFieldSet(empty, "tenNguoiPhuTrach"), false);
  assert.equal(personInCharge(empty), "người phụ trách");
  assert.equal(personInCharge(null), "người phụ trách");
  const text = "Dạ để em báo {tenNguoiPhuTrach} chốt đơn với {khach} ạ.";
  assert.equal(fillAgentText(text, { site: "s", tenShop: "T", hoSo: empty }), "Dạ để em báo người phụ trách chốt đơn với khách ạ.");
  const named = profileWith({ xungHo: { khach: "bác", shop: "em" }, tenNguoiPhuTrach: "anh Dũng", cauChaoAi: "Em là trợ lý AI của TopRun ạ." });
  assert.equal(fillAgentText(text, { site: "s", tenShop: "T", hoSo: named }), "Dạ để em báo anh Dũng chốt đơn với bác ạ.");
  const prompt = renderProfile(named, { doiTra: "", ship: "", baoHanh: "" });
  assert.match(prompt, /NGUOI PHU TRACH: "anh Dũng"/);
  assert.doesNotMatch(prompt, /trợ lý AI của TopRun/, "câu chào là việc của landing, không vào lời dặn agent");
  assert.doesNotMatch(prompt, /tên người phụ trách/, "đã khai thì không nằm trong CHUA KHAI");
});

test("khối mở: shop tắt hoặc viết bản riêng thì đổi; khối khoá thì hồ sơ có ghi gì cũng giữ bản ngành", () => {
  const off = profileWith({ khoiNganh: { mo: { cheDo: "tat", vanBan: "", phienBanNganh: "x" }, khoa: { cheDo: "tat", vanBan: "", phienBanNganh: "x" } } });
  assert.deepEqual(blocksForShop(BLOCKS, off).map((b) => b.id), ["khoa"]);
  const own = profileWith({ khoiNganh: { mo: { cheDo: "rieng", vanBan: "Shop sneaker: khong hoi pace.", phienBanNganh: "x" }, khoa: { cheDo: "rieng", vanBan: "Tem = dai chan.", phienBanNganh: "x" } } });
  const got = blocksForShop(BLOCKS, own);
  assert.equal(got.find((b) => b.id === "mo")!.loiDan, "Shop sneaker: khong hoi pace.");
  assert.equal(got.find((b) => b.id === "khoa")!.loiDan, "Tem = dai chan + 1,5cm.");
});

test("hồ sơ trống: lời dặn liệt kê từng ô chưa khai và bảo gọi người; hồ sơ đầy: nói đúng số của shop", () => {
  const missing = renderProfile(emptyShopProfile(), { doiTra: "", ship: "", baoHanh: "" });
  assert.match(missing, /CHUA KHAI \(shop chua dien\): xưng hô; tên người phụ trách; hàng order; COD hàng sẵn; mặc cả; khách chốt thì làm gì; mức mời chốt; cam kết về hàng \(chính hãng\?\); cửa hàng, giờ mở cửa; chính sách đổi trả; chính sách ship; chính sách bảo hành/);
  assert.doesNotMatch(missing, /20%|3-7 ngay/, "no number of any shop leaks into an empty profile");
  const empty = emptyShopProfile();
  const full = renderProfile(profileWith({
    xungHo: { khach: "bác", shop: "em" },
    banHang: { ...empty.banHang, coHangOrder: "co", thoiGianOrder: "3–7 ngày", tiLeCoc: 20, codHangSan: "co", macCa: { kieu: "khong-giam", chiTiet: "" }, khiChot: "phieu", cauKhongCo: "Hiện nhà em không còn mẫu đó / hãng đó ạ" },
    chuyenNguoi: { chuDe: ["xin biên lai"], mucChot: "dau-hieu", gioTruc: "7:00–23:00" }
  }), { doiTra: "Hàng sẵn đổi size.", ship: "", baoHanh: "" });
  assert.match(full, /goi khach la "bác"/);
  assert.match(full, /Coc truoc toi thieu 20%/);
  assert.match(full, /Hiện nhà em không còn mẫu đó \/ hãng đó ạ/);
  assert.match(full, /CHUA KHAI \(shop chua dien\): tên người phụ trách; cam kết về hàng \(chính hãng\?\); cửa hàng, giờ mở cửa; chính sách ship; chính sách bảo hành/);
});

test("máy luật: hồ sơ shop đè xưng hô, hãng, câu 'không có'; câu cấm ba tầng cộng dồn", () => {
  const empty = emptyShopProfile();
  const hoSo = profileWith({
    xungHo: { khach: "anh chị", shop: "shop" }, cauCam: ["free ship"], hangCoBan: ["Nike"], hangKhongBan: ["Salomon"],
    banHang: { ...empty.banHang, cauKhongCo: "Hiện nhà em không còn mẫu đó / hãng đó ạ" }
  });
  const pack = applyShopProfile(runningShoesPack, hoSo, ["cam ket 100%"]);
  assert.equal(pack.identity.customerPronoun, "anh chị");
  assert.deepEqual(pack.lexicon.brands, ["nike"]);
  assert.deepEqual(pack.lexicon.knownBrandsNotCarried, ["salomon"]);
  assert.ok(pack.identity.neverSay.includes("free ship") && pack.identity.neverSay.includes("cam ket 100%") && pack.identity.neverSay.includes("bảo hành trọn đời"));
  assert.match(pack.templates["brand_not_carried"]!, /hàng \{hang\}/);
  // The pack itself is untouched: the next shop starts from the industry's values.
  assert.equal(runningShoesPack.identity.customerPronoun, "bác");
  assert.deepEqual(notCarriedSentences(""), null);
});

test("agent.json cũ (một systemPrompt) vẫn đọc được thành một khối; loi-chung thiếu tệp = tầng 1 rỗng", () => {
  const legacy = { systemPrompt: ["A", "B"], mustHumanPattern: "", handoffReplyPattern: "", tools: [] };
  const rules = JSON.parse(JSON.stringify(runningShoesPack));
  delete rules.agent;
  const pack = parsePack(rules, legacy);
  assert.deepEqual(pack.agent!.khoi.map((b) => b.id), ["loi-dan"]);
  assert.equal(pack.agent!.khoi[0]!.loiDan, "A\nB");
  assert.deepEqual(parseCommonAgent(null), { khoi: [], mustHumanPattern: "", handoffReplyPattern: "", cauCam: [] });
  assert.throws(() => parseCommonAgent({ khoi: [{ id: "Sai Id", tieuDe: "x", loiDan: "y" }] }), /chi gom chu thuong/);
});
