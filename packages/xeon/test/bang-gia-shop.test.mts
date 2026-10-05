/**
 * BẢNG GIÁ CỦA SHOP (02/10/2026) — the two Xeon doors behind OMI → Kho → Cách tính giá:
 *
 *   POST /kho/mau-bang-gia      ready-made tables: tier 1 (`loi-chung/mau-bang-gia.json`) then the
 *                               shop's industry (`nganh/<id>/mau-bang-gia.json`; absent = none);
 *   POST /kho/bang-gia/hieu-y   the shop's own words → a table, cleaned against the shop's catalogue.
 *
 * Tier 1 is tested with an industry nobody coded for (a temporary folder), tier 2 with the shipped
 * running-shoe pack, and the shop's side with catalogues that do and do not carry a value.
 * Every model here is a script: no network, no key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import "./industries.mts";
import {
  COMMON_DATA_FILES, INDUSTRY_DIRECTORY, createXeonServer, LicenseLedger, LicenseService, ManualClock, MemoryLogger, PriceRuleTranslator,
  PriceTemplateLibrary, SellingPriceController, cleanPriceRules, currentUsage, generateSigningKey, orderSpecificFirst, parsePriceRulePrompt,
  licensedIndustry, priceRulePrompt, proseProblems, readCommonDataJson, selfCheckSellingPriceFiles,
  type CatalogChoices, type TextModelPort, type TextOutcome, type TextRequest
} from "@sp/xeon";

const T0 = new Date("2026-10-02T08:00:00.000Z");
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test reads arbitrary wire fields

/**
 * The landing's type vocabulary (`TYPE_CHOICES`, landing_page/src/modules/hang-kho/product-classification.ts).
 * A template value outside it would match no item at all on the landing.
 */
const LANDING_TYPES = ["Giày", "Quần áo", "Balo", "Túi xách", "Mũ", "Tất", "Phụ kiện"];

/** A catalogue as the landing counts it (`catalogValues`). */
const CHOICES: CatalogChoices = { loai: ["Giày", "Quần áo", "Phụ kiện"], hang: ["Hãng A", "Hãng B"], mon: ["Chạy bộ"], gioiTinh: ["Nam", "Nữ"] };

/** A slice of the landing's `PRICE_TABLE_GUIDE`: the guide travels with the request. */
const GUIDE = { dong: "Danh sách dòng, dòng đầu tiên khớp thì dùng.", kieu: { tien: "giá bán = giá gốc + tien" }, luat: ["Chỉ dùng con số shop đã nói."] };

class ScriptModel implements TextModelPort {
  readonly asked: TextRequest[] = [];
  readonly agents: string[] = [];
  private readonly answer: TextOutcome | string;
  private readonly on: boolean;
  constructor(answer: TextOutcome | string, on = true) {
    this.answer = answer;
    this.on = on;
  }
  ready(): boolean { return this.on; }
  async complete(request: TextRequest): Promise<TextOutcome> {
    this.asked.push(request);
    this.agents.push(String(currentUsage()?.agent ?? ""));
    return typeof this.answer === "string" ? { ok: true, text: this.answer, model: "script" } : this.answer;
  }
}

const shippedPrompt = (): unknown => readCommonDataJson(INDUSTRY_DIRECTORY, COMMON_DATA_FILES.priceRulesPrompt);

