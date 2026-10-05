/**
 * BA TẦNG LÕI (24/09/2026): tầng 1 nền tảng, tầng 2 ngành, tầng 3 hồ sơ shop.
 *
 * Bài này canh ba lời hứa: (1) con số của một shop không bao giờ nằm trong tệp ngành — bộ soi chặn;
 * (2) ô chưa khai thì bot KHÔNG lấy mặc định ngành, lời dặn ghi rõ "chưa khai" và bảo chuyển người;
 * (3) shop tắt / viết lại khối mở thì lời dặn đổi theo, khối khoá thì không.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOP_PROFILE_FIELDS, emptyShopProfile, profileFieldSet, readShopProfile, type ShopProfile } from "@sp/contract";
import {
  applyShopProfile, blocksForShop, checkBlocksFree, fillAgentText, parseCommonAgent, parsePack, personInCharge, renderProfile,
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
  assert.match(missing, /CHUA KHAI \(shop chua dien\): xưng hô; tên người phụ trách; COD hàng sẵn; mặc cả; khách chốt thì làm gì; mức mời chốt; cam kết về hàng \(chính hãng\?\); cửa hàng, giờ mở cửa; chính sách đổi trả; chính sách ship; chính sách bảo hành/);
  assert.doesNotMatch(missing, /20%|3-7 ngay/, "no number of any shop leaks into an empty profile");
  const empty = emptyShopProfile();
  const full = renderProfile(profileWith({
    xungHo: { khach: "bác", shop: "em" },
    banHang: { ...empty.banHang, thoiGianOrder: "3–7 ngày", tiLeCoc: 20, codHangSan: "co", macCa: { kieu: "khong-giam", chiTiet: "" }, khiChot: "phieu" },
    chuyenNguoi: { chuDe: ["xin biên lai"], mucChot: "dau-hieu", gioTruc: "7:00–23:00" },
    cauHoiRieng: [{ cauHoi: "Có xuất hoá đơn VAT không?", traLoi: "Có, báo trước khi đặt." }],
    quyTrinhRieng: [{ quyTac: "Khách hỏi size thì hỏi chiều dài bàn chân trước.", khoi: "" }]
  }), { doiTra: "Hàng sẵn đổi size.", ship: "", baoHanh: "" });
  assert.match(full, /goi khach la "bác"/);
  assert.match(full, /coc truoc toi thieu 20%/);
  // 02/10/2026: no "hãng có / không bán" lines; the shop's own questions and procedures are spoken.
  assert.doesNotMatch(full, /HANG CO BAN|HANG KHONG BAN|KHI KHONG CO MAU/);
  assert.match(full, /CAU HOI RIENG CUA SHOP[\s\S]*Hoi: Có xuất hoá đơn VAT không\? → Tra loi: Có, báo trước khi đặt\./);
  assert.match(full, /QUY TRINH RIENG CUA SHOP[\s\S]*Khách hỏi size thì hỏi chiều dài bàn chân trước\./);
  assert.match(full, /CHUA KHAI \(shop chua dien\): tên người phụ trách; cam kết về hàng \(chính hãng\?\); cửa hàng, giờ mở cửa; chính sách ship; chính sách bảo hành/);
});

test("máy luật: hồ sơ shop đè xưng hô; câu cấm ba tầng cộng dồn; hồ sơ KHÔNG đổi danh sách hãng hay câu 'không có'", () => {
  // An old profile still carrying the retired fields (hangCoBan, hangKhongBan, cauKhongCo) is read without them.
  const hoSo = readShopProfile({ xungHo: { khach: "anh chị", shop: "shop" }, cauCam: ["free ship"], hangCoBan: ["Nike"], hangKhongBan: ["Salomon"], banHang: { cauKhongCo: "Hiện nhà em không còn mẫu đó / hãng đó ạ" } });
  const pack = applyShopProfile(runningShoesPack, hoSo, ["cam ket 100%"]);
  assert.equal(pack.identity.customerPronoun, "anh chị");
  assert.deepEqual(pack.lexicon.brands, runningShoesPack.lexicon.brands, "the industry's brand words stay: they recognise a brand, they never say what a shop sells");
  assert.equal(pack.templates, runningShoesPack.templates);
  assert.ok(pack.identity.neverSay.includes("free ship") && pack.identity.neverSay.includes("cam ket 100%") && pack.identity.neverSay.includes("bảo hành trọn đời"));
  // The pack itself is untouched: the next shop starts from the industry's values.
  assert.equal(runningShoesPack.identity.customerPronoun, "bác");
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

// 05/10/2026 (phiếu Desk 01/09 "agent và cổng soát thiếu nguồn thật"): công cụ đọc NGUỒN THẬT của shop (chính
// sách, tài khoản) là cơ chế tầng 1 — khai ở `loi-chung/agent-chung.json`, ngành mới không phải khai lại.
test("công cụ chinh_sach / tai_khoan_shop là tầng 1: ngành giả không khai công cụ nào vẫn có; gói giày giữ y thứ tự + mô tả cũ", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  let root = process.cwd();
  while (!fs.existsSync(path.join(root, "loi-chung", "agent-chung.json"))) root = path.dirname(root);
  const json = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
  const { PackRegistry } = await import("@sp/brain");
  const fake = new PackRegistry({
    ids: () => ["nha-thuoc"],
    read: () => ({ rules: json("nganh/nha-thuoc/bo-luat.json"), agent: { khoi: [{ id: "tu-van", tieuDe: "Tu van", loiDan: "Hoi trieu chung truoc khi goi y." }] } }),
    common: () => json("loi-chung/agent-chung.json")
  });
  const tools = fake.load("nha-thuoc").agent!.tools;
  assert.deepEqual(tools.map((t) => [t.name, t.landingMethod]), [["chinh_sach", "policy"], ["tai_khoan_shop", "bankAccount"]]);
  // The shoe pack: same tools, same order, same words as when it declared them itself.
  assert.deepEqual(runningShoesPack.agent!.tools.map((t) => t.name), ["tra_kho", "bang_size", "chinh_sach", "tai_khoan_shop"]);
  assert.match(runningShoesPack.agent!.tools[3]!.moTa, /tai khoan ngan hang \/ vi CUA SHOP/);
  // An industry that re-declares a tier-1 tool by name rewrites its description — one entry, not two.
  const own = new PackRegistry({
    ids: () => ["nha-thuoc"],
    read: () => ({ rules: json("nganh/nha-thuoc/bo-luat.json"), agent: { khoi: [{ id: "tu-van", tieuDe: "Tu van", loiDan: "x" }], tools: [{ name: "chinh_sach", handler: "landing", landingMethod: "policy", moTa: "chinh sach nha thuoc" }] } }),
    common: () => json("loi-chung/agent-chung.json")
  });
  assert.deepEqual(own.load("nha-thuoc").agent!.tools.map((t) => `${t.name}:${t.moTa}`).slice(0, 1), ["chinh_sach:chinh sach nha thuoc"]);
  assert.equal(own.load("nha-thuoc").agent!.tools.filter((t) => t.name === "chinh_sach").length, 1);
  // No agent.json = no agent: tier 1's tools do not create one.
  const none = new PackRegistry({ ids: () => ["nha-thuoc"], read: () => ({ rules: json("nganh/nha-thuoc/bo-luat.json") }), common: () => json("loi-chung/agent-chung.json") });
  assert.equal(none.load("nha-thuoc").agent, undefined);
});

test("05/10/2026 bỏ ô 'Có hàng order': hồ sơ không còn ô; lời dặn nói hàng order theo kết quả tra kho; điều kiện chung chỉ khi shop khai (tầng 1 + 3)", () => {
  assert.ok(!SHOP_PROFILE_FIELDS.some((f) => f.path === "banHang.coHangOrder"));
  const old = readShopProfile({ banHang: { coHangOrder: "khong", thoiGianOrder: "về sau vài hôm", tiLeCoc: 30 }, nguon: { "banHang.coHangOrder": "shop", "banHang.tiLeCoc": "shop" } });
  assert.ok(!("coHangOrder" in old.banHang), "an old profile's switch falls off on read");
  assert.deepEqual(old.nguon, { "banHang.tiLeCoc": "shop" });
  const said = renderProfile(old, { doiTra: "", ship: "", baoHanh: "" });
  assert.doesNotMatch(said, /KHONG ban hang order|chi tu van hang co san/);
  assert.match(said, /HANG ORDER: hang san hay hang order la theo KET QUA tra_kho \(loai \/ dieu_kien cua tung size, theo kho du kien xuat\)/);
  assert.match(said, /dieu kien chung cua shop: thoi gian: về sau vài hôm; coc truoc toi thieu 30%/);
  // Empty profile: the conduct line stays, no general terms, and "hàng order" is never listed as missing.
  const empty = renderProfile(emptyShopProfile(), { doiTra: "", ship: "", baoHanh: "" });
  assert.match(empty, /HANG ORDER: hang san hay hang order la theo KET QUA tra_kho/);
  assert.doesNotMatch(empty, /dieu kien chung cua shop/);
  assert.doesNotMatch(empty, /CHUA KHAI[^\n]*(hàng order|tỷ lệ cọc|thời gian hàng order)/);
  // Only the lead time set: said alone, no invented deposit.
  const lead = renderProfile(profileWith({ banHang: { ...emptyShopProfile().banHang, thoiGianOrder: "về sau vài hôm" } }), { doiTra: "", ship: "", baoHanh: "" });
  assert.match(lead, /dieu kien chung cua shop: thoi gian: về sau vài hôm\./);
  assert.doesNotMatch(lead, /coc truoc toi thieu/);
});

test("05/10/2026 tầng 2 (gói giày thật): khối hàng order không còn hỏi ô 'Có hàng order' — giữ cho mọi shop, kể cả hồ sơ trống; mẫu hồ sơ không gợi ý ô đó", () => {
  const agent = runningShoesPack.agent!;
  assert.doesNotMatch(JSON.stringify(agent), /coHangOrder/);
  assert.equal(agent.mauHoSo.goiY["banHang.coHangOrder"], undefined);
  assert.deepEqual(checkBlocksFree(agent.khoi, "giay-chay"), []);
  const block = (hoSo: ShopProfile) => fillAgentText(blocksForShop(agent.khoi, hoSo).find((b) => b.id === "hang-san-va-order")!.loiDan, { site: "s", tenShop: "T", hoSo });
  assert.match(block(emptyShopProfile()), /Size tra_kho ghi HANG ORDER: noi "đang đặt được"/);
  assert.match(block(readShopProfile({ banHang: { coHangOrder: "khong" } })), /Size tra_kho ghi HANG ORDER/, "an old 'no' does not drop the line");
});
