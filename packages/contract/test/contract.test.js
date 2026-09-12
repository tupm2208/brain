// Bai kiem tra cho BAN GIAO KEO.
// Muc dich khong phai do bao phu, ma la GIU LUAT: moi luat kien truc da chot
// deu phai co mot bai kiem tra lam no gay ngay khi bi vi pham.
//
// Nhieu bai o day CO TINH dung ban khai bao roi tra lai nguyen trang, de chung minh
// ham kiem tra bat duoc vi pham THAT — chu khong phai chi xanh vi du lieu hien tai dang dung.
//
// Chay: npm test

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const C = require("../dist/index.js");

/** Doi tam mot gia tri roi tra lai nguyen trang du bai kiem tra co nem loi. */
function withPatched(obj, key, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(obj, key);
  const old = obj[key];
  obj[key] = value;
  try {
    fn();
  } finally {
    if (had) obj[key] = old;
    else delete obj[key];
  }
}

const licenseMau = (over = {}) => ({
  tenant: "t1", tenantName: "Shop thu", machine: "m1", packId: "giay-chay",
  modules: [], seats: 3,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  minContract: "0.1.0", issuedAt: new Date(Date.now() - 86400000).toISOString(),
  ...over
});

const monHangSach = () => ({
  tenant: "t1", id: "i1", code: "IE0000", name: "Adizero Boston 13", brand: "adidas",
  category: "giay chay", variantAxis: "size",
  variants: [{ id: "v1", label: "42", price: 3190000, sort: 42 }],
  attributes: { gender: "nam" }, images: ["a.jpg"],
  url: "https://toprun.site/p/ie0000", updatedAt: "2026-09-09T00:00:00.000Z"
});

// ===========================================================================
// Cau truc da chot
// ===========================================================================

test("selfCheck: cac luat kien truc tu kiem deu dat", () => {
  assert.doesNotThrow(() => C.selfCheck());
});

test("ba mang, muoi ba manh, duoi tran 15", () => {
  assert.equal(C.MODULE_IDS.length, 13);
  assert.ok(C.MODULE_IDS.length <= C.MODULE_CEILING);
  assert.deepEqual([...C.MODULE_GROUPS], ["vanhanh", "content", "chatbot"]);
  assert.equal(C.modulesOfGroup("vanhanh").length, 7);
  assert.equal(C.modulesOfGroup("content").length, 3);
  assert.equal(C.modulesOfGroup("chatbot").length, 3);
});

test("ba manh loi dung nhu da chot", () => {
  assert.deepEqual(C.CORE_MODULE_IDS.sort(), ["don-khach", "hang-kho", "lien-ket"]);
});

// ===========================================================================
// Luat 1 — manh ngang hang khong goi thang nhau
// ===========================================================================

test("khong manh nao phu thuoc vao manh khong phai loi", () => {
  for (const id of C.MODULE_IDS) {
    for (const dep of C.MODULES[id].dependsOn) {
      assert.ok(C.MODULES[dep].core, `"${id}" phu thuoc thang vao "${dep}" khong phai manh loi.`);
    }
  }
});

test("khong manh nao phu thuoc ma nguon sang may khac", () => {
  for (const id of C.MODULE_IDS) {
    for (const dep of C.MODULES[id].dependsOn) {
      assert.equal(
        C.MODULES[dep].runsOn, C.MODULES[id].runsOn,
        `"${id}" (${C.MODULES[id].runsOn}) phu thuoc "${dep}" (${C.MODULES[dep].runsOn}) — hai may khac nhau.`
      );
    }
  }
});

test("BAT DUOC: phu thuoc ngang hang", () => {
  withPatched(C.MODULES["xuong-video"], "dependsOn", ["van-chuyen"], () => {
    assert.throws(() => C.assertModuleGraph(), /khong phai manh loi/);
  });
});

test("BAT DUOC: phu thuoc xuyen may", () => {
  withPatched(C.MODULES["chatbot-cskh"], "dependsOn", ["hang-kho"], () => {
    assert.throws(() => C.assertModuleGraph(), /hai may khac nhau|Hai may khac nhau/);
  });
});

test("BAT DUOC: vong tron giua hai manh loi", () => {
  // Ca hai deu la manh loi va cung chay tren may khach, nen hai cong kia deu cho qua —
  // chi con cong do chu trinh bat duoc. Truoc day khong co cong nay.
  withPatched(C.MODULES["hang-kho"], "dependsOn", ["don-khach"], () => {
    assert.throws(() => C.assertModuleGraph(), /Vong tron phu thuoc/);
  });
});

test("BAT DUOC: manh khai cong cu cua manh khac", () => {
  withPatched(C.MODULES["tien"], "tools", ["payment.status", "order.approve", "shipment.track"], () => {
    assert.throws(() => C.assertModuleGraph(), /so dang ky noi cong cu do thuoc/);
  });
});

test("BAT DUOC: su kien phat ra ma khong ai nghe", () => {
  withPatched(C.MODULES["tien"], "listens", ["order.paid", "order.cancelled"], () => {
    assert.throws(() => C.assertModuleGraph(), /partner\.out_of_stock/);
  });
});