async function build(model: TextModelPort, options: { directory?: string; prompt?: () => unknown } = {}) {
  const clock = new ManualClock(T0);
  const license = new LicenseService({ ledger: await LicenseLedger.open(), signingKey: generateSigningKey(), clock, sellableModules: ["chatbot-cskh"], coreModules: ["hang-kho"] });
  const shoes = await license.issueKey({ shop: "shop-giay", tenShop: "Shop Giày", nganh: "giay-chay", manh: ["chatbot-cskh"], hetHan: "2027-09-15T00:00:00.000Z" });
  // The pharmacy bought only the warehouse: price tables are a warehouse feature, the chatbot is not needed.
  const pharmacy = await license.issueKey({ shop: "nha-thuoc-1", tenShop: "Nhà thuốc", nganh: "nha-thuoc", hetHan: "2027-09-15T00:00:00.000Z" });
  const shoeLanding = await license.registerLanding({ key: shoes.key, diaChi: "https://giay.test" });
  const pharmacyLanding = await license.registerLanding({ key: pharmacy.key, diaChi: "https://thuoc.test" });
  assert.ok(shoeLanding.ok && pharmacyLanding.ok);
  const logger = new MemoryLogger();
  const directory = options.directory ?? INDUSTRY_DIRECTORY;
  const controller = new SellingPriceController({
    templates: new PriceTemplateLibrary(directory),
    translator: new PriceRuleTranslator({ model, prompt: options.prompt ?? shippedPrompt }),
    // The real resolution, as `buildXeonApp` wires it: the industry on the shop's licence.
    industryOf: licensedIndustry(license),
    license, logger
  });
  const call = async (route: string, body: unknown, token: string | null = shoeLanding.ok ? shoeLanding.maNhanTin : ""): Promise<{ status: number; body: Body }> => {
    let status = 0;
    let out: Body = {};
    const req = { headers: token === null ? {} : { authorization: `Bearer ${token}` } } as unknown as IncomingMessage;
    const res = { writeHead(code: number) { status = code; return this; }, end(t: string) { out = t ? JSON.parse(t) : {}; } } as unknown as ServerResponse;
    assert.equal(await controller.handle(req, res, { method: "POST", path: route, ip: "1.1.1.1", readJson: async () => body as Record<string, unknown> }), true);
    return { status, body: out };
  };
  return { call, license, logger, shoeKey: shoes.key, pharmacyToken: pharmacyLanding.ok ? pharmacyLanding.maNhanTin : "" };
}

/** A temporary `nganh/` + `loi-chung/` pair, the way a person would lay them out. */
function folders(common: Record<string, unknown>, industries: Record<string, Record<string, unknown>>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bang-gia-"));
  const nganh = path.join(root, "nganh");
  fs.mkdirSync(path.join(root, "loi-chung"), { recursive: true });
  for (const [name, body] of Object.entries(common)) fs.writeFileSync(path.join(root, "loi-chung", name), typeof body === "string" ? body : JSON.stringify(body), "utf8");
  for (const [id, files] of Object.entries(industries)) {
    fs.mkdirSync(path.join(nganh, id), { recursive: true });
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(nganh, id, name), typeof body === "string" ? body : JSON.stringify(body), "utf8");
  }
  if (!fs.existsSync(nganh)) fs.mkdirSync(nganh);
  return nganh;
}

// ================================================================== /kho/mau-bang-gia

test("mẫu chung trước, mẫu ngành sau; ngành của shop lấy từ license", async () => {
  const { call } = await build(new ScriptModel("{}"));
  const r = await call("/kho/mau-bang-gia", {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body["nganh"], "giay-chay");
  const ids = (r.body["mau"] as Body[]).map((m) => m["id"]);
  assert.deepEqual(ids, ["bang-trong", "cong-phan-tram", "cong-so-tien", "giay-chay-bac-thang"], "tầng 1 trước, tầng 2 sau");
  for (const m of r.body["mau"] as Body[]) {
    assert.ok(String(m["ten"]).length > 0 && String(m["moTa"]).length > 0, `mẫu ${m["id"]} phải có tên và mô tả cho người chọn`);
    assert.equal(m["bang"]["ma"], "", "mã bảng do landing đặt khi lưu");
    assert.equal(m["bang"]["nguonMau"], m["id"], "bảng nhớ nó bắt đầu từ mẫu nào");
  }
  const generic = (r.body["mau"] as Body[]).slice(0, 3);
  for (const m of generic) {
    assert.equal(m["bang"]["dong"].length, 0, "mẫu chung không có dòng nào gọi tên một loại hàng");
    assert.equal(m["bang"]["conLai"]["tien"], 0, "mẫu chung không mang số tiền của ai");
    assert.equal(m["bang"]["conLai"]["pt"], 0, "mẫu chung không mang phần trăm của ai");
  }
  assert.equal(generic[0]!["bang"]["conLai"]["kieu"], "trong");
  assert.equal(generic[1]!["bang"]["conLai"]["kieu"], "pt");
  assert.deepEqual(generic[1]!["bang"]["lamTron"], [{ dk: [], buoc: 10000, huong: "len", tru: 0, tronTram: false }], "lên chục nghìn, không trừ đuôi");
  assert.equal(generic[2]!["bang"]["conLai"]["kieu"], "tien");
});

test("ngành không có tệp mau-bang-gia.json: chỉ mẫu chung, không phải lỗi; shop chưa mua chatbot vẫn được phục vụ", async () => {
  const { call, pharmacyToken } = await build(new ScriptModel("{}"));
  const r = await call("/kho/mau-bang-gia", {}, pharmacyToken);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body["nganh"], "nha-thuoc");
  assert.deepEqual((r.body["mau"] as Body[]).map((m) => m["id"]), ["bang-trong", "cong-phan-tram", "cong-so-tien"]);
});

test("shop đến từ MÃ NHẬN TIN: không mã là 401, đòi shop khác là 403, key khoá thì không phục vụ", async () => {
  const { call, license, shoeKey } = await build(new ScriptModel("{}"));
  assert.equal((await call("/kho/mau-bang-gia", {}, null)).status, 401);
  assert.equal((await call("/kho/mau-bang-gia", {}, "ma-la")).status, 401);
  assert.equal((await call("/kho/mau-bang-gia", { tenant: "nha-thuoc-1" })).status, 403, "không đọc được mẫu của ngành khác bằng cách gõ tên shop");
  await license.lockKey(shoeKey, "thu");
  const locked = await call("/kho/mau-bang-gia", {});
  assert.ok(locked.status === 401 || locked.status === 403, `key khoá phải bị từ chối (được ${locked.status})`);
  assert.notEqual(locked.status, 200);
});

test("tầng 2 thật: bậc thang giày chạy viết thành dòng, đúng từ vựng loại của landing, dòng cụ thể đứng trước", () => {
  const { mau, problems } = new PriceTemplateLibrary(INDUSTRY_DIRECTORY).forIndustry("giay-chay");
  assert.deepEqual(problems, []);
  const ladder = mau.find((m) => m.id === "giay-chay-bac-thang");
  assert.ok(ladder, "ngành giày phải có mẫu bậc thang");
  assert.equal(ladder.ten, "Mẫu giày chạy (bậc thang Image Tool)");
  const t = ladder.bang;
  assert.equal(t.dong.length, 13);
  assert.deepEqual(t.conLai, { dk: [], kieu: "tien", tien: 200000, pt: 0, phi: 0, giaThapNhat: null, giaCaoNhat: null, khongQuaNiemYet: false });
  assert.equal(t.khongQuaNiemYet, false);
  // A few lines that carry the ladder's shape: socks first, the deepest discount before the shallower one.
  assert.deepEqual(t.dong[0], { dk: [{ f: "loai", v: ["Tất"] }], kieu: "tien", tien: 100000, pt: 0, phi: 0, giaThapNhat: null, giaCaoNhat: null, khongQuaNiemYet: false });
  assert.deepEqual(t.dong[7]!.dk, [{ f: "loai", v: ["Giày"] }, { f: "giam", tu: 70, duoi: null }]);
  assert.deepEqual(t.dong[9]!.dk, [{ f: "loai", v: ["Giày"] }, { f: "giam", tu: 50, duoi: null }, { f: "giaGoc", tu: 2500000, duoi: null }]);
  assert.deepEqual(t.gioiHan, [
    { dk: [{ f: "giaGoc", tu: 300001, duoi: null }], tien: 0, pt: 10 },
    { dk: [{ f: "loai", v: ["Giày"] }, { f: "giaGoc", tu: 1000001, duoi: null }], tien: 200000, pt: 0 }
  ]);
  assert.deepEqual(t.lamTron, [
    { dk: [{ f: "loai", v: ["Quần áo", "Balo", "Túi xách", "Mũ", "Tất", "Phụ kiện"] }, { f: "giaTruoc", tu: null, duoi: 1000000 }], buoc: 50000, huong: "gan", tru: 10000, tronTram: true },
    { dk: [], buoc: 100000, huong: "gan", tru: 10000, tronTram: false }
  ]);
  const types = [...t.dong, ...t.gioiHan, ...t.lamTron].flatMap((r) => r.dk.filter((c) => c.f === "loai").flatMap((c) => c.v ?? []));
  for (const v of types) assert.ok(LANDING_TYPES.includes(v), `"${v}" không có trong TYPE_CHOICES của landing — dòng đó không khớp hàng nào`);
  assert.deepEqual(orderSpecificFirst(t.dong, "dòng", () => "").notes, [], "không dòng nào bị dòng chung phía trên che mất");
  assert.deepEqual(orderSpecificFirst(t.lamTron, "cách làm tròn", () => "").notes, []);
});