test("chuoi hoan tien khong bi dut o mat dau tien", () => {
  assert.ok(
    C.MODULES["tien"].listens.includes("partner.out_of_stock"),
    "Manh tien phai nghe partner.out_of_stock, neu khong chuoi hoan tien dut ngay."
  );
});

// ===========================================================================
// Luat 2 — bot khong duoc chi tien
// ===========================================================================

test("khong cong cu nao cua bot mang effect money", () => {
  for (const name of C.TOOL_NAMES) {
    if (C.TOOLS[name].audience !== "bot") continue;
    assert.notEqual(C.TOOLS[name].effect, "money", `Cong cu "${name}" tieu tien ma mo cho bot.`);
  }
  assert.doesNotThrow(() => C.assertToolsSafeForBot());
});

test("viec tieu tien VAN co cho khai — cho nguoi, khong cho bot", () => {
  assert.equal(C.TOOLS["order.approve"].effect, "money");
  assert.equal(C.TOOLS["order.approve"].audience, "human");
  assert.ok(!C.BOT_TOOL_NAMES.includes("order.approve"));
});

test("BAT DUOC: nguoi khai sai effect de lach cong", () => {
  // Them mot cong cu hoan tien nhung ghi la "read" — dung kieu lach ma cong cu
  // ban dau khong bat duoc, vi no chi tin loi tu khai.
  withPatched(C.TOOLS, "payment.refund",
    { name: "payment.refund", module: "tien", effect: "read", audience: "bot", describe: "gia dinh" },
    () => {
      assert.throws(() => C.assertToolsSafeForBot(), /dong tu tieu tien/);
    });
});

test("moi cong cu deu thuoc mot manh co that, hai chieu", () => {
  for (const name of C.TOOL_NAMES) {
    const owner = C.TOOLS[name].module;
    assert.ok(C.isModuleId(owner), `Cong cu "${name}" tro toi manh la.`);
    assert.ok(C.MODULES[owner].tools.includes(name), `Manh "${owner}" khong liet ke "${name}".`);
  }
});

// ===========================================================================
// Luat 3 — Xeon khong giu du lieu khach hay gia von
// ===========================================================================

test("muc luc sach thi qua cong", () => {
  assert.deepEqual(C.findCatalogIssues(monHangSach()), []);
  assert.doesNotThrow(() => C.assertCatalogClean([monHangSach(), monHangSach()]));
});

test("CHAN: so dien thoai nam trong o thuoc tinh tu do", () => {
  // Day la lo thung that: ban cu chi doc TEN khoa nen mau nay lot sach len Xeon.
  const item = monHangSach();
  item.attributes.note = "Chi Lan 0968411655, 12 Hoai Duc, Ha Noi";
  const issues = C.findCatalogIssues(item);
  assert.ok(issues.some((i) => i.kind === "phone_in_value"), JSON.stringify(issues));
  assert.throws(() => C.assertCatalogClean(item), /chua dat/);
});

test("CHAN: so dien thoai giau trong ten anh, va email", () => {
  const a = monHangSach();
  a.images = ["0968411655 - so nha 12 duong X.jpg"];
  assert.ok(C.findCatalogIssues(a).some((i) => i.kind === "phone_in_value"));

  const b = monHangSach();
  b.attributes.lienHe = "chi.lan@gmail.com";
  assert.ok(C.findCatalogIssues(b).some((i) => i.kind === "email_in_value"));
});

test("CHAN: truong la khong thuoc muc luc (gia von du dat ten kieu gi)", () => {
  for (const key of ["cost", "costPrice", "giaNhap", "saleFilePrice", "margin", "psid", "customerPhone"]) {
    const item = monHangSach();
    item[key] = 1;
    const issues = C.findCatalogIssues(item);
    assert.ok(
      issues.some((i) => i.kind === "unknown_key"),
      `Truong "${key}" phai bi chan vi khong thuoc muc luc.`
    );
  }
});

test("CHAN: chuoi JSON khong duoc coi la sach", () => {
  assert.throws(() => C.assertCatalogClean(JSON.stringify(monHangSach())), /chua dat/);
  assert.throws(() => C.assertCatalogClean(null), /chua dat/);
  assert.throws(() => C.assertCatalogClean(42), /chua dat/);
});

test("KHONG CHAN NHAM: nganh khac van dung duoc o thuoc tinh", () => {
  // Ban cu chan `hotel` vi regex /tel\b/, chan `awards`/`rewardPoints` vi /ward/,
  // chan ca tinh cua kho vi /province/. Nen tang da nganh ma nhu vay thi nguoi ta se noi cong.
  const item = monHangSach();
  item.attributes = {
    hotel: "Muong Thanh",
    khachSan: "co",
    soKhachToiDa: "4",
    province: "Lam Dong",
    awards: "Giai thuong 2025",
    rewardPoints: "120",
    streetStyle: "yes",
    customerRating: "4.8"
  };
  assert.deepEqual(C.findCatalogIssues(item), []);
});