test("bộ soi: mọi tệp bảng giá giao kèm đều qua checkBlocksFree; số trong `bang` là dữ liệu mẫu, không phải chữ", () => {
  assert.doesNotThrow(() => selfCheckSellingPriceFiles(INDUSTRY_DIRECTORY));
  const files = [
    ["loi-chung/mau-bang-gia.json", path.join(INDUSTRY_DIRECTORY, "..", "loi-chung", "mau-bang-gia.json")],
    ["loi-chung/bang-gia-hieu-y.json", path.join(INDUSTRY_DIRECTORY, "..", "loi-chung", "bang-gia-hieu-y.json")],
    ["nganh/giay-chay/mau-bang-gia.json", path.join(INDUSTRY_DIRECTORY, "giay-chay", "mau-bang-gia.json")]
  ] as const;
  for (const [name, full] of files) assert.deepEqual(proseProblems(JSON.parse(fs.readFileSync(full, "utf8")), name), [], `${name} phải qua bộ soi`);
  // The checker is live: a shop's number in prose is caught.
  assert.equal(proseProblems({ mau: [{ moTa: "Mọi mã cộng 15% là đẹp" }] }, "x").length, 1);
  assert.equal(proseProblems({ mau: [{ moTa: "lãi 1.500.000 mỗi đôi" }] }, "x").length, 1);
});

test("tầng 1 với ngành lạ: thiếu cả hai tệp là danh sách rỗng; tệp viết sai làm Xeon không khởi động, nói rõ tệp và chỗ sai", () => {
  const bare = folders({}, { "my-pham": { "bo-luat.json": { id: "my-pham" } } });
  assert.deepEqual(new PriceTemplateLibrary(bare).forIndustry("my-pham"), { mau: [], problems: [] });
  assert.doesNotThrow(() => selfCheckSellingPriceFiles(bare));

  const ok = { mau: [{ id: "mot", ten: "Một", moTa: "", bang: { conLai: { kieu: "pt", pt: 0 } } }] };
  const hidden = {
    mau: [{ id: "che", ten: "Bị che", moTa: "", bang: { dong: [{ dk: [{ f: "loai", v: ["Son"] }], kieu: "tien", tien: 1 }, { dk: [{ f: "loai", v: ["Son"] }, { f: "giam", tu: 50 }], kieu: "tien", tien: 2 }] } }]
  };
  const unknownField = { mau: [{ id: "la", ten: "Lạ", moTa: "", bang: { dong: [{ dk: [{ f: "dungTich", v: ["50ml"] }], kieu: "tien", tien: 1 }] } }] };
  const shopNumber = { mau: [{ id: "so", ten: "Số shop", moTa: "Cộng 12% cho mọi mã", bang: {} }] };
  const cases: [string, unknown, RegExp][] = [
    ["dòng cụ thể bị dòng chung che", hidden, /che mất/],
    ["điều kiện landing không biết", unknownField, /dungTich/],
    ["con số của shop trong chữ", shopNumber, /12%/],
    ["JSON hỏng", "{ mau: [", /khong phai JSON hop le/]
  ];
  for (const [what, industryFile, expected] of cases) {
    const dir = folders({ "mau-bang-gia.json": ok }, { "my-pham": { "bo-luat.json": { id: "my-pham" }, "mau-bang-gia.json": industryFile } });
    assert.throws(() => selfCheckSellingPriceFiles(dir), (e: Error) => expected.test(e.message) && /my-pham/.test(e.message), what);
  }
  // A duplicate id cannot shadow a platform template.
  const dup = folders({ "mau-bang-gia.json": ok }, { "my-pham": { "bo-luat.json": { id: "my-pham" }, "mau-bang-gia.json": ok } });
  const list = new PriceTemplateLibrary(dup).forIndustry("my-pham");
  assert.deepEqual(list.mau.map((m) => m.id), ["mot"]);
  assert.match(list.problems.join(" "), /trùng/);
});

// ================================================================== /kho/bang-gia/hieu-y

const LOI_KE = "Giày lãi 200 nghìn, giày giảm từ 60% thì 250 nghìn, quần áo 150 nghìn, hàng khác cộng 20%, lãi ít nhất 10%, làm tròn lên đuôi 90 nghìn";

/** What a good model writes for LOI_KE — but in the order the shop SAID it, and in the shop's own spelling. */
const GOOD = JSON.stringify({
  bang: {
    dong: [
      { dk: [{ f: "loai", v: ["Giày"] }], kieu: "tien", tien: 200000, pt: 0 },
      { dk: [{ f: "loai", v: ["giay"] }, { f: "giam", tu: 60 }], kieu: "tien", tien: 250000, pt: 0 },
      { dk: [{ f: "loai", v: ["quần áo"] }], kieu: "tien", tien: 150000, pt: 0, ghiChuThem: "trường lạ" }
    ],
    conLai: { kieu: "pt", tien: 0, pt: 20 },
    gioiHan: [{ dk: [], tien: 0, pt: 10 }],
    lamTron: [{ dk: [], buoc: 100000, huong: "len", tru: 10000, tronTram: false }],
    khongQuaNiemYet: false,
    tuyChonLa: true
  },
  hieuLa: ["Giày cộng 200.000.", "Giày giảm từ 60% cộng 250.000.", "Quần áo cộng 150.000.", "Hàng khác cộng 20%.", "Lãi ít nhất 10%.", "Làm tròn lên trăm nghìn rồi trừ 10.000."],
  chuaRo: []
});

const request = (over: Body = {}): Body => ({ loiKe: LOI_KE, bangHienTai: {}, huongDan: GUIDE, giaTriCoSan: CHOICES, ...over });