// ===========================================================================
// Luat 4 — manh tat thi cong cu bien mat voi bot
// ===========================================================================

test("manh tat thi cong cu bien mat voi bot", () => {
  const toiThieu = C.enabledTools(licenseMau());
  assert.ok(toiThieu.includes("stock.lookup"));
  assert.ok(!toiThieu.includes("shipment.track"), "Chua mua manh Van chuyen ma bot van tra duoc van don.");

  const coVanChuyen = C.enabledTools(licenseMau({ modules: ["van-chuyen"] }));
  assert.ok(coVanChuyen.includes("shipment.track"));
});

test("giay phep het han thi bot khong con cong cu nao", () => {
  const het = licenseMau({ expiresAt: "2020-01-01T00:00:00.000Z", modules: ["van-chuyen", "tien"] });
  assert.equal(C.isExpired(het), true);
  assert.deepEqual(C.enabledTools(het), [], "Het han thue ma van du cong cu.");
});

test("cong cu cua NGUOI khong bao gio lot vao danh sach cua bot", () => {
  const day = C.enabledTools(licenseMau({ modules: ["tien"] }));
  assert.ok(day.includes("payment.status"));
  assert.ok(!day.includes("order.approve"));
});

test("id manh la trong giay phep bi neu ten, khong bi nuot im lang", () => {
  const issues = C.licenseIssues(licenseMau({ modules: ["vanchuyen"] }));
  assert.ok(issues.some((i) => i.kind === "unknown_module" && i.detail === "vanchuyen"));
});

test("giay phep cap o tuong lai va ngay hong deu bi neu", () => {
  assert.ok(C.licenseIssues(licenseMau({ issuedAt: "2999-01-01T00:00:00.000Z" }))
    .some((i) => i.kind === "not_yet_valid"));
  assert.ok(C.licenseIssues(licenseMau({ expiresAt: "khong-phai-ngay" }))
    .some((i) => i.kind === "bad_date"));
});

test("chu ky giay phep co quy uoc tuan tu hoa on dinh", () => {
  const a = licenseMau({ modules: ["tien", "van-chuyen"] });
  const b = { ...licenseMau({ modules: ["van-chuyen", "tien"] }), issuedAt: a.issuedAt, expiresAt: a.expiresAt };
  assert.equal(C.canonicalLicenseJSON(a), C.canonicalLicenseJSON(b),
    "Doi thu tu khai manh ma doi chu ky thi giay phep dung van bi coi la sai.");
});

// ===========================================================================
// Luat 5 — ban qua cu bi tu choi
// ===========================================================================

test("so sanh phien ban ban giao keo", () => {
  assert.equal(C.isCompatible("0.2.0", "0.1.0"), true);
  assert.equal(C.isCompatible("0.1.0", "0.1.0"), true);
  assert.equal(C.isCompatible("0.1.9", "0.2.0"), false);
  assert.equal(C.isCompatible("1.0.0", "0.9.9"), true);
  assert.equal(C.isCompatible("rac", "0.1.0"), false, "Sai dinh dang phai coi nhu KHONG dat.");
});

test("co duong de tu choi: khung reject ton tai va parse duoc", () => {
  const reject = {
    t: "reject", v: C.LINK_PROTOCOL_VERSION,
    error: C.linkError("version_too_old", "Ban OMI qua cu."),
    retryAfterSec: 0
  };
  const r = C.parseLinkFrame(reject);
  assert.equal(r.ok, true);
  assert.equal(r.frame.error.code, "version_too_old");
});

// ===========================================================================
// Bien mang
// ===========================================================================

test("parseLinkFrame khong tin khung thieu truong", () => {
  assert.equal(C.parseLinkFrame({ t: "call", v: "1" }).ok, false);
  assert.equal(C.parseLinkFrame({ t: "event", v: "1" }).ok, false);
  assert.equal(C.parseLinkFrame({ t: "khong-co-that", v: "1" }).ok, false);
  assert.equal(C.parseLinkFrame(null).ok, false);
  assert.equal(C.parseLinkFrame("call").ok, false);
  assert.equal(C.parseLinkFrame([]).ok, false);
});

test("parseLinkFrame tu choi khung sai phien ban giao thuc", () => {
  const r = C.parseLinkFrame({ t: "ping", v: "999", at: "now" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /giao thuc/);
});

test("khung goi day du thi qua, va mang du dau vet de ghi nhat ky", () => {
  const call = C.makeCall({
    id: "1", sessionId: "s1", tool: "stock.lookup", input: { code: "IE0000" },
    actor: C.BOT_ACTOR, conversationId: C.asConversationId("c1"), idempotencyKey: "k1"
  });
  assert.equal(C.parseLinkFrame(call).ok, true);
  assert.equal(call.actor, "bot");
  assert.equal(call.conversationId, "c1");
  assert.equal(call.timeoutMs, 8000);
});

// ===========================================================================
// Tien — mot goc duy nhat
// ===========================================================================

test("tien tren don di qua mot goc duy nhat", () => {
  const m = C.moneyOnOrder({ total: 3190000, paid: 1000000 });
  assert.deepEqual(m, { total: 3190000, paid: 1000000, remaining: 2190000, cod: 0 });

  assert.equal(C.moneyOnOrder({ total: 100, paid: 500 }).remaining, 0, "Con phai tra khong bao gio am.");
  assert.equal(C.moneyOnOrder({ total: 100, paid: 100 }).remaining, 0);
  assert.equal(C.isSettled(C.moneyOnOrder({ total: 100, paid: 100 })), true);

  const cod = C.moneyOnOrder({ total: 500000, paid: 100000, isCod: true });
  assert.equal(cod.cod, 400000);

  assert.equal(C.moneyOnOrder({ total: "rac" }).total, 0);
  assert.equal(C.moneyOnOrder({ total: 100.6 }).total, 101, "Tien luon la so nguyen.");
});

test("moi su kien trong EventMap deu co ten trong danh sach", () => {
  assert.equal(C.EVENT_NAMES.length, 9);
  assert.ok(C.isEventName("order.paid"));
  assert.ok(!C.isEventName("constructor"));
});

// ===========================================================================
// A5 — Ma kich hoat ky so (contract/ma-kich-hoat.ts)
// ===========================================================================

test("ma kich hoat: ky -> ma hoa -> giai ma ra dung giay phep; kiem chu ky dung/sai; sua payload la chu ky sai; khoang trang quanh ma duoc bo", () => {
  const k = C.sinhKhoaMay();
  const sl = C.kyGiayPhep(licenseMau({ machine: C.MAY_CHUA_GAN, modules: ["tien", "van-chuyen"] }), k.privateKeyPem, "ky-1", "lic-1");
  assert.equal(sl.keyId, "ky-1");
  assert.equal(sl.licenseId, "lic-1");
  assert.match(sl.signature, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(C.kiemChuKyGiayPhep(sl, k.publicKeyPem), true);
  assert.equal(C.kiemChuKyGiayPhep(sl, C.sinhKhoaMay().publicKeyPem), false, "Khoa khac ma chu ky van dung.");
  assert.equal(C.kiemChuKyGiayPhep({ ...sl, payload: { ...sl.payload, seats: 99 } }, k.publicKeyPem), false, "Sua payload ma chu ky van dung.");
  assert.equal(C.kiemChuKyGiayPhep({ ...sl, payload: { ...sl.payload, modules: ["van-chuyen", "tien"] } }, k.publicKeyPem), true,
    "Doi thu tu manh khong duoc lam chu ky sai (canonicalLicenseJSON sap xep).");
  assert.equal(C.kiemChuKyGiayPhep(sl, "rac"), false, "Khoa hong phai la SAI, khong nem.");

  const ma = C.maHoaMaKichHoat(sl);
  assert.match(ma, /^SPK1\.[A-Za-z0-9_-]+$/, "Ma phai la base64url (khong + / =) de dan qua email/chat khong bi vo.");
  const g = C.giaiMaMaKichHoat(ma);
  assert.equal(g.ok, true, g.reason);
  assert.deepEqual(g.license, sl);
  assert.equal(C.giaiMaMaKichHoat(`  \n${ma}\r\n `).ok, true, "Khach dan ma kem khoang trang / xuong dong.");
  // Sua MOT ky tu giua than ma: hoac khong giai duoc, hoac chu ky sai — khong bao gio "ok va dung".
  const than = ma.slice(5);
  const vi = Math.floor(than.length / 2);
  const kyTu = than[vi] === "A" ? "B" : "A";
  const hong = `SPK1.${than.slice(0, vi)}${kyTu}${than.slice(vi + 1)}`;
  const gh = C.giaiMaMaKichHoat(hong);
  assert.ok(!gh.ok || !C.kiemChuKyGiayPhep(gh.license, k.publicKeyPem), "Sua mot ky tu ma van qua ca giai ma lan chu ky.");
});

test("giai ma ma kich hoat: tu choi thieu tien to, tien to la, base64url hong, JSON khong phai doi tuong, thieu truong, modules khong phai mang chuoi, ma mang KHOA RIENG", () => {
  const b64 = (o) => `SPK1.${Buffer.from(JSON.stringify(o), "utf8").toString("base64url")}`;
  const k = C.sinhKhoaMay();
  const sl = C.kyGiayPhep(licenseMau({ machine: C.MAY_CHUA_GAN }), k.privateKeyPem, "ky-1", "lic-1");
  for (const [ma, vi] of [
    ["", "rong"], ["   ", "toan khoang trang"], ["abc", "khong tien to"], ["SPK2.abc", "tien to la"], ["SPK1.", "than rong"],
    ["SPK1.!!!", "base64url hong"], [b64([1]), "mang"], [b64("x"), "chuoi"], [b64(null), "null"],
    [b64({ payload: sl.payload, signature: sl.signature, keyId: "ky-1" }), "thieu licenseId"],
    [b64({ payload: { ...sl.payload, tenant: undefined }, signature: sl.signature, keyId: "ky-1", licenseId: "l" }), "payload thieu tenant"],
    [b64({ payload: { ...sl.payload, modules: "tien" }, signature: sl.signature, keyId: "ky-1", licenseId: "l" }), "modules la chuoi"],
    [b64({ payload: { ...sl.payload, modules: [1] }, signature: sl.signature, keyId: "ky-1", licenseId: "l" }), "modules mang so"],
    [b64({ payload: { ...sl.payload, seats: "3" }, signature: sl.signature, keyId: "ky-1", licenseId: "l" }), "seats la chuoi"],
    [b64({ payload: sl.payload, signature: 42, keyId: "ky-1", licenseId: "l" }), "signature khong phai chuoi"],
    [b64({ payload: sl.payload, signature: "", keyId: "ky-1", licenseId: "l" }), "signature rong"],
    [b64({ payload: sl.payload, signature: sl.signature, keyId: "ky-1", licenseId: "l", ghiChu: "-----BEGIN PRIVATE KEY-----" }), "ma mang khoa rieng"],
    [`SPK1.${Buffer.from("{ hong", "utf8").toString("base64url")}`, "JSON hong"]
  ]) {
    const g = C.giaiMaMaKichHoat(ma);
    assert.equal(g.ok, false, `Phai tu choi: ${vi}`);
    assert.equal(typeof g.reason, "string");
    assert.ok(g.reason.length > 0, vi);
  }
  assert.equal(C.giaiMaMaKichHoat(42).ok, false, "Khong phai chuoi phai bi tu choi, khong nem.");
});

test("chuoiDeKyKichHoat KHAC chuoiDeKy cua hello: proof kich hoat khong dung lam proof chao duoc va nguoc lai; keyIdCuaKhoaCong on dinh", () => {
  const a = C.chuoiDeKyKichHoat({ nonce: "n", licenseId: "l", machine: "m", contract: "c" });
  const b = C.chuoiDeKy({ nonce: "n", tenant: "l", machine: "m", contract: "c" });
  assert.notEqual(a, b);
  assert.ok(/kich-hoat/.test(a), "Chuoi ky kich hoat phai co nhan rieng.");
  // Tung truong phai co mat: doi mot truong la doi chuoi.
  for (const doi of [{ nonce: "n2" }, { licenseId: "l2" }, { machine: "m2" }, { contract: "c2" }]) {
    assert.notEqual(C.chuoiDeKyKichHoat({ nonce: "n", licenseId: "l", machine: "m", contract: "c", ...doi }), a, JSON.stringify(doi));
  }
  const g = C.chuoiDeKyGhim({ ghim: ["sha256/x"], reason: "r", seq: 1 });
  for (const doi of [{ ghim: ["sha256/y"] }, { reason: "r2" }, { seq: 2 }, { ghim: ["sha256/x", "sha256/y"] }]) {
    assert.notEqual(C.chuoiDeKyGhim({ ghim: ["sha256/x"], reason: "r", seq: 1, ...doi }), g, JSON.stringify(doi));
  }
  // JSON: `reason` mang dau phay / dau cham / xuong dong khong lam hai chuoi khac nhau trung nhau.
  assert.notEqual(C.chuoiDeKyGhim({ ghim: ["sha256/x"], reason: "a,b", seq: 1 }), C.chuoiDeKyGhim({ ghim: ["sha256/x", "b"], reason: "a", seq: 1 }));
  assert.notEqual(g, a);
  const k = C.sinhKhoaMay();
  assert.equal(C.keyIdCuaKhoaCong(k.publicKeyPem), C.keyIdCuaKhoaCong(k.publicKeyPem));
  assert.match(C.keyIdCuaKhoaCong(k.publicKeyPem), /^ky-[A-Za-z0-9_-]{16}$/);
  assert.notEqual(C.keyIdCuaKhoaCong(k.publicKeyPem), C.keyIdCuaKhoaCong(C.sinhKhoaMay().publicKeyPem));
  assert.throws(() => C.keyIdCuaKhoaCong("rac"));
});

// ===========================================================================
// A5 — Pheu dang ky bang luat (contract/pheu-dang-ky.ts)
// ===========================================================================

const traLoiMau = (over = {}) => ({
  banGi: "co-san", khoRieng: true, muaHo: false, congTacVien: false, giaoHang: "khach-tu-lay",
  thuTien: "cod", kenh: ["facebook"], noiDung: "khong", video: false, botTraLoi: false, baoCaoNhuCau: false,
  ...over
});
const idCua = (manh) => manh.map((m) => m.id);

test("pheu: cung cau tra loi -> cung bo manh (tat dinh); ba manh loi luon co; moi manh co vi sao co dau, nguon 'luat'; thu tu theo MODULE_IDS", () => {
  const a = C.pheuDangKy(traLoiMau());
  const b = C.pheuDangKy(traLoiMau());
  assert.deepEqual(a, b);
  for (const id of C.CORE_MODULE_IDS) assert.ok(idCua(a.manh).includes(id), `Thieu manh loi ${id}.`);
  assert.ok(idCua(a.manh).includes("hop-thu"), "Ban qua Facebook ma khong co Hop thu.");
  for (const m of a.manh) {
    assert.ok(C.isModuleId(m.id));
    assert.equal(m.nguon, "luat");
    assert.equal(typeof m.viSao, "string");
    assert.ok(m.viSao.length >= 10, `Vi sao qua ngan: ${m.id}`);
    assert.ok(/[àáảãạăâđèéêìíòóôơùúưýăđơư]/i.test(m.viSao), `Vi sao hien cho khach phai viet co dau: ${m.id}: ${m.viSao}`);
  }
  const thuTu = C.MODULE_IDS.filter((id) => idCua(a.manh).includes(id));
  assert.deepEqual(idCua(a.manh), thuTu, "Thu tu manh phai theo bang manh, khong theo thu tu luat.");
  assert.ok(Array.isArray(a.luuY));
  assert.equal(new Set(idCua(a.manh)).size, a.manh.length, "Mot manh xuat hien hai lan.");
});

test("pheu: tung luat mot — cau tra loi nao bat manh nao", () => {
  const BANG = [
    [{ giaoHang: "tu-gui" }, ["van-chuyen"], []],
    [{ giaoHang: "don-vi-van-chuyen" }, ["van-chuyen"], []],
    [{ giaoHang: "khach-tu-lay" }, [], ["van-chuyen"]],
    [{ thuTien: "truoc" }, ["tien"], []],
    [{ thuTien: "ca-hai" }, ["tien"], []],
    [{ thuTien: "cod" }, [], ["tien"]],
    [{ thuTien: "cod", muaHo: true }, ["tien", "mua-ho"], []],
    [{ banGi: "dat-ve" }, ["mua-ho"], []],
    [{ banGi: "ca-hai" }, ["mua-ho"], []],
    [{ banGi: "co-san", muaHo: false }, [], ["mua-ho"]],
    [{ kenh: ["web"] }, ["gian-hang"], ["hop-thu"]],
    [{ congTacVien: true }, ["gian-hang"], []],
    [{ kenh: ["facebook"], congTacVien: false }, [], ["gian-hang"]],
    [{ noiDung: "tu-lam" }, ["xuong-noi-dung"], ["goi-noi-dung"]],
    [{ noiDung: "thue" }, ["goi-noi-dung"], ["xuong-noi-dung"]],
    [{ noiDung: "khong" }, [], ["goi-noi-dung", "xuong-noi-dung"]],
    [{ video: true }, ["xuong-video"], []],
    [{ video: false }, [], ["xuong-video"]],
    [{ kenh: ["zalo"] }, ["hop-thu"], []],
    [{ kenh: ["tiktok"] }, ["hop-thu"], []],
    [{ kenh: ["san"] }, [], ["hop-thu", "gian-hang"]],
    [{ botTraLoi: true, kenh: ["facebook"] }, ["chatbot-cskh"], []],
    [{ botTraLoi: true, kenh: ["web"] }, [], ["chatbot-cskh"]],
    [{ botTraLoi: false, kenh: ["facebook"] }, [], ["chatbot-cskh"]],
    [{ baoCaoNhuCau: true, botTraLoi: true, kenh: ["zalo"] }, ["nhu-cau-cho"], []],
    [{ baoCaoNhuCau: true, botTraLoi: false, kenh: ["zalo"] }, [], ["nhu-cau-cho"]],
    [{ baoCaoNhuCau: false, botTraLoi: true, kenh: ["zalo"] }, [], ["nhu-cau-cho"]]
  ];
  for (const [over, co, khong] of BANG) {
    const ids = idCua(C.pheuDangKy(traLoiMau(over)).manh);
    for (const id of co) assert.ok(ids.includes(id), `${JSON.stringify(over)} phai bat ${id}; co: ${ids}`);
    for (const id of khong) assert.ok(!ids.includes(id), `${JSON.stringify(over)} khong duoc bat ${id}; co: ${ids}`);
  }
});

test("pheu: cau tra loi mau thuan sinh LUU Y (khong lang le): muon bot nhung khong co kenh chat; muon bao cao nhu cau nhung khong bat bot; ban tren san", () => {
  const a = C.pheuDangKy(traLoiMau({ botTraLoi: true, kenh: ["web"] }));
  assert.ok(a.luuY.some((l) => /bot/i.test(l) && /kênh/i.test(l)), JSON.stringify(a.luuY));
  const b = C.pheuDangKy(traLoiMau({ baoCaoNhuCau: true, botTraLoi: false }));
  assert.ok(b.luuY.some((l) => /nhu cầu/i.test(l)), JSON.stringify(b.luuY));
  const c = C.pheuDangKy(traLoiMau({ kenh: ["san"] }));
  assert.ok(c.luuY.some((l) => /sàn/i.test(l)), JSON.stringify(c.luuY));
  assert.deepEqual(C.pheuDangKy(traLoiMau()).luuY, [], "Cau tra loi binh thuong ma van co luu y.");
});

test("pheu: de nghi cua AI KHONG vao bo manh, chi nam o danh sach de nghi; id la / manh loi / manh da co / khong phai chuoi bi loai; nguoi chon them moi vao; manh loi khong bo duoc; chotManh ra danh sach manh MUA THEM hop le cho giay phep", () => {
  const kq = C.pheuDangKy(traLoiMau({ giaoHang: "tu-gui" }));
  const g = C.gopDeNghi(kq.manh, [
    { id: "xuong-video", viSao: "Anh kể có quay video sản phẩm." },
    { id: "khong-co", viSao: "bịa" },
    { id: "hang-kho", viSao: "lõi" },
    { id: "van-chuyen", viSao: "đã có" },
    { id: 42, viSao: "số" },
    { id: "tien", viSao: 7 }
  ]);
  assert.deepEqual(g.manh, kq.manh, "De nghi cua AI da chui vao bo manh.");
  assert.deepEqual(g.deNghi, [{ id: "xuong-video", viSao: "Anh kể có quay video sản phẩm.", nguon: "ai" }]);

  const chot = C.chotManh(kq.manh, { them: ["xuong-video"], bo: ["hang-kho", "van-chuyen", "hop-thu"] });
  assert.deepEqual(chot, ["xuong-video"], `Chot phai la manh MUA THEM: khong loi, bo van-chuyen va hop-thu, them xuong-video: ${chot}`);
  assert.deepEqual(C.chotManh(kq.manh, { them: [], bo: [] }), ["van-chuyen", "hop-thu"]);
  assert.throws(() => C.chotManh(kq.manh, { them: ["khong-co"], bo: [] }), /manh/i);
  assert.throws(() => C.chotManh(kq.manh, { them: [], bo: ["khong-co"] }), /manh/i);
  assert.deepEqual(C.licenseIssues(licenseMau({ modules: chot })).filter((i) => i.kind === "unknown_module"), []);
  // Chon them manh loi la vo nghia nhung khong phai loi; ket qua van khong mang loi.
  assert.deepEqual(C.chotManh(kq.manh, { them: ["don-khach"], bo: [] }), ["van-chuyen", "hop-thu"]);
  assert.ok(C.enabledModules(licenseMau({ modules: C.chotManh(kq.manh, { them: [], bo: ["hang-kho"] }) })).includes("hang-kho"),
    "Bo manh loi phai vo hieu.");
});

test("pheu: kiemCauTraLoi chi nhan dung hinh dang; truong la (van ban tu do) bi tu choi — luat khong doc van ban; CAU_HOI_PHEU 8-12 cau, khop mot-mot voi cau tra loi", () => {
  assert.equal(C.kiemCauTraLoi(traLoiMau()).ok, true);
  for (const [xau, vi] of [
    [traLoiMau({ banGi: "gi-cung-duoc" }), "banGi la"],
    [traLoiMau({ kenh: "facebook" }), "kenh khong phai mang"],
    [traLoiMau({ kenh: ["instagram"] }), "kenh la"],
    [traLoiMau({ kenh: [] }), "kenh rong"],
    [traLoiMau({ khoRieng: "co" }), "co/khong la chuoi"],
    [(() => { const t = traLoiMau(); delete t.video; return t; })(), "thieu cau"],
    [traLoiMau({ moTa: "tôi bán theo lô cho đại lý" }), "truong la: van ban tu do"],
    [null, "null"], ["x", "chuoi"], [[], "mang"]
  ]) {
    const k = C.kiemCauTraLoi(xau);
    assert.equal(k.ok, false, `Phai tu choi: ${vi}`);
    assert.ok(k.reason.length > 0);
  }
  assert.ok(C.CAU_HOI_PHEU.length >= 8 && C.CAU_HOI_PHEU.length <= 12, `Ban dac ta: 8-12 cau; dang co ${C.CAU_HOI_PHEU.length}.`);
  assert.deepEqual([...C.CAU_HOI_PHEU.map((c) => c.id)].sort(), Object.keys(traLoiMau()).sort());
  for (const c of C.CAU_HOI_PHEU) {
    assert.ok(/[àáảãạăâđèéêìíòóôơùúưý]/i.test(c.hoi), `Cau hoi hien cho khach phai co dau: ${c.id}`);
    assert.ok(["chon-mot", "co-khong", "chon-nhieu"].includes(c.kieu));
    if (c.kieu !== "co-khong") assert.ok(Array.isArray(c.luaChon) && c.luaChon.length >= 2, `Cau ${c.id} phai co lua chon.`);
  }
  // pheuDangKy tu kiem: cau tra loi sai hinh dang thi NEM, khong doan.
  assert.throws(() => C.pheuDangKy(traLoiMau({ banGi: "x" })), /banGi/);
});

// ===========================================================================
// A5 — Khung moi tren duong day: activate / activated / pins
// ===========================================================================

test("parseLinkFrame: activate/activated/pins — du truong thi qua; activate mang KHOA RIENG bi tu choi; pins rong / ghim sai dang bi tu choi; activated.ghim rong duoc, sai dang khong; activated.modules phai la mang chuoi", () => {
  const ghim = C.sinhChungChiTuKy({ ten: "a" }).ghim;
  const k = C.sinhKhoaMay();
  const activate = { t: "activate", v: C.LINK_PROTOCOL_VERSION, code: "SPK1.x", machine: "m1", publicKeyPem: k.publicKeyPem,
    contract: "0.3.0", omiVersion: "0.0.1", nonce: "n", proof: "p" };
  assert.equal(C.parseLinkFrame(activate).ok, true);
  assert.equal(C.parseLinkFrame({ ...activate, publicKeyPem: k.privateKeyPem }).ok, false, "Khung activate mang khoa rieng phai bi chan o bien mang.");
  assert.match(C.parseLinkFrame({ ...activate, publicKeyPem: k.privateKeyPem }).reason, /khoa rieng|PRIVATE/i);
  assert.equal(C.parseLinkFrame({ ...activate, publicKeyPem: "rac" }).ok, false);
  assert.equal(C.parseLinkFrame({ ...activate, code: "" }).ok, false);
  assert.equal(C.parseLinkFrame({ ...activate, proof: undefined }).ok, false);

  const activated = { t: "activated", v: C.LINK_PROTOCOL_VERSION, tenant: "t1", tenantName: "Shop", keyId: "k-1", packId: "giay-chay",
    modules: ["tien"], expiresAt: "2027-01-01T00:00:00.000Z", ghim: [ghim], khoaCongKy: k.publicKeyPem, ghimSeq: 1, issuedAt: "2026-09-11T00:00:00.000Z" };
  assert.equal(C.parseLinkFrame(activated).ok, true);
  assert.equal(C.parseLinkFrame({ ...activated, ghimSeq: -1 }).ok, false);
  assert.equal(C.parseLinkFrame({ ...activated, ghimSeq: "1" }).ok, false);
  assert.equal(C.parseLinkFrame({ ...activated, ghimSeq: undefined }).ok, false);
  assert.equal(C.parseLinkFrame({ ...activated, issuedAt: "hom qua" }).ok, false);
  assert.equal(C.parseLinkFrame({ ...activated, khoaCongKy: k.privateKeyPem }).ok, false, "activated mang KHOA RIENG ky cua Xeon.");
  assert.equal(C.parseLinkFrame({ ...activated, khoaCongKy: "rac" }).ok, false);
  assert.equal(C.parseLinkFrame({ ...activated, khoaCongKy: undefined }).ok, false);
  assert.equal(C.parseLinkFrame({ ...activated, ghim: [] }).ok, true, "Xeon TCP noi bo khong co ghim.");
  assert.equal(C.parseLinkFrame({ ...activated, ghim: ["sha256/rac"] }).ok, false);
  assert.equal(C.parseLinkFrame({ ...activated, ghim: ghim }).ok, false, "ghim phai la mang.");
  assert.equal(C.parseLinkFrame({ ...activated, modules: "tien" }).ok, false);
  assert.equal(C.parseLinkFrame({ ...activated, modules: [1] }).ok, false);
  assert.equal(C.parseLinkFrame({ ...activated, keyId: "" }).ok, false);

  const pins = { t: "pins", v: C.LINK_PROTOCOL_VERSION, ghim: [ghim], reason: "them du phong", seq: 2, issuedAt: "2026-09-11T00:00:00.000Z" };
  assert.equal(C.parseLinkFrame(pins).ok, true);
  assert.equal(C.parseLinkFrame({ ...pins, seq: 1.5 }).ok, false);
  assert.equal(C.parseLinkFrame({ ...pins, seq: -1 }).ok, false);
  assert.equal(C.parseLinkFrame({ ...pins, seq: undefined }).ok, false);
  assert.equal(C.parseLinkFrame({ ...pins, reason: { x: 1 } }).ok, false, "reason phai la chuoi.");
  assert.equal(C.parseLinkFrame({ ...pins, signature: "abc" }).ok, true);
  assert.equal(C.parseLinkFrame({ ...pins, signature: "" }).ok, false);
  assert.equal(C.parseLinkFrame({ ...pins, issuedAt: undefined }).ok, false);
  assert.equal(C.parseLinkFrame({ ...pins, issuedAt: "hom qua" }).ok, false);
  assert.equal(C.parseLinkFrame({ ...pins, ghim: [] }).ok, false, "pins rong = OMI khong tin ai nua.");
  assert.equal(C.parseLinkFrame({ ...pins, ghim: [ghim, "sha256/rac"] }).ok, false);
  assert.equal(C.parseLinkFrame({ ...pins, ghim: ghim }).ok, false);
  assert.equal(C.parseLinkFrame({ ...pins, ghim: [ghim, ghim] }).ok, false, "Ghim trung nhau la danh sach viet sai.");
});