test("lời kể thành bảng: chữ của shop đổi về giá trị có sẵn, dòng cụ thể lên trước, trường lạ bỏ, kèm câu đọc lại", async () => {
  const model = new ScriptModel(GOOD);
  const { call } = await build(model);
  const r = await call("/kho/bang-gia/hieu-y", request({ bangHienTai: { ma: "hang-order", ten: "Hàng order" } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const bang = r.body["bang"];
  assert.deepEqual(bang["dong"], [
    { dk: [{ f: "loai", v: ["Giày"] }, { f: "giam", tu: 60, duoi: null }], kieu: "tien", tien: 250000, pt: 0, phi: 0, giaThapNhat: null, giaCaoNhat: null, khongQuaNiemYet: false },
    { dk: [{ f: "loai", v: ["Giày"] }], kieu: "tien", tien: 200000, pt: 0, phi: 0, giaThapNhat: null, giaCaoNhat: null, khongQuaNiemYet: false },
    { dk: [{ f: "loai", v: ["Quần áo"] }], kieu: "tien", tien: 150000, pt: 0, phi: 0, giaThapNhat: null, giaCaoNhat: null, khongQuaNiemYet: false }
  ], "\"giay\"/\"quần áo\" về đúng chữ trong danh mục; dòng giảm 60% không bị dòng Giày che");
  assert.deepEqual(bang["conLai"], { dk: [], kieu: "pt", tien: 0, pt: 20, phi: 0, giaThapNhat: null, giaCaoNhat: null, khongQuaNiemYet: false });
  assert.deepEqual(bang["gioiHan"], [{ dk: [], tien: 0, pt: 10 }]);
  assert.deepEqual(bang["lamTron"], [{ dk: [], buoc: 100000, huong: "len", tru: 10000, tronTram: false }]);
  assert.equal("tuyChonLa" in bang, false, "trường lạ của mô hình không đi về landing");
  assert.equal(bang["ma"], "hang-order", "bảng đang sửa giữ mã của nó");
  assert.equal((r.body["hieuLa"] as string[]).length, 6);
  assert.match((r.body["chuaRo"] as string[]).join(" "), /Đưa dòng “Giày, giảm từ 60%” lên trước “Giày”/, "việc Xeon tự sửa phải nói cho người duyệt");
  assert.deepEqual(model.agents, ["price_rules"], "tiền mô hình vào đúng cột của kho");

  // What the model was told: the words, the catalogue, the landing's guide, tier 1's rules and closing line.
  const asked = model.asked[0]!;
  assert.match(asked.user, /Giày lãi 200 nghìn/);
  assert.match(asked.user, /- loai: Giày \| Quần áo \| Phụ kiện/);
  assert.match(asked.user, /Chỉ dùng con số shop đã nói/, "hướng dẫn định dạng đi theo yêu cầu, Xeon không giữ bản sao");
  assert.match(asked.system, /chỉ dùng con số chủ shop đã nói/i);
  assert.match(asked.user, /không gọi hàm hay công cụ nào\.?$/, "câu chống malformed_function_call đứng cuối");
  assert.ok(asked.schema !== undefined, "đòi JSON có lược đồ");
});

test("giá trị không có trong danh mục shop bị bỏ; điều kiện mất hết giá trị thì bỏ CẢ dòng, không để thành 'mọi hàng'", async () => {
  const invented = JSON.stringify({
    bang: {
      dong: [
        { dk: [{ f: "loai", v: ["Dép"] }], kieu: "tien", tien: 90000 },
        { dk: [{ f: "loai", v: ["Giày", "Dép"] }], kieu: "tien", tien: 200000 },
        { dk: [{ f: "hang", v: ["Hãng Z"] }, { f: "loai", v: ["Giày"] }], kieu: "tien", tien: 300000 },
        { dk: [{ f: "size", v: ["42"] }], kieu: "tien", tien: 50000 },
        { dk: [{ f: "loai", v: ["Quần áo"] }], kieu: "tien", tien: -5000, pt: 5000 },
        { dk: [{ f: "loai", v: ["Phụ kiện"] }], kieu: "giamgia", tien: 1 }
      ],
      conLai: { kieu: "trong" },
      gioiHan: [{ dk: [{ f: "gioiTinh", v: ["Trẻ em"] }], tien: 100000 }],
      lamTron: [{ dk: [{ f: "giaGoc", tu: 1 }], buoc: 100000 }, { dk: [], buoc: 30000 }]
    },
    hieuLa: ["..."],
    chuaRo: ["Hàng còn lại tính sao?"]
  });
  const { call } = await build(new ScriptModel(invented));
  const r = await call("/kho/bang-gia/hieu-y", request());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const bang = r.body["bang"];
  assert.deepEqual(bang["dong"], [
    { dk: [{ f: "loai", v: ["Giày"] }], kieu: "tien", tien: 200000, pt: 0, phi: 0, giaThapNhat: null, giaCaoNhat: null, khongQuaNiemYet: false },
    { dk: [{ f: "loai", v: ["Quần áo"] }], kieu: "tien", tien: 0, pt: 1000, phi: 0, giaThapNhat: null, giaCaoNhat: null, khongQuaNiemYet: false },
    { dk: [{ f: "loai", v: ["Phụ kiện"] }], kieu: "trong", tien: 1, pt: 0, phi: 0, giaThapNhat: null, giaCaoNhat: null, khongQuaNiemYet: false }
  ], "Dép-only, Hãng Z, size: bỏ cả dòng; Giày/Dép giữ Giày; số âm thành 0, phần trăm chặn 1000; cách cộng lạ thành chưa định giá");
  assert.deepEqual(bang["gioiHan"], [], "giới hạn cho nhóm không có trong danh mục không áp lên mọi hàng");
  assert.deepEqual(bang["lamTron"], [{ dk: [], buoc: 10000, huong: "gan", tru: 0, tronTram: false }], "giá gốc không phải điều kiện làm tròn; bước lạ về 10.000");
  // The landing shows few lines: Xeon's corrections first but capped, the model's question still there.
  const chuaRo = r.body["chuaRo"] as string[];
  assert.equal(chuaRo.length, 6, chuaRo.join("\n"));
  assert.match(chuaRo[0]!, /“Dép” \(loại\).*“Hãng Z” \(hãng\).*“Trẻ em” \(giới tính\).*không có trong danh mục của shop/);
  assert.match(chuaRo[4]!, /và \d+ chỗ Xeon sửa khác/);
  assert.equal(chuaRo[5], "Hàng còn lại tính sao?");
  // Every correction is still made and worded, one sentence each.
  const all = cleanPriceRules(JSON.parse(invented)["bang"], { choices: CHOICES }).ghiChu.join("\n");
  for (const said of ["“Dép” (loại)", "điều kiện “size”", "giamgia", "“giaGoc”", "“30000”", "Bỏ một giới hạn lãi"]) {
    assert.ok(all.includes(said), `phải nói: ${said}\n${all}`);
  }
});

test("mô hình trả thứ không đọc được: 502 nói thẳng, không trả bảng rỗng như thể đã hiểu", async () => {
  for (const answer of ["xin lỗi tôi không chắc", JSON.stringify({ hieuLa: ["..."], chuaRo: [] }), JSON.stringify({ bang: [], hieuLa: [] })]) {
    const { call } = await build(new ScriptModel(answer));
    const r = await call("/kho/bang-gia/hieu-y", request());
    assert.equal(r.status, 502, answer);
    assert.equal(r.body["error"], "khong_doc_duoc");
    assert.match(String(r.body["message"]), /không đọc được/);
  }
  // JSON wrapped in prose / a fence is still read.
  const { call } = await build(new ScriptModel("Đây là bảng:\n```json\n" + GOOD + "\n```"));
  assert.equal((await call("/kho/bang-gia/hieu-y", request())).status, 200);
});

test("AI không sẵn sàng: 503 với câu tiếng Việt rõ ràng; chưa kể gì: 400; thiếu tệp lời dặn: 503", async () => {
  const off = await build(new ScriptModel(GOOD, false));
  const r1 = await off.call("/kho/bang-gia/hieu-y", request());
  assert.equal(r1.status, 503);
  assert.equal(r1.body["error"], "chua_co_mo_hinh");
  assert.match(String(r1.body["message"]), /tự điền bảng/);

  const down = await build(new ScriptModel({ ok: false, viSao: "cổng AI 502" }));
  const r2 = await down.call("/kho/bang-gia/hieu-y", request());
  assert.equal(r2.status, 503);
  assert.equal(r2.body["error"], "mo_hinh_khong_tra_loi");
  assert.match(String(r2.body["message"]), /cổng AI 502/);

  const model = new ScriptModel(GOOD);
  const empty = await build(model);
  assert.equal((await empty.call("/kho/bang-gia/hieu-y", request({ loiKe: "   " }))).status, 400);
  assert.equal(model.asked.length, 0, "không tốn lượt mô hình khi chưa có lời kể");

  const noPrompt = await build(new ScriptModel(GOOD), { prompt: () => null });
  const r3 = await noPrompt.call("/kho/bang-gia/hieu-y", request());
  assert.equal(r3.status, 503);
  assert.equal(r3.body["error"], "thieu_loi_dan");
});

test("bảng đang có đi vào lời nhắc để lời kể sửa một phần; bảng trống thì ghi '(chưa có)'", () => {
  const words = parsePriceRulePrompt(shippedPrompt());
  assert.ok(words, "tệp lời dặn giao kèm phải đọc được");
  const current = cleanPriceRules({ dong: [{ dk: [{ f: "loai", v: ["Giày"] }], kieu: "tien", tien: 200000 }], conLai: { kieu: "trong" } }).bang;
  const withTable = priceRulePrompt(words, { tenant: "t", loiKe: "đổi giày thành 250 nghìn", bangHienTai: current, huongDan: GUIDE, giaTriCoSan: CHOICES });
  assert.match(withTable.user, /BẢNG ĐANG CÓ TRÊN MÀN HÌNH:\n\{"dong":\[\{"dk":\[\{"f":"loai","v":\["Giày"\]\}\],"kieu":"tien","tien":200000/);
  const blank = priceRulePrompt(words, { tenant: "t", loiKe: "x", bangHienTai: {}, huongDan: {}, giaTriCoSan: { loai: [], hang: [], mon: [], gioiTinh: [] } });
  assert.match(blank.user, /BẢNG ĐANG CÓ TRÊN MÀN HÌNH:\n\(chưa có\)/);
  assert.match(blank.user, /- hang: \(chưa có\)/);
  assert.doesNotMatch(blank.user, /HƯỚNG DẪN ĐỊNH DẠNG/, "landing không gửi hướng dẫn thì không có mục rỗng");
});

// ================================================================== over a real socket

/**
 * Through the HTTP server on port 0, the way the landing calls it. Requests go through `node:http`
 * with no keep-alive and each resolves only once its socket has CLOSED: with `fetch`'s pooled
 * socket still closing, the runner's forced exit aborts the process on Windows (libuv
 * `UV_HANDLE_CLOSING`), whatever the test asserted.
 */
test("qua socket thật: hai cửa /kho/* trả đúng hình dạng landing đọc; thân không phải JSON là 400", async () => {
  const clock = new ManualClock(T0);
  const license = new LicenseService({ ledger: await LicenseLedger.open(), signingKey: generateSigningKey(), clock, sellableModules: ["chatbot-cskh"], coreModules: ["hang-kho"] });
  const { key } = await license.issueKey({ shop: "shop-moi", tenShop: "Shop mới", nganh: "giay-chay", hetHan: "2027-09-15T00:00:00.000Z" });
  const landing = await license.registerLanding({ key, diaChi: "https://shop-moi.test" });
  assert.ok(landing.ok);
  const server = createXeonServer({
    controllers: [new SellingPriceController({
      templates: new PriceTemplateLibrary(INDUSTRY_DIRECTORY),
      translator: new PriceRuleTranslator({ model: new ScriptModel(GOOD), prompt: shippedPrompt }),
      industryOf: licensedIndustry(license), license, logger: new MemoryLogger()
    })]
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = (route: string, body: string) => new Promise<{ status: number; body: Body }>((resolve, reject) => {
      let status = 0;
      let text = "";
      const req = http.request(`${origin}${route}`, { method: "POST", agent: false, headers: { "Content-Type": "application/json", Authorization: `Bearer ${landing.maNhanTin}` } }, (res) => {
        status = res.statusCode ?? 0;
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { text += chunk; });
      });
      req.on("error", reject);
      req.on("close", () => resolve({ status, body: text ? JSON.parse(text) as Body : {} }));
      req.end(body);
    });
    const templates = await post("/kho/mau-bang-gia", "{}");
    assert.equal(templates.status, 200, JSON.stringify(templates.body));
    assert.equal(templates.body["ok"], true);
    assert.equal(templates.body["nganh"], "giay-chay");
    assert.ok((templates.body["mau"] as Body[]).some((m) => m["id"] === "giay-chay-bac-thang"));
    const words = await post("/kho/bang-gia/hieu-y", JSON.stringify(request()));
    assert.equal(words.status, 200, JSON.stringify(words.body));
    assert.deepEqual(Object.keys(words.body).sort(), ["bang", "chuaRo", "hieuLa", "model", "ok"]);
    assert.equal((await post("/kho/bang-gia/hieu-y", "{ khong phai json")).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("'Tự làm công thức' (04/10/2026): phí, giá thấp nhất / cao nhất, không vượt niêm yết theo dòng, sale có 'đến dưới', bảng lãi ở Còn lại — giữ nguyên khi soát", () => {
  const { bang, ghiChu } = cleanPriceRules({
    dong: [
      { dk: [{ f: "giam", tu: 30, duoi: 50 }], kieu: "cong", pt: 10, tien: 100000, phi: 20000, giaThapNhat: 199000, giaCaoNhat: "x", khongQuaNiemYet: true },
      { dk: [], kieu: "cong", tien: 1, giaThapNhat: 500, giaCaoNhat: 100 }
    ],
    conLai: { kieu: "banglai" }
  });
  assert.deepEqual(bang.dong[0], { dk: [{ f: "giam", tu: 30, duoi: 50 }], kieu: "cong", tien: 100000, pt: 10, phi: 20000, giaThapNhat: 199000, giaCaoNhat: null, khongQuaNiemYet: true });
  assert.equal(bang.conLai.kieu, "banglai");
  assert.ok(ghiChu.some((n) => /giá thấp nhất .* cao hơn giá cao nhất/.test(n)), "an impossible pair is said, not silently kept");
});
