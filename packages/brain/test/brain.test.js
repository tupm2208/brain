// Bai kiem tra cho BO NAO.
//
// Toan bo chay bang CUA GIA: khong mang, khong may khach, khong goi mo hinh AI.
// Bo may la tat dinh nen kiem duoc tron ven — do la ly do chinh cua thiet ke nay.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const B = require("../dist/index.js");
const C = require("@sp/contract");

const TENANT = "t1";
const CONV = "c1";
const T0 = new Date("2026-09-09T09:00:00.000Z");

const BOSTON = { id: "i1", code: "IE0000", name: "Adizero Boston 13", brand: "adidas", priceFrom: 3190000, variantCount: 8 };
const PARA = { id: "i9", code: "PARA500", name: "Paracetamol", brand: "traphaco", priceFrom: 25000, variantCount: 2 };

const row = (label, qty, wh = "w1", whName = "Kho nha", price = 3190000) => ({
  itemId: "i1", variantId: `v-${label}-${wh}`, variantLabel: label,
  warehouseId: wh, warehouseName: whName, qty, price
});

function fakePorts(over = {}) {
  const calls = [];
  const store = new Map();
  const rows = over.rows ?? [row("42", 3)];
  let now = over.now ?? T0;

  return {
    calls,
    setNow(d) { now = d; },
    ports: {
      clock: { now: () => now },
      tools: {
        online: () => over.online !== false,
        available: () => over.available ?? ["stock.lookup", "policy.get", "order.lookup", "catalog.search", "purchase.eta", "storefront.link"],
        async call(tool, input) {
          calls.push({ tool, input });
          if (tool === "stock.lookup") {
            return over.stockFails === true
              ? { ok: false, tool, error: { code: "internal", message: "gia dinh" } }
              : { ok: true, tool, data: { rows, asOf: T0.toISOString(), truncated: over.truncated === true } };
          }
          if (tool === "policy.get") {
            return over.policy === undefined
              ? { ok: true, tool, data: { found: false, text: "", updatedAt: "" } }
              : { ok: true, tool, data: { found: true, text: over.policy, updatedAt: T0.toISOString() } };
          }
          if (tool === "order.lookup") {
            return over.orders === undefined
              ? { ok: true, tool, data: { orders: [] } }
              : { ok: true, tool, data: { orders: over.orders } };
          }
          if (tool === "purchase.eta") {
            return { ok: true, tool, data: { available: true, days: over.etaDays ?? 5 } };
          }
          return { ok: false, tool, error: { code: "not_found", message: "gia dinh" } };
        }
      },
      catalog: {
        async search(_tenant, query) {
          const items = over.items ?? [BOSTON];
          const q = B.normalize(query);
          // Xep hang nhu mot bo tim kiem that, de nguong nhan dien duoc thu suc.
          const loc = items.filter((it) => B.tokens(`${it.code} ${it.name}`).some((t) => q.includes(t)));
          // OMI that tra theo THU TU KHO (`ORDER BY id`), khong sap theo do phu — bo may
          // phai tu chiu. `giuThuTuKho` bat len de bai kiem tra khong de hon doi that.
          return over.giuThuTuKho === true
            ? loc
            : loc.sort((a, b) => B.coverage(q, `${b.code} ${b.name}`) - B.coverage(q, `${a.code} ${a.name}`));
        },
        async size() { return over.catalogSize ?? 1200; }
      },
      memory: {
        async load(_t, id) { return store.get(id) ?? null; },
        async save(s) { store.set(s.conversationId, s); }
      }
    }
  };
}

const ask = (ports, text, extra = {}, packId = "giay-chay") =>
  B.handleTurn(B.loadPack(packId), ports, { tenant: TENANT, conversationId: CONV, text, ...extra });

// ===========================================================================
// Bo luat nganh — va LOI HUA "doi nganh khong dung bo may"
// ===========================================================================

test("hai bo luat nganh co san deu hop le", () => {
  assert.doesNotThrow(() => B.selfCheckPacks());
  assert.deepEqual(B.validatePack(B.giayChayPack), []);
  assert.deepEqual(B.validatePack(B.nhaThuocPack), []);
});

test("LOI HUA: nganh khac chay tron ven tren cung bo may", async () => {
  // Nha thuoc khac giay chay o ba cho: HAI truc bien the, mot cong an toan rieng,
  // va toan bo tu dien / mau cau. Neu bai nay gay thi loi hua ban hang da thung.
  const f = fakePorts({
    items: [PARA],
    rows: [{ itemId: "i9", variantId: "vp", variantLabel: "500mg x 30 vien",
             warehouseId: "w1", warehouseName: "Quay 1", qty: 12, price: 25000 }]
  });
  const r = await ask(f.ports, "co paracetamol 500mg khong a", {}, "nha-thuoc");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.equal(r.itemCode, "PARA500");
  assert.equal(r.slots["hamluong"], "500mg");
  assert.match(r.reply, /Còn 12 hộp 500mg/);
});

test("LOI HUA: hai truc bien the cung doc duoc trong mot cau", () => {
  const axes = B.nhaThuocPack.itemShape.axes;
  assert.equal(axes.length, 2);
  assert.equal(B.extractAxis(axes[0], "hop paracetamol 500mg loai 30 vien"), "500mg");
  assert.equal(B.extractAxis(axes[1], "hop paracetamol 500mg loai 30 vien"), "30 vien");
});

test("LOI HUA: nganh khai duoc cong an toan rieng", async () => {
  const f = fakePorts({ items: [PARA] });
  const r = await ask(f.ports, "thuoc nay uong may vien mot ngay", {}, "nha-thuoc");
  assert.equal(r.action, "handoff", "Bot dang tu van lieu dung qua khung chat.");
  assert.match(r.reply, /dược sĩ/);
});

test("moi vi du bien the trong ho so deu dung", () => {
  for (const pack of [B.giayChayPack, B.nhaThuocPack]) {
    for (const axis of pack.itemShape.axes) {
      for (const ex of axis.examples) {
        assert.equal(B.extractAxis(axis, ex.text), ex.expect, `${pack.id}/${axis.id}: ${ex.text}`);
      }
    }
  }
});

test("moi vi du y dinh trong ho so deu ra dung y dinh do", () => {
  for (const pack of [B.giayChayPack, B.nhaThuocPack]) {
    for (const intent of pack.intents) {
      for (const ex of intent.examples ?? []) {
        assert.equal(B.detectIntent(pack, ex)?.id, intent.id, `${pack.id}: ${ex}`);
      }
    }
  }
});

test("cong soi bat duoc ho so hong", () => {
  const clone = () => JSON.parse(JSON.stringify(B.giayChayPack));

  const a = clone(); a.templates.handoff = "Nhan vien goi lai trong 5 phut nhe";
  assert.ok(B.validatePack(a).some((m) => /khong duoc chua con so/.test(m)));

  const b = clone(); b.intents[0].tools = ["shipment.track"];
  assert.ok(B.validatePack(b).some((m) => /khong nam trong danh sach cho phep/.test(m)));

  const c = clone(); c.gates = c.gates.filter((g) => g.kind !== "no_unsourced_numbers");
  assert.ok(B.validatePack(c).some((m) => /thieu cong bat buoc/.test(m)));

  const d = clone(); d.intents[0].requiredSlots = ["khung_gio"];
  assert.ok(B.validatePack(d).some((m) => /khong ton tai/.test(m)));

  const e = clone(); e.templates.in_stock = "Con {ton} doi {khunggio} a";
  assert.ok(B.validatePack(e).some((m) => /o thay the la/.test(m)));
});

// ===========================================================================
// Chuan hoa chu
// ===========================================================================

test("chuan hoa chay dung ca hai dang dau tieng Viet", () => {
  const nfc = "đôi này còn 42 không";
  assert.equal(B.normalize(nfc), B.normalize(nfc.normalize("NFD")));
  assert.equal(B.normalize(nfc), "doi nay con 42 khong");
  assert.equal(B.tight("NewBalance"), B.tight("new balance"));
});

test("dang giu dau tach duoc doi (dem giay) voi doi (doi tra)", () => {
  assert.notEqual(B.soft("còn 7 đôi size 42"), B.soft("cho đổi size"));
  assert.ok(!B.soft("còn 7 đôi size 42").includes("đổi"));
});

test("nhan ten hang khong dung chuoi con", () => {
  // Hang "On" dai hai chu cai: neu so kieu chuoi con thi "con hang khong" cung dinh.
  assert.equal(B.mentionsBrand("con hang khong shop", "on"), false);
  assert.equal(B.mentionsBrand("giay on cloudmonster", "on"), true);
  assert.equal(B.mentionsBrand("co newbalance khong", "new balance"), true);
});

test("do phu ten san pham khong phat nguoi noi dai", () => {
  const ngan = "adizero boston 13 con 42 khong";
  const dai = "cho em hoi doi adizero boston 13 nay con size 42 khong shop oi";
  const target = "IE0000 Adizero Boston 13";
  assert.ok(B.coverage(ngan, target) >= B.ITEM_MATCH_THRESHOLD);
  assert.ok(B.coverage(dai, target) >= B.ITEM_MATCH_THRESHOLD, "Cau dai lich su bi bo qua.");
});

// ===========================================================================
// Mot luot binh thuong
// ===========================================================================

test("nhan ra mon hang va tra ton that", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong shop");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.equal(r.itemCode, "IE0000");
  assert.equal(r.slots["size"], "42");
  assert.match(r.reply, /Còn 3 đôi size 42/);
  assert.ok(r.facts.length > 0);
});

test("cau dai lich su van nhan ra duoc mon hang", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "cho em hoi doi adizero boston 13 nay con size 42 khong shop oi");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.equal(r.itemCode, "IE0000");
});

test("het hang thi noi het, va cau do khong co con so", async () => {
  const f = fakePorts({ rows: [row("43", 5)] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send");
  assert.match(r.reply, /hết size/);
  assert.deepEqual(B.numbersIn(r.reply), []);
});

// ===========================================================================
// Ba loi nang agent phan bien tim ra
// ===========================================================================

test("S1: khach viet '41 ruoi', kho ghi '41.5' — phai gap duoc nhau", async () => {
  // Truoc day so khop chuoi tuyet doi nen bot noi "het size" trong khi kho con 7 doi.
  // Mot lan khop hut bi bien thanh mot loi khang dinh sai voi khach.
  const f = fakePorts({ rows: [row("41.5", 7)] });
  const r = await ask(f.ports, "adizero boston 13 con 41 ruoi khong");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /Còn 7 đôi/);
  assert.ok(!/hết/.test(r.reply), "Kho con 7 doi ma bot bao het.");
});

test("S1b: nhan kho dai hon van khop ('500mg' vs '500mg x 30 vien')", () => {
  const axis = B.nhaThuocPack.itemShape.axes[0];
  assert.equal(B.labelMatches(axis, "500mg", "500mg x 30 vien"), true);
  assert.equal(B.labelMatches(axis, "500 mg", "500mg x 30 vien"), true);
  assert.equal(B.labelMatches(axis, "250mg", "500mg x 30 vien"), false);
});

test("S2: hang nam o hai kho — tong cong don phai truy duoc nguon", async () => {
  const f = fakePorts({ rows: [row("42", 3, "w1", "Kho nha"), row("42", 4, "w2", "Kho doi tac")] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send", "Hai kho ma bot bo chay: " + JSON.stringify(r.gates));
  assert.match(r.reply, /Còn 7 đôi/);
});

test("S3: khach tra loi dung cau bot vua hoi thi phai duoc phuc vu", async () => {
  const f = fakePorts();
  const r1 = await ask(f.ports, "con size 42 khong shop");
  assert.equal(r1.action, "ask_back");

  f.setNow(new Date(T0.getTime() + 90_000));
  const r2 = await ask(f.ports, "adizero boston 13 nhe");
  assert.equal(r2.action, "send", "Khach vua tra loi dung ma bi day sang nguoi that.");
  assert.equal(r2.itemCode, "IE0000");
  assert.match(r2.reply, /Còn 3 đôi size 42/);
});

// ===========================================================================
// Cong an toan
// ===========================================================================

test("chua nhan ra mon hang thi hoi lai, khong doan", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "con size 42 khong shop");
  assert.equal(r.action, "ask_back");
  assert.match(r.reply, /xin mã hoặc tên mẫu/);
  assert.ok(!f.calls.some((c) => c.tool === "stock.lookup"));
});

test("hoi lai lan hai ma van thieu thi chuyen nguoi that", async () => {
  const f = fakePorts();
  await ask(f.ports, "con size 42 khong shop");
  f.setNow(new Date(T0.getTime() + 5 * 60_000));
  const r = await ask(f.ports, "co khong shop oi");
  assert.equal(r.action, "handoff");
  assert.ok(r.gates.some((g) => g.rule === "ask_back_once"));
});

test("da chuyen nguoi that thi khong tu nhay vao noi tiep", async () => {
  const f = fakePorts();
  await ask(f.ports, "con size 42 khong shop");
  f.setNow(new Date(T0.getTime() + 5 * 60_000));
  await ask(f.ports, "co khong shop oi");
  f.setNow(new Date(T0.getTime() + 40 * 60_000));
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "handoff", "Da giao nguoi that roi ma bot van tu tra loi tiep.");
});

test("mat ket noi may shop thi khong khang dinh so lieu", async () => {
  const f = fakePorts({ online: false });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send");
  assert.match(r.reply, /kiểm lại hàng/);
  assert.deepEqual(B.numbersIn(r.reply), []);
  assert.equal(f.calls.length, 0);
});

const gateInput = (over = {}) => ({
  pack: B.giayChayPack,
  state: { tenant: TENANT, conversationId: CONV, turns: [] },
  now: T0, draft: "", facts: [], intent: null,
  itemIdentified: true, wouldAskBack: false, online: true, catalogSize: 1200,
  claimsBrandNotCarried: false, hasPolicySource: false, echoedValues: [],
  ...over
});

test("CHAN: con so khong truy duoc ve nguon", () => {
  const g = B.runGates(gateInput({
    draft: "Dạ còn 5 đôi ạ",
    facts: [{ source: "stock.lookup", text: "con 3", numbers: [3] }]
  }));
  assert.equal(g.verdict.action, "block");
  assert.equal(g.verdict.rule, "no_unsourced_numbers");
});

test("CHAN: so luong viet bang chu", () => {
  const g = B.runGates(gateInput({ draft: "Dạ còn ba đôi ạ" }));
  assert.equal(g.verdict.action, "block");
  assert.match(g.verdict.reason, /viet bang chu/);

  const g2 = B.runGates(gateInput({ draft: "Dạ còn vài đôi cuối ạ" }));
  assert.equal(g2.verdict.action, "block");
});

test("KHONG CHAN NHAM: gia viet cho nguoi doc", () => {
  // "3,19 trieu" va "3190000" phai duoc coi la cung mot so, neu khong thi cau viet
  // de doc bi chan con cau viet tho lai lot — nghich ly khien nguoi ta di noi long cong.
  const g = B.runGates(gateInput({
    draft: "Giá 3,19 triệu ạ",
    facts: [{ source: "stock.lookup", text: "gia", numbers: [3190000] }]
  }));
  assert.equal(g.verdict.action, "send", g.verdict.reason);
});

test("KHONG CHAN: nhac lai chinh gia tri khach vua noi", () => {
  const g = B.runGates(gateInput({ draft: "Dạ size 42 ạ", echoedValues: ["42"] }));
  assert.equal(g.verdict.action, "send");
});

test("CHAN: khang dinh chinh sach ma khong co nguon, ke ca dien dat khac", () => {
  for (const draft of [
    "Bên em đổi trả trong vòng bảy ngày ạ",
    "Bác cứ đổi size thoải mái nhé",
    "Ship bên em bác không phải trả thêm đồng nào"
  ]) {
    const g = B.runGates(gateInput({ draft }));
    assert.equal(g.verdict.action, "block", draft);
  }
});

test("KHONG CHAN NHAM: cau ban hang binh thuong co chu 'doi'", () => {
  const g = B.runGates(gateInput({
    draft: "Còn 7 đôi size 42, giá 3190000 ạ",
    facts: [{ source: "stock.lookup", text: "x", numbers: [7, 3190000] }],
    echoedValues: ["42"]
  }));
  assert.equal(g.verdict.action, "send", g.verdict.reason);
});

test("CHAN: cau chua cum bi cam", () => {
  const g = B.runGates(gateInput({ draft: "Hàng này bảo hành trọn đời nhé bác" }));
  assert.equal(g.verdict.action, "block");
  assert.equal(g.verdict.rule, "forbidden_phrases");

  const g2 = B.runGates(gateInput({ draft: "Bên em rẻ nhất trên thị trường ạ" }));
  assert.equal(g2.verdict.action, "block");
});

test("chi dam noi khong kinh doanh hang X khi muc luc du lon", async () => {
  const to = fakePorts({ catalogSize: 1200, items: [] });
  const r1 = await ask(to.ports, "shop co ban salomon khong");
  assert.equal(r1.action, "send");
  assert.match(r1.reply, /chưa kinh doanh hàng salomon/);

  const nho = fakePorts({ catalogSize: 12, items: [] });
  const r2 = await ask(nho.ports, "shop co ban salomon khong");
  assert.equal(r2.action, "ask_back");
  assert.ok(r2.gates.some((g) => g.rule === "brand_not_carried_needs_catalog"));
});

test("khach so sanh voi hang khac thi van tra loi cau hoi that", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "so voi salomon thi adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /Còn 3 đôi/, "Bot bo roi cau hoi ton kho de di noi chuyen hang khac.");
});

// ===========================================================================
// Doc dung tieng Viet ban hang
// ===========================================================================

test("'doi' don vi dem giay khong bi doc thanh doi tra", () => {
  assert.notEqual(B.detectIntent(B.giayChayPack, "doi nay dep qua shop")?.id, "doi_tra");
  assert.equal(B.detectIntent(B.giayChayPack, "shop cho doi size khong a")?.id, "doi_tra");
});

test("so luong va don vi khac khong bi doc thanh size", () => {
  const axis = B.giayChayPack.itemShape.axes[0];
  for (const text of [
    "shop con 40 doi loai nay khong",
    "em can 50 doi lam qua",
    "em nang 50 kg cao 1m70 nen di size nao",
    "bao hanh 36 thang a",
    "gia 45k ship a"
  ]) {
    assert.equal(B.extractAxis(axis, text), null, text);
  }
});

test("go sai ten hang van nhan ra", () => {
  assert.match(B.applyAliases(B.giayChayPack, "co giay niubalan khong"), /new balance/);
  assert.match(B.applyAliases(B.giayChayPack, "mau bostom 13"), /boston/);
});

// ===========================================================================
// Tri nho
// ===========================================================================

test("nho mon hang trong cung phien, quen sau sau gio", async () => {
  const f = fakePorts();
  const r1 = await ask(f.ports, "adizero boston 13 gia bao nhieu");
  assert.equal(r1.itemCode, "IE0000");

  f.setNow(new Date(T0.getTime() + 20 * 60_000));
  const r2 = await ask(f.ports, "con size 42 khong");
  assert.equal(r2.itemCode, "IE0000");
  assert.equal(r2.action, "send", JSON.stringify(r2.gates));

  f.setNow(new Date(T0.getTime() + 7 * 3600_000));
  const r3 = await ask(f.ports, "con size 42 khong");
  assert.equal(r3.itemCode, null, "Sang phien khac ma van bam mon cu.");
  assert.equal(r3.action, "ask_back");
});

test("tin cut ngay sau cau hoi cua bot duoc doc nhu cau tra loi", async () => {
  const f = fakePorts();
  const r1 = await ask(f.ports, "adizero boston 13 con hang khong");
  assert.equal(r1.action, "ask_back", "Thieu size thi phai hoi size.");
  assert.equal(r1.state.lastAskedSlot, "size");

  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "42");
  assert.equal(r2.action, "send", "Tin cut '42' bi doc nhu mot cuoc hoi thoai moi.");
  assert.match(r2.reply, /Còn 3 đôi size 42/);
});

test("khach da gui anh thi hoi ten mau, khong xin anh nua", async () => {
  const co = fakePorts();
  const r1 = await co.ports.memory.load(TENANT, CONV);
  assert.equal(r1, null);
  const a = await ask(co.ports, "doi nay con 42 ko", { imageCount: 1 });
  assert.equal(a.action, "ask_back");
  assert.match(a.reply, /xem ảnh rồi/, "Khach vua gui anh ma bot van hoi chung chung.");

  // Cung cau do KHONG kem anh phai ra cau khac — neu giong het thi nhanh bang chung
  // anh la vo dung, dung nhu agent phan bien da chi ra o ban truoc.
  const khong = fakePorts();
  const b = await ask(khong.ports, "doi nay con 42 ko");
  assert.equal(b.action, "ask_back");
  assert.notEqual(b.reply, a.reply);
  assert.ok(!/xem ảnh rồi/.test(b.reply));
});

test("tra don: hoi so dien thoai, roi tra loi khi co so", async () => {
  const f = fakePorts({
    orders: [{ orderId: "MAN-1", status: "đang giao", createdAt: T0.toISOString(),
               money: { total: 3190000, paid: 3190000, remaining: 0, cod: 0 }, lines: [] }]
  });
  const r1 = await ask(f.ports, "don hang cua em toi dau roi");
  assert.equal(r1.action, "ask_back");
  assert.match(r1.reply, /số điện thoại/);

  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "0968411655");
  assert.equal(r2.action, "send", JSON.stringify(r2.gates));
  assert.match(r2.reply, /đang giao/);
});

test("moi ket luan cua cong deu ghi lai duoc de truy", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "con size 42 khong shop");
  assert.ok(Array.isArray(r.gates));
  assert.ok(r.gates.every((g) => typeof g.reason === "string" && g.reason.length > 0));
});

// Cac bai giet "dot bien song sot" — moi bai ung voi mot dong ma neu sua sai
// thi hanh vi hong ma truoc day khong bai nao bat duoc.
// (Duoc noi vao cuoi brain.test.js luc dung ban.)

test("nhan kho viet kieu khac van gap duoc cau khach go", async () => {
  const cases = [
    ["adizero boston 13 con 41 ruoi khong", "41.5", 7],
    ["adizero boston 13 con 41.5 khong", "41 ruoi", 7],
    ["adizero boston 13 con 42,5 khong", "42.5", 4],
    ["adizero boston 13 con size 42 khong", "EU 42", 9]
  ];
  for (const [hoi, nhanKho, ton] of cases) {
    const f = fakePorts({ rows: [row(nhanKho, ton)] });
    const r = await ask(f.ports, hoi);
    assert.equal(r.action, "send", `${hoi} / kho "${nhanKho}": ${JSON.stringify(r.gates)}`);
    assert.match(r.reply, new RegExp(`Còn ${ton} đôi`), `${hoi} / kho "${nhanKho}" -> ${r.reply}`);
  }
});

test("hoi size 42 ma kho chi co 42.5 thi phai bao het", async () => {
  const f = fakePorts({ rows: [row("42.5", 7)] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send");
  assert.match(r.reply, /hết/, "42.5 khong duoc coi la 42.");
});

test("nhan kho ghep cua nha thuoc doc duoc dung gia tri", () => {
  const axis = B.nhaThuocPack.itemShape.axes[0];
  for (const nhan of ["500mg x 30 vien", "500 mg x 30 vien", "500mg, hop 30 vien", "Hop 30 vien 500mg"]) {
    assert.equal(B.labelMatches(axis, "500mg", nhan), true, nhan);
  }
  assert.equal(B.labelMatches(axis, "250mg", "500mg x 30 vien"), false);
});

test("chua biet size ma kho co nhieu size thi KHONG duoc cong don roi gan nhan", async () => {
  // Loi nang nhat vong hai: bot noi "Con 5 doi size 42" trong khi size 42 con 0.
  // Moi con so deu co nguon nen khong cong nao bat duoc — phai chan o cho sinh cau.
  const f = fakePorts({ rows: [row("42", 0), row("43", 5)] });
  const r = await ask(f.ports, "adizero boston 13 gia bao nhieu");
  assert.notEqual(r.action, "send", `Bot vua khang dinh ton kho sai: ${r.reply}`);
  assert.ok(!/size 42/.test(r.reply));
});

test("nhieu muc gia thi bao khoang, khong bao gia mot kho", async () => {
  const f = fakePorts({
    rows: [row("42", 3, "w1", "Kho nha", 3190000), row("42", 4, "w2", "Kho doi tac", 3590000)]
  });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /Còn 7 đôi/);
  assert.match(r.reply, /3\.190\.000đ.*3\.590\.000đ/,
    `Bao gia mot kho trong khi hai kho khac gia: ${r.reply}`);
});

test("tien doc cho khach viet theo tap quan Viet Nam, khong phai day so tran", async () => {
  const f = fakePorts({ rows: [row("42", 3, "w1", "Kho nha", 3190000)] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.match(r.reply, /giá 3\.190\.000đ/, `Tien viet tho cho khach: ${r.reply}`);
  assert.ok(!/3190000/.test(r.reply), "Con day so tran trong cau gui khach.");
});

test("cong chong bia so DOC DUOC dang tien da dinh dang", () => {
  // Day la cho de vo nhat khi doi cach hien thi: `normalize` doi `đ` thanh `d`, ma sau
  // con so co chu cai thi cong lui lai mot nac — `"gia 3.190.000đ"` bi doc thanh 3190.
  // Con so 3190 do khong co trong dan chung nen bot bi CHINH CONG CUA NO chan lai,
  // va khach khong nhan duoc cau nao.
  assert.deepEqual(B.numbersIn("giá 3.190.000đ"), [3190000]);
  assert.deepEqual(B.numbersIn("giá 25.000₫"), [25000]);
  assert.deepEqual(B.numbersIn("giá 3.190.000 VNĐ"), [3190000]);
  assert.deepEqual(B.numbersIn("Còn 7 đôi size 42, giá 3.190.000đ ạ."), [7, 42, 3190000]);
  // Va khong lam hong nhung gi von dung.
  assert.deepEqual(B.numbersIn("500k"), [500000]);
  assert.deepEqual(B.numbersIn("con 3 kieu"), [3]);
});

test("cau bot noi va dan chung phai khop nhau SAU khi dinh dang", async () => {
  const f = fakePorts({ rows: [row("42", 3, "w1", "Kho nha", 3190000)] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  // Moi con so trong cau gui khach deu phai co trong dan chung. Doi cach viet ma quen
  // cong la bot tu chan chinh minh — va trieu chung la bot IM, khong phai bot noi sai.
  const nguon = new Set(r.facts.flatMap((x) => x.numbers));
  for (const n of B.numbersIn(r.reply)) {
    assert.ok(nguon.has(n), `So ${n} trong cau khong co trong dan chung: ${r.reply}`);
  }
});

test("vong lap: muc luc nho + hang khong kinh doanh phai chuyen nguoi that", async () => {
  // Truoc day duong nay khong qua y dinh nen cong ask_back_once khong bao gio bung:
  // bot hoi mai mot cau, khach hoi mai mot cau.
  const f = fakePorts({ catalogSize: 12, items: [] });
  const r1 = await ask(f.ports, "shop co ban salomon khong");
  assert.equal(r1.action, "ask_back");
  f.setNow(new Date(T0.getTime() + 3 * 60_000));
  const r2 = await ask(f.ports, "shop co ban salomon khong a");
  assert.equal(r2.action, "handoff", "Bot dang hoi vong quanh, khong bao gio goi nguoi that.");
});

test("tam diem cu khong duoc tra loi thay cho mon khach vua hoi", async () => {
  const f = fakePorts();
  const r1 = await ask(f.ports, "adizero boston 13 gia bao nhieu");
  assert.equal(r1.itemCode, "IE0000");

  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "con salomon speedcross size 42 khong");
  assert.notEqual(r2.itemCode, "IE0000", "Bot tra ton kho giay adidas cho cau hoi ve hang khac.");
  assert.ok(!/Còn 3 đôi/.test(r2.reply), r2.reply);
});

test("hai mau gan giong nhau thi khong duoc doan bua", async () => {
  const BOSTON12 = {
    id: "i2", code: "IE0001", name: "Adizero Boston 12", brand: "adidas",
    priceFrom: 2890000, variantCount: 8
  };
  const ro = fakePorts({ items: [BOSTON, BOSTON12] });
  const r1 = await ask(ro.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r1.itemCode, "IE0000", "Noi ro doi nao ma van khong chon duoc.");

  const mo = fakePorts({ items: [BOSTON, BOSTON12] });
  const r2 = await ask(mo.ports, "boston con size 42 khong");
  assert.equal(r2.action, "ask_back", "Hai doi Boston ma bot tu chon mot cai.");
});

test("cong cu loi thi noi that, khong hoi lai thu da biet", async () => {
  const f = fakePorts({ stockFails: true });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.itemCode, "IE0000");
  assert.match(r.reply, /chưa tra được kho/, `Da biet ma ma van di hoi ma: ${r.reply}`);
});

test("chinh sach lay duoc phai toi duoc khach", async () => {
  const f = fakePorts({ policy: "Đổi size trong 7 ngày, còn nguyên tem mác." });
  const r = await ask(f.ports, "shop cho doi size khong a");
  assert.equal(r.intentId, "doi_tra");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /Đổi size trong 7 ngày/);
});

test("mot cau bi chan KHONG lam bot cam ca phien", async () => {
  // Mau cau hong khien cau tra loi co con so khong nguon -> cong chan.
  const xau = JSON.parse(JSON.stringify(B.giayChayPack));
  xau.intents = xau.intents.map((i) => i.id === "hoi_gia" ? { ...i, template: "Giá 999999 ạ." } : i);
  const f = fakePorts();

  const r1 = await B.handleTurn(xau, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "adizero boston 13 gia bao nhieu"
  });
  assert.equal(r1.action, "handoff");
  assert.ok(r1.gates.some((g) => g.rule === "no_unsourced_numbers"));
  assert.notEqual(r1.state.handedOff, true, "Chan mot cau ma khoa luon ca phien.");

  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r2.action, "send", "Bot cam ca phien chi vi mot cau bi chan.");
});

test("phien moi xoa dau da chuyen nguoi that", async () => {
  const f = fakePorts();
  await ask(f.ports, "con size 42 khong shop");
  f.setNow(new Date(T0.getTime() + 5 * 60_000));
  const r2 = await ask(f.ports, "co khong shop oi");
  assert.equal(r2.action, "handoff");

  f.setNow(new Date(T0.getTime() + 8 * 3600_000));
  const r3 = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r3.action, "send", "Sang phien moi ma bot van cam.");
});

test("phien van con trong khoang nam gio", async () => {
  const f = fakePorts();
  await ask(f.ports, "adizero boston 13 gia bao nhieu");
  f.setNow(new Date(T0.getTime() + 5 * 3600_000));
  const r = await ask(f.ports, "con size 42 khong");
  assert.equal(r.itemCode, "IE0000", "Moi nam gio da quen mon dang hoi.");
});

// ---------------------------------------------------------------- cong so

test("don vi tien khong duoc dinh vao chu ke tiep", () => {
  assert.deepEqual(B.numbersIn("con 3 kieu"), [3]);
  assert.deepEqual(B.numbersIn("o 2 kho"), [2]);
  assert.deepEqual(B.numbersIn("4 khach dat roi"), [4]);
  assert.deepEqual(B.numbersIn("gia 45k"), [45000]);
  assert.deepEqual(B.numbersIn("gia 3,190,000"), [3190000]);
});

test("cach viet gia pho bien deu ra cung mot so", () => {
  for (const s of ["3190000", "3.190.000", "3,19 trieu"]) {
    assert.ok(B.numbersIn(s).includes(3190000), `${s} -> ${B.numbersIn(s)}`);
  }
  assert.ok(B.numbersIn("2tr5").includes(2500000));
  assert.ok(B.numbersIn("3 ty").includes(3000000000));
});

test("gio va ngay duoc doi chieu nguyen cum", () => {
  const g1 = B.runGates(gateInput({
    draft: "Dạ 14h30 còn chỗ ạ",
    facts: [{ source: "schedule", text: "khung 14h30 con cho", numbers: [] }]
  }));
  assert.equal(g1.verdict.action, "send", g1.verdict.reason);

  const g2 = B.runGates(gateInput({ draft: "Dạ 14h30 còn chỗ ạ" }));
  assert.equal(g2.verdict.action, "block", "Bot tu bia gio hen ma khong ai can.");
});

test("gioi tu sau khong bi doc thanh so sau", () => {
  for (const draft of [
    "Bác quay lại sau buổi đầu tiên nhé",
    "Sau ngày lễ shop mở lại ạ",
    "Em nhắn lại sau giờ làm việc ạ"
  ]) {
    const g = B.runGates(gateInput({ draft }));
    assert.equal(g.verdict.action, "send", `${draft} -> ${g.verdict.reason}`);
  }
  const g = B.runGates(gateInput({ draft: "Dạ còn sáu đôi ạ" }));
  assert.equal(g.verdict.action, "block");
});

test("cau bot viet KHONG dau van bi cac cong bat", () => {
  // Chu shop go mau cau khong dau la chuyen rat thuong. Cong khong duoc mu vi vay.
  const g1 = B.runGates(gateInput({ draft: "Ben em re nhat thi truong a" }));
  assert.equal(g1.verdict.action, "block", "Cum cam viet khong dau van phai bi chan.");

  const g2 = B.runGates(gateInput({ draft: "Ben em doi tra trong vong 7 ngay a" }));
  assert.equal(g2.verdict.action, "block", "Khang dinh chinh sach khong nguon, viet khong dau.");
});

test("cong soi tu choi ho so viet cum cam khong dau", () => {
  const xau = JSON.parse(JSON.stringify(B.giayChayPack));
  xau.identity.neverSay = ["bao hanh tron doi"];
  assert.ok(B.validatePack(xau).some((m) => /phai viet co dau/.test(m)));
});

test("cong soi tu choi ho so goi cong cu bo may chua biet chay", () => {
  const xau = JSON.parse(JSON.stringify(B.giayChayPack));
  xau.allowedTools.push("shipment.track");
  xau.intents[0].tools = ["shipment.track"];
  assert.ok(B.validatePack(xau).some((m) => /chua co cach chay no/.test(m)));
});

test("ma don muoi so khong bi doc thanh so dien thoai", async () => {
  const f = fakePorts({
    orders: [{
      orderId: "MAN-1", status: "đang giao", createdAt: T0.toISOString(),
      money: { total: 100, paid: 100, remaining: 0, cod: 0 }, lines: []
    }]
  });
  const r = await ask(f.ports, "don hang cua em ma 1234567890 toi dau roi");
  assert.equal(r.slots["phone"], undefined, "So khong bat dau bang 0 ma van bi coi la SDT.");
});

test("so khach tung go KHONG mac nhien duoc dung lam so ton kho", () => {
  // Neu cho phep MOI so khach tung go thi khach chi can hoi "shop con 500 doi khong"
  // la bot duoc phep khang dinh "con 500 doi". Ngoai le chi danh cho gia tri o
  // thong tin (size, ham luong) ma bot nhac lai.
  const g = B.runGates(gateInput({
    state: {
      tenant: TENANT, conversationId: CONV,
      turns: [{ role: "customer", text: "shop con 500 doi khong", at: T0.toISOString() }]
    },
    draft: "Dạ còn 500 đôi ạ",
    facts: [{ source: "stock.lookup", text: "con 3", numbers: [3] }],
    echoedValues: []
  }));
  assert.equal(g.verdict.action, "block", "So khach go ra dang duoc dung lam so ton kho.");
});

test("mau cau lo o thay the rong thi khong duoc gui", async () => {
  const pack = JSON.parse(JSON.stringify(B.giayChayPack));
  pack.intents = pack.intents.map((i) => i.id === "hoi_gia" ? { ...i, template: "Giá {songay} ạ." } : i);
  const f = fakePorts();
  const r = await B.handleTurn(pack, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "adizero boston 13 gia bao nhieu"
  });
  assert.equal(r.action, "handoff", `Cau thung van duoc gui: ${r.reply}`);
});

test("chi gia tri o thong tin moi duoc bot nhac lai, khong phai moi so khach go", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "shop con 500 doi adizero boston 13 size 42 khong");
  assert.ok(r.echoed.includes("42"), "Size khach noi phai duoc phep nhac lai.");
  assert.ok(
    !r.echoed.some((v) => B.numbersIn(v).includes(500)),
    "So 500 khach go trong cau hoi dang duoc cap phep lam so ton kho."
  );
});


// ===========================================================================
// Vong phan bien thu ba
// ===========================================================================

test("truc KHONG bat buoc khong duoc vo hieu cong cua truc bat buoc", async () => {
  // Nha thuoc: khach noi quy cach (khong bat buoc) nhung chua noi ham luong (bat buoc).
  // Truoc day co "da loc" bat len la bot cong don hai ham luong khac nhau lai.
  const f = fakePorts({
    items: [PARA],
    rows: [
      { itemId: "i9", variantId: "a", variantLabel: "500mg x 30 vien", warehouseId: "w1", warehouseName: "Quay 1", qty: 0, price: 25000 },
      { itemId: "i9", variantId: "b", variantLabel: "250mg x 30 vien", warehouseId: "w1", warehouseName: "Quay 1", qty: 7, price: 18000 }
    ]
  });
  const r = await ask(f.ports, "paracetamol hop 30 vien gia bao nhieu", {}, "nha-thuoc");
  assert.notEqual(r.action, "send", `Bot cong don hai ham luong: ${r.reply}`);
  assert.ok(!/Còn 7 hộp/.test(r.reply), r.reply);
});

test("o thay the do HO SO dat ten cung phai duoc canh", async () => {
  // "Con {ton} hop {hamluong}" ma hamluong rong thi cau thung — truoc day gui thang.
  const pack = JSON.parse(JSON.stringify(B.nhaThuocPack));
  pack.intents = pack.intents.map((i) =>
    i.id === "hoi_gia" ? { ...i, template: "Còn {ton} hộp {quycach} ạ." } : i);
  const f = fakePorts({
    items: [PARA],
    rows: [{ itemId: "i9", variantId: "a", variantLabel: "khong theo quy uoc", warehouseId: "w1", warehouseName: "Q1", qty: 5, price: 25000 }]
  });
  const r = await B.handleTurn(pack, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "paracetamol gia bao nhieu"
  });
  assert.notEqual(r.action, "send", `Cau thung van duoc gui: ${r.reply}`);
});

test("he 1/3 cua adidas khong bi coi la size tron", () => {
  const axis = B.giayChayPack.itemShape.axes[0];
  assert.equal(B.labelMatches(axis, "42", "42 2/3"), false, "42 2/3 bi coi la 42.");
  assert.equal(B.labelMatches(axis, "42 2/3", "42 2/3"), true);
  assert.equal(B.labelMatches(axis, "42", "42"), true);
});

test("hoi lai nhieu lan cach xa nhau van phai goi nguoi that", async () => {
  // Cua so 30 phut khong du: tren Fanpage khach tra loi cach nhau hang gio la thuong.
  const f = fakePorts();
  let t = T0.getTime();
  const acts = [];
  for (let i = 0; i < 4; i += 1) {
    f.setNow(new Date(t));
    acts.push((await ask(f.ports, "con size 42 khong shop")).action);
    t += 35 * 60_000;
  }
  assert.ok(acts.includes("handoff"), `Bot hoi mai khong bao gio goi nguoi: ${acts.join(", ")}`);
});

test("ket qua kho bi cat thi khong duoc khang dinh gi", async () => {
  const f = fakePorts({ truncated: true, rows: [row("43", 5)] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.match(r.reply, /chưa tra được kho/, `Khang dinh tren ket qua bi cat: ${r.reply}`);
  assert.ok(!/hết|Còn \d/.test(r.reply), "Bao het hoac bao con trong khi ket qua moi la mot phan.");
});

test("cong cu doi ItemId phai nhan ItemId, khong phai ma shop", async () => {
  const pack = JSON.parse(JSON.stringify(B.giayChayPack));
  pack.intents.push({
    id: "hoi_order", name: "Hoi hang order", keywords: ["order", "bao lau ve"],
    requiredSlots: ["item"], tools: ["purchase.eta"],
    template: "Hàng về trong {songay} ngày ạ.",
    askBackTemplate: "{khach} cho {shop} xin tên mẫu ạ."
  });
  const f = fakePorts({ etaDays: 7 });
  await B.handleTurn(pack, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "adizero boston 13 order bao lau ve"
  });
  const goi = f.calls.find((c) => c.tool === "purchase.eta");
  assert.ok(goi !== undefined, "Khong goi purchase.eta.");
  assert.equal(goi.input.itemId, "i1", "Dang truyen ma shop thay vi ma noi bo.");
});

test("QUYET DINH 3: so dien thoai khach KHONG duoc luu tren Xeon", async () => {
  const f = fakePorts({
    orders: [{ orderId: "MAN-1", status: "đang giao", createdAt: T0.toISOString(),
               money: { total: 100, paid: 100, remaining: 0, cod: 0 }, lines: [] }]
  });
  await ask(f.ports, "don hang cua em toi dau roi");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "0968411655");
  assert.equal(r.action, "send", JSON.stringify(r.gates));

  const luu = JSON.stringify(r.state);
  assert.ok(!luu.includes("0968411655"), "So dien thoai khach da bi ghi xuong Xeon.");
  assert.equal(r.state.focusSlots.phone, undefined);
  assert.doesNotThrow(() => B.assertNoStoredPII([
    ...r.state.turns.map((t) => t.text), ...Object.values(r.state.focusSlots)
  ]));
});

test("manh tat thi bo may KHONG duoc goi cong cu do", async () => {
  // Luat nay da co o ban giao keo, nhung bo may cung phai ton trong —
  // truoc day khong bai nao kiem o day.
  const f = fakePorts({ available: ["catalog.search"] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.ok(!f.calls.some((c) => c.tool === "stock.lookup"), "Goi cong cu cua manh chua bat.");
  assert.notEqual(r.action, "send", `Van tra loi ton kho du khong duoc phep: ${r.reply}`);
});

test("cong chan thi cau bi chan KHONG duoc gui di", async () => {
  // Bon nhanh gan lai `reply` sau khi cong phan deu tung xoa duoc ma bai van xanh.
  const xau = JSON.parse(JSON.stringify(B.giayChayPack));
  xau.intents = xau.intents.map((i) =>
    i.id === "hoi_gia" ? { ...i, template: "Giá {gia} ạ. Bên em bảo hành trọn đời ạ." } : i);
  const f = fakePorts();
  const r = await B.handleTurn(xau, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "adizero boston 13 gia bao nhieu"
  });
  assert.equal(r.action, "handoff");
  assert.ok(!/bảo hành trọn đời/.test(r.reply), `Cau bi cam van den tay khach: ${r.reply}`);
  assert.match(r.reply, /nhờ nhân viên/);
});

test("y dinh luon-chuyen-nguoi phai khoa ca phien", async () => {
  const f = fakePorts({ items: [PARA] });
  const r1 = await ask(f.ports, "thuoc nay uong may vien mot ngay", {}, "nha-thuoc");
  assert.equal(r1.action, "handoff");
  assert.equal(r1.state.handedOff, true);

  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "co paracetamol 500mg khong a", {}, "nha-thuoc");
  assert.equal(r2.action, "handoff", "Bot nhay vao noi tiep sau khi da giao duoc si.");
});

test("doi mon thi bo gia tri truc cua mon cu", async () => {
  const HOKA = { id: "i3", code: "HK0008", name: "Hoka Bondi 8", brand: "hoka", priceFrom: 4290000, variantCount: 6 };
  const f = fakePorts({
    items: [BOSTON, HOKA],
    rows: [row("42", 3), row("43", 6)]
  });
  const r1 = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r1.slots["size"], "42");

  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "hoka bondi 8 con hang khong");
  assert.equal(r2.itemCode, "HK0008");
  assert.notEqual(r2.slots["size"], "42", "Size cua doi truoc dinh sang mon moi.");
});

test("nguong nhan dien mon co hieu luc", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "cho em hoi con 42 khong shop");
  assert.equal(r.itemCode, null, "Khong noi ten mau ma van chot mot mon.");
  assert.equal(r.action, "ask_back");
});

test("cau tiep noi khong lam mat tam diem", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r1 = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r1.itemCode, "IE0000");

  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "doi nay con 43 khong a");
  assert.equal(r2.itemCode, "IE0000", "Cau tiep noi pho bien nhat lam bot quen mon dang hoi.");
  assert.equal(r2.action, "send", JSON.stringify(r2.gates));
  assert.match(r2.reply, /Còn 6 đôi/);
});

test("nguong muc luc cho cau 'khong kinh doanh' lay tu HO SO", async () => {
  // Nha thuoc khai 100, khong phai 200 chon cung trong bo may.
  const f = fakePorts({ items: [], catalogSize: 150 });
  const r = await ask(f.ports, "co thuoc bayer khong a", {}, "nha-thuoc");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /không có hàng bayer/);
});


// ===========================================================================
// Vong phan bien thu tu
// ===========================================================================

test("che so dien thoai du khach viet kieu gi", () => {
  const kieu = [
    "0968411655", "0968.411.655", "0968 411 655", "0968-411-655",
    "0968_411_655", "0968/411/655", "0968,411,655", "(0968) 411 655",
    "0968*411*655", "0968|411|655", "0968 - 411 - 655", "0968 . 411 . 655",
    "+84968411655", "84968411655", "0084968411655", "O968411655"
  ];
  for (const s of kieu) {
    const che = B.redactPII(`don cua em ${s} nhe`);
    assert.ok(!/\d{6}/.test(che), `Chua che duoc "${s}" -> ${che}`);
  }
  assert.match(B.redactPII("mail em la a.b@gmail.com"), /\[da che\]/);
  assert.ok(B.findPIIInText("so em 0968411655").length > 0);
  assert.ok(B.findPIIInText("mail a.b@gmail.com").length > 0);
});

test("cong chan du lieu ca nhan co NEM that", () => {
  assert.throws(() => B.assertNoStoredPII(["so em la 0968411655"]), /du lieu ca nhan/);
  assert.throws(() => B.assertNoStoredPII(["mail a.b@gmail.com"]), /du lieu ca nhan/);
  assert.doesNotThrow(() => B.assertNoStoredPII(["con size 42 khong"]));
});

test("bo DO va bo CHE la hai mau khac nhau", () => {
  // Dung chung mot mau thi thu gi ben che bo sot, ben do cung bo sot y het —
  // cong chan tro thanh cai chot khong bao gio no duoc.
  assert.notEqual(B.redactPII.toString(), B.findPIIInText.toString());
  // Bo che rong tay hon: kieu "0968*411*655" phai duoc che.
  assert.ok(!/\d{6}/.test(B.redactPII("lien he 0968*411*655")));
});

test("KHONG che nham ma don, ma hang, danh sach size, gia tien", () => {
  const giuNguyen = [
    "Con size 40, 41, 42, 43, 44, 45 a",
    "Ma hang 8935001234567 a",
    "Don DH20250909001 dang giao a",
    "Gia 3190000 a",
    "Gia 3.190.000 a",
    "Ngay 09/09/2026 a",
    "Alo bac oi, don da giao a",
    "Ben em co zalo nhe"
  ];
  for (const cau of giuNguyen) {
    assert.equal(B.redactPII(cau), cau, `Che nham: ${cau} -> ${B.redactPII(cau)}`);
  }
});

test("ma hoi thoai Messenger dang so KHONG lam chet luot", async () => {
  // PSID cua Messenger la 16 chu so — day chinh la thu buoc noi kenh that se cam vao.
  const f = fakePorts();
  const r = await B.handleTurn(B.loadPack("giay-chay"), f.ports, {
    tenant: "84001234567",
    conversationId: "2418071638332614",
    text: "adizero boston 13 con size 42 khong"
  });
  assert.equal(r.action, "send", JSON.stringify(r.gates));
});

test("ma hang EAN-13 KHONG bi coi la du lieu ca nhan", async () => {
  const EAN = { id: "i7", code: "8934841100018", name: "Paracetamol", brand: "traphaco", priceFrom: 25000, variantCount: 1 };
  const f = fakePorts({
    items: [EAN],
    rows: [{ itemId: "i7", variantId: "a", variantLabel: "500mg", warehouseId: "w1", warehouseName: "Q1", qty: 4, price: 25000 }]
  });
  const r = await ask(f.ports, "co paracetamol 500mg khong a", {}, "nha-thuoc");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.equal(r.state.focusItemCode, "8934841100018");
});

test("noi dung tin cua khach KHONG duoc luu tren Xeon", async () => {
  const f = fakePorts();
  const r = await ask(f.ports, "em ten Nguyen Van A, giao ve 123 Nguyen Trai Thanh Xuan, adizero boston 13 con size 42 khong");
  const luuKhach = r.state.turns.filter((t) => t.role === "customer");
  assert.ok(luuKhach.length > 0);
  for (const t of luuKhach) {
    assert.equal(t.text, "", "Noi dung tin cua khach van duoc ghi xuong Xeon.");
  }
  // Dia chi va ten khong che duoc bang mau — nen cach duy nhat chac chan la khong luu.
  assert.ok(!JSON.stringify(r.state).includes("Nguyen Trai"));
});

test("cong an toan RIENG cua nganh chan that, khong nho nhanh handoff", async () => {
  // Bai cu di qua `intent.handoff` nen chan truoc khi toi cong — cong chua tung
  // duoc kiem hanh vi chan cua chinh no.
  const pack = JSON.parse(JSON.stringify(B.nhaThuocPack));
  pack.intents = pack.intents.map((i) =>
    i.id === "hoi_gia" ? { ...i, template: "Ngày uống 2 viên ạ." } : i);
  const f = fakePorts({
    items: [PARA],
    rows: [{ itemId: "i9", variantId: "a", variantLabel: "500mg", warehouseId: "w1", warehouseName: "Q1", qty: 2, price: 2 }]
  });
  const r = await B.handleTurn(pack, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "paracetamol gia bao nhieu"
  });
  assert.ok(
    r.gates.some((g) => g.rule === "forbidden_patterns"),
    `Cong rieng cua nganh khong chan: ${JSON.stringify(r.gates)}`
  );
  assert.ok(!/uống 2 viên/.test(r.reply), `Tu van lieu dung den tay khach: ${r.reply}`);
});

test("cong soi bat duoc mau cau khong dau KE CA khi co o thay the", () => {
  const xau = JSON.parse(JSON.stringify(B.giayChayPack));
  xau.templates.in_stock = "Con {ton} doi size {size}, gia {gia} a.";
  const loi = B.validatePack(xau);
  assert.ok(loi.some((m) => /viet khong dau/.test(m)), JSON.stringify(loi));
});

test("hai mau diem ngang nhau thi khong duoc chon bua", async () => {
  const B12 = { id: "i2", code: "IE0001", name: "Adizero Boston 12", brand: "adidas", priceFrom: 2590000, variantCount: 8 };
  const f = fakePorts({ items: [BOSTON, B12] });
  const r = await ask(f.ports, "adizero boston con size 42 khong");
  assert.equal(r.itemCode, null, "Hai doi Boston diem ngang nhau ma bot van chot mot cai.");
  assert.equal(r.action, "ask_back");
});

test("cau ton kho lo o thay the rong thi khong duoc gui", async () => {
  const pack = JSON.parse(JSON.stringify(B.nhaThuocPack));
  pack.templates.in_stock = "Còn {ton} hộp {quycach} ạ.";
  const f = fakePorts({
    items: [PARA],
    rows: [{ itemId: "i9", variantId: "a", variantLabel: "500mg", warehouseId: "w1", warehouseName: "Q1", qty: 5, price: 25000 }]
  });
  const r = await B.handleTurn(pack, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "co paracetamol 500mg khong a"
  });
  assert.notEqual(r.action, "send", `Cau thung van duoc gui: ${r.reply}`);
});


// ===========================================================================
// Vong phan bien thu nam
// ===========================================================================

test("bo soi ho so soi CA mau cau nam trong y dinh", () => {
  const clone = () => JSON.parse(JSON.stringify(B.nhaThuocPack));

  // Khong dau: day la duong tat sach cong an toan rieng cua nganh.
  const a = clone();
  a.intents = a.intents.map((i) => i.id === "hoi_gia"
    ? { ...i, template: "Lieu dung cua thuoc nay ghi tren vo hop a, {khach} uong theo do a." } : i);
  assert.ok(B.validatePack(a).some((m) => /viet khong dau/.test(m)), JSON.stringify(B.validatePack(a)));

  // Cum bi cam nam ngay trong mau cau cua chinh ho so.
  const b = clone();
  b.intents = b.intents.map((i) => i.id === "hoi_gia"
    ? { ...i, template: "Giá {gia} ạ, thuốc này chữa khỏi hoàn toàn ạ." } : i);
  assert.ok(B.validatePack(b).some((m) => /cum bi cam/.test(m)));

  // So chot cung: se lot cong "khong bia so" moi khi tinh co trung mot so trong kho.
  const c = clone();
  c.intents = c.intents.map((i) => i.id === "hoi_gia"
    ? { ...i, template: "Giá {gia} ạ, bên nhà thuốc có 3 chi nhánh ạ." } : i);
  assert.ok(B.validatePack(c).some((m) => /so viet cung/.test(m)));

  // O thay the la trong mau cau cua y dinh.
  const d = clone();
  d.intents = d.intents.map((i) => i.id === "hoi_gia"
    ? { ...i, template: "Giá {khongtontai} ạ." } : i);
  assert.ok(B.validatePack(d).some((m) => /o thay the la/.test(m)));
});

test("cum bi cam trong CAU HOI LAI khong duoc den tay khach", async () => {
  // Cau hoi lai duoc dung SAU khi cong da phan, nen truoc day no khong qua cong nao.
  const xau = JSON.parse(JSON.stringify(B.giayChayPack));
  xau.templates.ask_item = "{khach} cho {shop} xin mã mẫu ạ, bên em bảo hành trọn đời ạ.";
  const f = fakePorts();
  const r = await B.handleTurn(xau, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "con size 42 khong shop"
  });
  assert.ok(!/bảo hành trọn đời/.test(r.reply), `Cum bi cam den tay khach: ${r.reply}`);
});

test("cum bi cam trong CAU CHUYEN NGUOI THAT khong duoc den tay khach", async () => {
  const xau = JSON.parse(JSON.stringify(B.nhaThuocPack));
  xau.templates.handoff = "{shop} chuyển dược sĩ ạ, thuốc này chữa khỏi hoàn toàn ạ.";
  const f = fakePorts({ items: [PARA] });
  const r = await B.handleTurn(xau, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "thuoc nay uong may vien mot ngay"
  });
  assert.equal(r.action, "handoff");
  assert.ok(!/chữa khỏi hoàn toàn/.test(r.reply), `Cum bi cam den tay khach: ${r.reply}`);
});

test("cau hoi lai lo o thay the rong thi khong duoc gui", async () => {
  const xau = JSON.parse(JSON.stringify(B.giayChayPack));
  xau.templates.ask_item = "{khach} cho {shop} xin mã mẫu, bên em còn {ton} đôi ạ.";
  const f = fakePorts();
  const r = await B.handleTurn(xau, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "con size 42 khong shop"
  });
  assert.notEqual(r.action, "ask_back", `Cau thung van duoc gui: ${r.reply}`);
});

test("dau cau chen giua khong lam cum bi cam thoat", () => {
  for (const draft of [
    "Giá tốt ạ, rẻ nhất - thị trường luôn ạ.",
    "Bên em bảo hành... trọn đời ạ.",
    "Rẻ nhất, thị trường luôn ạ."
  ]) {
    const g = B.runGates(gateInput({ draft }));
    assert.equal(g.verdict.action, "block", `${draft} -> ${g.verdict.reason}`);
  }
});

test("ma san pham co chu so khong bi coi la so bia", async () => {
  const pack = JSON.parse(JSON.stringify(B.giayChayPack));
  pack.intents = pack.intents.map((i) => i.id === "hoi_gia"
    ? { ...i, template: "Mẫu {mon} giá {gia} ạ." } : i);
  const f = fakePorts({ rows: [row("42", 3)] });
  const r = await B.handleTurn(pack, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "adizero boston 13 gia bao nhieu"
  });
  assert.equal(r.action, "send", `Ma san pham bi coi la so bia: ${JSON.stringify(r.gates)}`);
  assert.match(r.reply, /IE0000/);
});

test("tra loi duoc mot luot thi bo dem hoi lai ve khong", async () => {
  const f = fakePorts();
  const r1 = await ask(f.ports, "con size 42 khong shop");
  assert.equal(r1.action, "ask_back");
  assert.equal(r1.state.askBackCount, 1);

  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "adizero boston 13 nhe");
  assert.equal(r2.action, "send");
  assert.equal(r2.state.askBackCount, 0, "Bo dem khong duoc dat lai sau khi tra loi duoc.");

  // Va lan hoi lai tiep theo van la hoi lai, khong bi khoa phien oan.
  f.setNow(new Date(T0.getTime() + 2 * 3600_000));
  const r3 = await ask(f.ports, "the con mau khac thi sao");
  assert.notEqual(r3.action, "handoff", "Khoa phien du khach da tra loi day du truoc do.");
});


// ===========================================================================
// Vong phan bien thu sau — nhom "nen va som"
// ===========================================================================

test("tri nho khoa nham thi KHONG duoc tra loi nham nha ban hang", async () => {
  // Cua gia o day co tinh khoa theo MOT MINH ma hoi thoai — dung cai sai ma
  // lop du lieu that o buoc 3 rat de chep lai.
  const store = new Map();
  const chung = {
    clock: { now: () => T0 },
    tools: {
      online: () => true,
      available: () => ["stock.lookup"],
      async call(tool) {
        return tool === "stock.lookup"
          ? { ok: true, tool, data: { rows: [row("42", 3)], asOf: T0.toISOString(), truncated: false } }
          : { ok: false, tool, error: { code: "not_found", message: "x" } };
      }
    },
    catalog: {
      async search(_t, q) {
        return B.tokens("IE0000 Adizero Boston 13").some((x) => B.normalize(q).includes(x)) ? [BOSTON] : [];
      },
      async size() { return 1200; }
    },
    memory: {
      async load(_tenant, id) { return store.get(id) ?? null; },
      async save(s) { store.set(s.conversationId, s); }
    }
  };
  const pack = B.loadPack("giay-chay");
  await B.handleTurn(pack, chung, { tenant: "shopA", conversationId: "c9", text: "adizero boston 13 con size 42 khong" });
  const r = await B.handleTurn(pack, chung, { tenant: "shopB", conversationId: "c9", text: "con hang khong" });
  assert.notEqual(r.action, "send", `Shop B nhan cau tra loi cua shop A: ${r.reply}`);
  assert.equal(r.itemCode, null, "Tam diem cua shop A dinh sang shop B.");
});

test("lap loi chao mai thi phai goi nguoi that", async () => {
  const f = fakePorts();
  const acts = [];
  for (let i = 0; i < 4; i += 1) {
    f.setNow(new Date(T0.getTime() + i * 60_000));
    acts.push((await ask(f.ports, ["alo", "ok", "co ai khong", "the a"][i])).action);
  }
  assert.ok(acts.includes("handoff"), `Bot lap loi chao vo han: ${acts.join(", ")}`);
});

test("van ban do SHOP viet cung phai qua cong rieng cua nganh", async () => {
  // Bo soi ep duoc MAU CAU cua ho so viet co dau, nhung khong ep duoc chu shop
  // tu go trong bang chinh sach — ma chu do cam thang vao cau gui khach.
  const f = fakePorts({
    items: [PARA],
    policy: "Thuoc nay uong 2 vien moi ngay, ngay 3 lan a."
  });
  const pack = JSON.parse(JSON.stringify(B.nhaThuocPack));
  pack.intents.push({
    id: "hoi_chinh_sach", name: "Hoi chinh sach", keywords: ["doi tra", "chinh sach"],
    requiredSlots: ["topic"], tools: ["policy.get"],
    template: "{chinhsach}", askBackTemplate: "{khach} cho {shop} biết cụ thể hơn ạ."
  });
  const r = await B.handleTurn(pack, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "chinh sach doi tra the nao"
  });
  assert.ok(!/uong 2 vien/.test(r.reply), `Tu van lieu dung tu bang chinh sach den tay khach: ${r.reply}`);
});

test("so nam trong trang thai don duoc coi la co nguon", async () => {
  const f = fakePorts({
    orders: [{ orderId: "MAN-7", status: "còn 2 ngày nữa tới", createdAt: T0.toISOString(),
               money: { total: 100, paid: 100, remaining: 0, cod: 0 }, lines: [] }]
  });
  await ask(f.ports, "don hang cua em toi dau roi");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "0968411655");
  assert.equal(r.action, "send", `Trang thai don co so bi coi la bia: ${JSON.stringify(r.gates)}`);
  assert.match(r.reply, /còn 2 ngày nữa tới/);
});

test("o rieng cua ho so phai co duong dien gia tri", () => {
  const co = JSON.parse(JSON.stringify(B.giayChayPack));
  co.extraValues = { camket: "hàng có sẵn tại kho" };
  co.templates.in_stock = "Còn {ton} đôi {truc} {size}, giá {gia} ạ, {camket} ạ.";
  assert.deepEqual(B.validatePack(co), []);

  const khong = JSON.parse(JSON.stringify(B.giayChayPack));
  khong.templates.in_stock = "Còn {ton} đôi {truc} {size}, giá {gia} ạ, {camket} ạ.";
  assert.ok(B.validatePack(khong).some((m) => /o thay the la/.test(m)));
});

test("o rieng cua ho so hien dung gia tri trong cau tra loi", async () => {
  const pack = JSON.parse(JSON.stringify(B.giayChayPack));
  pack.extraValues = { camket: "hàng có sẵn tại kho" };
  pack.templates.in_stock = "Còn {ton} đôi {truc} {size}, giá {gia} ạ, {camket} ạ.";
  const f = fakePorts();
  const r = await B.handleTurn(pack, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "adizero boston 13 con size 42 khong"
  });
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /hàng có sẵn tại kho/);
});

test("ten kho rong thi cau khong duoc gui", async () => {
  const pack = JSON.parse(JSON.stringify(B.giayChayPack));
  pack.templates.in_stock = "Còn {ton} đôi {truc} {size} tại {kho}, giá {gia} ạ.";
  const f = fakePorts({
    rows: [{ itemId: "i1", variantId: "v", variantLabel: "42", warehouseId: "w1", warehouseName: "", qty: 3, price: 3190000 }]
  });
  const r = await B.handleTurn(pack, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "adizero boston 13 con size 42 khong"
  });
  assert.notEqual(r.action, "send", `Cau thung van duoc gui: ${r.reply}`);
});

test("truc thieu nhan hien cho nguoi doc thi bi tu choi", () => {
  const xau = JSON.parse(JSON.stringify(B.giayChayPack));
  xau.itemShape.axes[0].label = "";
  assert.ok(B.validatePack(xau).some((m) => /thieu nhan hien/.test(m)));
});

// ===========================================================================
// HOI THOAI NHIEU LUOT — nhung gi lo ra khi chat thu that qua duong day (10/09).
// ===========================================================================

test("chi neu ten mon thi hieu la hoi hang: hoi size, roi '42' la cau tra loi", async () => {
  // Cau dau tien khach that go: khong co tu khoa nao, chi co ten mon.
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r1 = await ask(f.ports, "shop oi co adizero boston 13 khong");
  assert.equal(r1.intentId, "hoi_ton_kho", "Chi chao lai — khach phai hoi lai lan nua.");
  assert.equal(r1.action, "ask_back");
  assert.match(r1.reply, /size/);

  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "42");
  assert.equal(r2.action, "send", JSON.stringify(r2.gates));
  assert.match(r2.reply, /Còn 3 đôi size 42/, r2.reply);
});

test("cau hoi tiep chi co con so va tu dem KHONG lam mat tam diem", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(new Date(T0.getTime() + 60_000));
  // "thi", "sao" khong phai ten mon; "43" cang khong. Truoc day tam diem bi xoa, bot
  // hoi lai ten mau, roi chuyen nguoi that — ca phien dong lai vi mot cau hoi tiep.
  const r = await ask(f.ports, "size 43 thi sao");
  assert.equal(r.itemCode, "IE0000", "Tam diem bi xoa chi vi mot cau hoi tiep.");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.match(r.reply, /Còn 6 đôi size 43/, r.reply);
});

test("tu CHU la thi van la doi mon — khong duoc tra ton adidas cho cau hoi ve Salomon", async () => {
  const f = fakePorts({ rows: [row("42", 3)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "con salomon speedcross size 42 khong");
  assert.notEqual(r.itemCode, "IE0000");
  assert.ok(!/Còn 3 đôi/.test(r.reply), r.reply);
});

const HL = (label, qty, price) => ({
  itemId: "i9", variantId: `h-${label}`, variantLabel: label,
  warehouseId: "q1", warehouseName: "Quay 1", qty, price
});

test("khach hoi tiep bang MOT CON SO KHAC thi doi theo, khong dinh o cu", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  const r1 = await ask(f.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  assert.match(r1.reply, /Còn 12 hộp 500mg/, r1.reply);

  f.setNow(new Date(T0.getTime() + 60_000));
  // O ham luong con dinh 500mg tu luot truoc. "650" tran khong qua duoc mau nhan dang
  // (doi don vi), nhung kho chi co 500mg va 650mg nen "650" chi co the la 650mg.
  // Khong doi thi bot tra loi ton cua 500mg cho cau hoi ve 650 — mot con so DUNG cho
  // mot cau hoi KHAC, va khong cong nao bat duoc vi moi con so deu co nguon.
  const r2 = await ask(f.ports, "loai 650 con khong", {}, "nha-thuoc");
  assert.equal(r2.action, "send", JSON.stringify(r2.gates));
  assert.match(r2.reply, /Còn 4 hộp 650mg/, `Tra loi ton cua 500mg cho cau hoi ve 650: ${r2.reply}`);
  assert.ok(!/500mg/.test(r2.reply), r2.reply);
  // Gia tri DOAN khong duoc luu thanh o cua khach — no chi song trong luot nay.
  assert.notEqual(r2.state.focusSlots?.hamluong, "650mg", "Gia tri doan bam dinh sang luot sau.");
});

test("so tran khop HAI nhan thi KHONG doan — hoi lai van hon doan sai", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("500ml", 3, 40000)] });
  const r = await ask(f.ports, "paracetamol loai 500 con khong", {}, "nha-thuoc");
  assert.equal(r.action, "ask_back", `Doan bua giua 500mg va 500ml: ${r.reply}`);
});

test("so tran khong khop nhan nao thi khong doan", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  const r = await ask(f.ports, "paracetamol con 2 hop khong", {}, "nha-thuoc");
  assert.equal(r.action, "ask_back", `"2 hop" bi doc thanh mot ham luong: ${r.reply}`);
});

test("ho so tro y dinh mac dinh khong ton tai thi bo soi bao", () => {
  const xau = JSON.parse(JSON.stringify(B.giayChayPack));
  xau.intentWhenItemNamed = "khong_co_y_dinh_nay";
  const loi = B.validatePack(xau);
  assert.ok(loi.some((m) => /intentWhenItemNamed/.test(m)), JSON.stringify(loi));
});

test("ho so KHONG khai y dinh mac dinh thi neu ten mon van chi la chao", async () => {
  const pack = JSON.parse(JSON.stringify(B.giayChayPack));
  delete pack.intentWhenItemNamed;
  const f = fakePorts({ rows: [row("42", 3)] });
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "adizero boston 13" });
  assert.equal(r.intentId, null, "Bo may tu quyet thay cho ho so.");
});

test("so tran KHONG duoc de len truc khach vua noi ro trong chinh cau do", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await ask(f.ports, "adizero boston 13 con khong");
  f.setNow(new Date(T0.getTime() + 60_000));
  // Khach hoi size 44. "43" trong cau chi la mot con so khac, khop dung mot nhan kho —
  // nhung size 44 da duoc rut ra tu chinh cau nay, nen khong duoc de len.
  const r = await ask(f.ports, "size 44 con khong hay chi con 43");
  assert.equal(r.slots.size, "44", JSON.stringify(r.slots));
  assert.ok(!/Còn 6 đôi size 43/.test(r.reply), `Tra loi size 43 cho cau hoi ve 44: ${r.reply}`);
});

// ===========================================================================
// VONG PHAN BIEN 7 — ba luat hoi thoai deu tung noi cung mot chieu (hoi -> khang dinh).
// Moi bai duoi day giu chieu NGUOC lai: tha im con hon noi sai.
// ===========================================================================

test("so kem don vi ('650mg') KHONG lam mat tam diem — dau neo ^ cua tu chu la", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  await ask(f.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "con 650mg nua khong", {}, "nha-thuoc");
  assert.equal(r.itemCode, "PARA500", "'650mg' bi coi la tu chu la, tam diem bi xoa.");
  assert.match(r.reply, /Còn 4 hộp 650mg/, r.reply);
});

test("mon moi co ten THUAN SO (New Balance 574) van la doi mon", async () => {
  const NB574 = { id: "i5", code: "NB574", name: "New Balance 574", brand: "new balance", priceFrom: 2290000, variantCount: 6 };
  const f = fakePorts({ items: [BOSTON, NB574], rows: [row("42", 3)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "con 574 khong shop");
  assert.notEqual(r.itemCode, "IE0000", "Tra ton cua Boston cho cau hoi ve 574.");
  assert.ok(!/Còn 3 đôi/.test(r.reply), r.reply);
});

test("neu ten mon KEM noi dung khac thi KHONG phai hoi hang", async () => {
  for (const cau of [
    "adizero boston 13 bi bong keo roi shop",
    "em nhan duoc adizero boston 13 roi nhe cam on shop",
    "adizero boston 13 giat may duoc khong",
    "adizero boston 13 em di duoc 43 hom thi bi bong keo"
  ]) {
    const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
    const r = await ask(f.ports, cau);
    assert.notEqual(r.intentId, "hoi_ton_kho", `Khieu nai/cam on bi coi la hoi hang: "${cau}"`);
    assert.ok(!/Còn \d+ đôi/.test(r.reply), `Tra loi khieu nai bang bang ton kho: "${cau}" -> ${r.reply}`);
  }
});

test("so tran dung canh tu chi so luong / can nang / tien thi KHONG doan", async () => {
  const ca = [
    ["shop oi adizero boston 13 con 42 doi khong", /size 42/],
    ["adizero boston 13 em nang 50 kg cao 1m70 nen di size nao", /size 50/],
    ["adizero boston 13 em coc truoc 42.000d nhe", /size 42/],
    ["adizero boston 13 don cua em 45.000d tien ship", /size 45/]
  ];
  for (const [cau, cam] of ca) {
    const f = fakePorts({ rows: [row("42", 3), row("43", 6), row("45", 1), row("50", 2)] });
    const r = await ask(f.ports, cau);
    assert.ok(!cam.test(r.reply), `Doan bua bien the tu mot con so khong phai bien the: "${cau}" -> ${r.reply}`);
  }
});

test("nha thuoc: tien chuyen khoan va so hop KHONG bi doc thanh ham luong", async () => {
  const f1 = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  const r1 = await ask(f1.ports, "paracetamol em chuyen 500.000d roi shop", {}, "nha-thuoc");
  assert.ok(!/Còn 12 hộp 500mg/.test(r1.reply), `Tien chuyen khoan thanh ham luong: ${r1.reply}`);

  const f2 = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("2ml", 7, 15000)] });
  const r2 = await ask(f2.ports, "paracetamol cho em lay 2 hop", {}, "nha-thuoc");
  assert.ok(!/2ml/.test(r2.reply), `So hop thanh ham luong: ${r2.reply}`);
});

test("gia tri DOAN chi song trong luot, khong bam dinh sang luot sau", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  const r1 = await ask(f.ports, "co paracetamol khong", {}, "nha-thuoc");
  assert.equal(r1.action, "ask_back", r1.reply);
  f.setNow(new Date(T0.getTime() + 60_000));
  // Khach tra loi cau hoi cua bot bang MOT CON SO.
  const r2 = await ask(f.ports, "650", {}, "nha-thuoc");
  assert.equal(r2.action, "send", `Bot khong hieu cau tra loi cho chinh cau hoi cua no: ${r2.reply}`);
  assert.match(r2.reply, /Còn 4 hộp 650mg/, r2.reply);
  f.setNow(new Date(T0.getTime() + 120_000));
  // Luot sau khong noi ham luong nao: phai HOI LAI, khong duoc mac dinh 650mg da doan.
  const r3 = await ask(f.ports, "the con hang khong shop", {}, "nha-thuoc");
  assert.equal(r3.action, "ask_back", `Gia tri doan bam dinh sang luot sau: ${r3.reply}`);
});

test("cau hoi tiep binh thuong cua nganh khac cung khong mat tam diem", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  await ask(f.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "loai 650 thi sao", {}, "nha-thuoc");
  assert.equal(r.itemCode, "PARA500");
  assert.match(r.reply, /Còn 4 hộp 650mg/, r.reply);
});

test("tu dem nam o HO SO, khong nam trong bo may", () => {
  // "cam" la tu dem o giay nhung la "thuoc cam" o nha thuoc — bo may khong duoc tu quyet.
  assert.ok(!B.specificTokens("con cam khong", []).includes("cam") === false,
    "Bo may nuot 'cam' du ho so khong khai.");
  assert.deepEqual(B.specificTokens("con cam khong", [], ["cam"]), []);
  assert.ok(B.nhaThuocPack.lexicon.fillerWords !== undefined);
  assert.ok(!B.nhaThuocPack.lexicon.fillerWords.includes("cam"), "'cam' bi nuot o nha thuoc.");
});

test("tien viet khong dau (3.190.000d) va tien ghep (3tr190) doc dung", () => {
  assert.deepEqual(B.numbersIn("gia 3.190.000d"), [3190000]);
  assert.deepEqual(B.numbersIn("gia 25.000d/hop"), [25000]);
  assert.deepEqual(B.numbersIn("3tr190"), [3190000]);
  assert.deepEqual(B.numbersIn("2tr5"), [2500000]);
  assert.deepEqual(B.numbersIn("2tr50"), [2500000]);
  assert.deepEqual(B.numbersIn("2 doi 6.380.000d"), [2, 6380000]);
  // Khong hong nhung gi von dung.
  assert.deepEqual(B.numbersIn("con 3 doi"), [3]);
  assert.deepEqual(B.numbersIn("hang ve 3 ngay"), [3]);
});

test("dinhDangTien: khong phai so thi tra ve RONG de cong o rong bat, so am giu dau", () => {
  assert.equal(C.dinhDangTien(NaN), "");
  assert.equal(C.dinhDangTien(Infinity), "");
  assert.equal(C.dinhDangTien(-500000), "-500.000đ");
  assert.equal(C.dinhDangTien(0), "0đ");
});

test("cau co HAI so tran thi khong doan, du chi mot so khop nhan", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  // Khach hoi ve 700 (khong co), nhac lai 650 (co). Doan 650 la tra loi sai cau hoi.
  const r = await ask(f.ports, "paracetamol hom qua em hoi 650, gio 700 con khong", {}, "nha-thuoc");
  assert.ok(!/Còn 4 hộp 650mg/.test(r.reply), `Doan 650mg cho cau hoi ve 700: ${r.reply}`);
  assert.equal(r.action, "ask_back", r.reply);
});

// ===========================================================================
// VONG PHAN BIEN 8 — danh sach TRANG cho so tran; mau cua ho so cung qua cong do.
// ===========================================================================

test("X1: mau size KHONG duoc doc tien thanh size, va khong luu gia tri do", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r1 = await ask(f.ports, "adizero boston 13 con hang khong shop, em chuyen 42.000d tien ship roi");
  assert.ok(!/size 42/.test(r1.reply), `Tien ship thanh size: ${r1.reply}`);
  assert.equal(r1.slots.size, undefined, JSON.stringify(r1.slots));
  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "con hang khong shop");
  assert.ok(!/size 42/.test(r2.reply), `Size sai bam dinh sang luot sau: ${r2.reply}`);
});

test("X2: so khong dung sau tu bao hieu bien the thi KHONG doan (nha thuoc)", async () => {
  const rows = [HL("3ml", 2, 12000), HL("5ml", 9, 18000), HL("10ml", 4, 30000)];
  for (const [cau, cam] of [
    ["paracetamol con hang khong shop, thu 5 em qua lay", /5ml/],
    ["paracetamol con hang khong, em o quan 3 giao duoc khong", /3ml/],
    ["paracetamol con hang khong, nha em so 10 ngo 5", /10ml|5ml/]
  ]) {
    const f = fakePorts({ items: [PARA], rows });
    const r = await ask(f.ports, cau, {}, "nha-thuoc");
    assert.ok(!cam.test(r.reply), `Doan bien the tu mot con so khong phai bien the: "${cau}" -> ${r.reply}`);
  }
});

test("X2: so khong dung sau tu bao hieu bien the thi KHONG doan (giay)", async () => {
  const rows = [row("40", 5), row("42", 3), row("43", 6)];
  for (const [cau, cam] of [
    ["adizero boston 13 con hang khong shop, ngoai troi 40 do ma van chay duoc chu", /size 40/],
    ["adizero boston 13 con hang khong, em chay duoc 42 buoi roi", /size 42/],
    ["adizero boston 13 con hang khong shop, nha em o toa 43", /size 43/],
    ["adizero boston 13 con hang khong, em cao 1m70", /size 70|size 1\b/]
  ]) {
    const f = fakePorts({ rows });
    const r = await ask(f.ports, cau);
    assert.ok(!cam.test(r.reply), `"${cau}" -> ${r.reply}`);
  }
});

test("danh sach trang van cho qua cach hoi bien the pho bien nhat", async () => {
  const thuoc = () => fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  for (const cau of ["co paracetamol con 650 khong", "paracetamol het 650 chua", "paracetamol loai 650 con khong"]) {
    const r = await ask(thuoc().ports, cau, {}, "nha-thuoc");
    assert.match(r.reply, /Còn 4 hộp 650mg/, `Hoi lai oan: "${cau}" -> ${r.reply}`);
  }
  const giay = () => fakePorts({ rows: [row("42", 3), row("43", 6)] });
  for (const cau of ["adizero boston 13 em di 42", "adizero boston 13 mau nay 42 con khong", "adizero boston 13 con 42 khong"]) {
    const r = await ask(giay().ports, cau);
    assert.match(r.reply, /Còn 3 đôi size 42/, `Hoi lai oan: "${cau}" -> ${r.reply}`);
  }
});

test("con so tra loi cho o vua hoi KHONG bi coi la ten mon khac (Vitamin C 500)", async () => {
  const VITC = { id: "i8", code: "VITC500", name: "Vitamin C 500", brand: "dhg", priceFrom: 40000, variantCount: 1 };
  const f = fakePorts({ items: [PARA, VITC], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  const r1 = await ask(f.ports, "co paracetamol khong", {}, "nha-thuoc");
  assert.equal(r1.action, "ask_back", r1.reply);
  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "500", {}, "nha-thuoc");
  assert.equal(r2.itemCode, "PARA500", "Tam diem nhay sang Vitamin C 500 chi vi '500'.");
  assert.match(r2.reply, /Còn 12 hộp 500mg/, r2.reply);
});

test("goi mon bang TEN NGAN khong lam mat tam diem", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "boston con size 43 khong");
  assert.equal(r.itemCode, "IE0000", "Goi 'boston' ma bot hoi lai ten mau.");
  assert.match(r.reply, /Còn 6 đôi size 43/, r.reply);
});

test("ten mon HAI chu so (Air Max 90) van la doi mon", async () => {
  const AM90 = { id: "i6", code: "AM90", name: "Air Max 90", brand: "nike", priceFrom: 3290000, variantCount: 6 };
  const f = fakePorts({ items: [BOSTON, AM90], rows: [row("42", 3)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "con 90 khong");
  assert.notEqual(r.itemCode, "IE0000", "Tra ton Boston cho cau hoi ve Air Max 90.");
  assert.ok(!/Còn 3 đôi/.test(r.reply), r.reply);
});

test("N4: chao suong khong xoa moc hoi lai — hoi -> alo -> hoi lai la chuyen nguoi that", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r1 = await ask(f.ports, "shop oi co adizero boston 13 khong");
  assert.equal(r1.action, "ask_back", r1.reply);
  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "alo");
  assert.notEqual(r2.action, "ask_back");
  f.setNow(new Date(T0.getTime() + 120_000));
  const r3 = await ask(f.ports, "co size khong shop");
  assert.equal(r3.action, "handoff", `Hoi lai lan hai trong 30 phut ma khong goi nguoi that: ${r3.reply}`);
});

test("dong kho thieu qty thi khong duoc noi 'Con NaN doi'", async () => {
  const f = fakePorts({ rows: [{ itemId: "i1", variantId: "v", variantLabel: "42", warehouseId: "w1", warehouseName: "Kho nha", price: 3190000 }] });
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.ok(!/NaN/.test(r.reply), r.reply);
  assert.notEqual(r.action, "send", `Gui di mot cau tren du lieu hong: ${r.reply}`);
});

test("tu dem cua ho so khong duoc nuot ten mon cua shop", () => {
  assert.deepEqual(B.kiemTuDemVoiMucLuc(B.giayChayPack, [{ code: "GM1", name: "Giày mọi da bò" }]), []);
  const xau = JSON.parse(JSON.stringify(B.giayChayPack));
  xau.lexicon.fillerWords = [...xau.lexicon.fillerWords, "moi"];
  assert.deepEqual(B.kiemTuDemVoiMucLuc(xau, [{ code: "GM1", name: "Giày mọi da bò" }]), ["moi"]);
  // Tu dem DUOI 3 chu khong bao gio qua `specificTokens` -> khong nuot gi -> khong bao (bao gia lam chim bao that).
  xau.lexicon.fillerWords = [...xau.lexicon.fillerWords, "da"];
  assert.deepEqual(B.kiemTuDemVoiMucLuc(xau, [{ code: "GM1", name: "Giày mọi da bò" }]), ["moi"]);
  assert.ok(B.specificTokens("giay moi con size 42 khong", B.giayChayPack.lexicon.genericTerms,
    B.giayChayPack.lexicon.fillerWords).includes("moi"), "'giay moi' khong bao gio ban duoc.");
});

// ===========================================================================
// VONG PHAN BIEN 9 — tu choi mot con so moi KHONG duoc bien thanh xac nhan con so cu.
// ===========================================================================

test("o size da ghim: hoi size khac bang cach thuong ngay -> KHONG tra loi bang size cu", async () => {
  for (const cau of [
    "the 43 con khong", "cho em hoi 43 con khong", "shop oi 43 con khong",
    "ban 43 con khong a", "a 43 con khong", "hoi 43 con hang khong"
  ]) {
    const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
    await ask(f.ports, "adizero boston 13 con size 42 khong");
    f.setNow(new Date(T0.getTime() + 60_000));
    const r = await ask(f.ports, cau);
    assert.ok(!/size 42/.test(r.reply), `Tra loi size 42 cho cau hoi ve 43: "${cau}" -> ${r.reply}`);
    // Hoac tra loi dung 43, hoac hoi lai — khong duoc noi mot con so cho cau hoi khac.
    assert.ok(/size 43/.test(r.reply) || r.action === "ask_back", `"${cau}" -> ${r.reply}`);
  }
});

test("ten mon dung ngay truoc con so la tu bao hieu bien the", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "boston 43 con khong");
  assert.match(r.reply, /Còn 6 đôi size 43/, r.reply);

  const g = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  await ask(g.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  g.setNow(new Date(T0.getTime() + 60_000));
  for (const cau of ["paracetamol 650 con khong", "co paracetamol 650 khong"]) {
    const r2 = await ask(g.ports, cau, {}, "nha-thuoc");
    assert.match(r2.reply, /Còn 4 hộp 650mg/, `"${cau}" -> ${r2.reply}`);
  }
});

test("hai so tran ma khong doan duoc thi gia tri ghim cu cung bi GO", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6), row("44", 1)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "con 43 hay 44 khong");
  assert.ok(!/size 42/.test(r.reply), `Hai so moi ma tra loi bang so cu: ${r.reply}`);
});

test("truc KHONG bat buoc loc ra rong thi bo bo loc — KHONG duoc bao het hang", async () => {
  for (const cau of [
    "co paracetamol 500mg khong, em can 2 vien thoi",
    "paracetamol 500mg con khong, cho em 10 vien"
  ]) {
    const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
    const r = await ask(f.ports, cau, {}, "nha-thuoc");
    assert.ok(!/hết/.test(r.reply), `Bao het hang trong khi kho con 12 hop: "${cau}" -> ${r.reply}`);
    assert.match(r.reply, /Còn 12 hộp 500mg/, r.reply);
  }
});

test("so hop le tinh tren CUNG chuoi voi mau cua ho so — bang alias khong doi phan quyet", async () => {
  const pack = JSON.parse(JSON.stringify(B.giayChayPack));
  pack.lexicon.aliases = { ...pack.lexicon.aliases, sz: "size" };
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "adizero boston 13 con size 42 khong" });
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await B.handleTurn(pack, f.ports, { tenant: TENANT, conversationId: CONV, text: "sz 43 con khong" });
  assert.match(r.reply, /Còn 6 đôi size 43/, `Alias sz->size ma van: ${r.reply}`);
  // Khong co alias: "sz" khong phai tu bao hieu -> hoi lai, nhung KHONG duoc tra loi size 42.
  const g = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await ask(g.ports, "adizero boston 13 con size 42 khong");
  g.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(g.ports, "sz 43 con khong");
  assert.ok(!/size 42/.test(r2.reply), r2.reply);
});

test("tu bao hieu YEU (co/con/la) dong am voi tu thuong thi khong duoc lot", async () => {
  const rows = [HL("2ml", 4, 9000), HL("5ml", 9, 18000), HL("10ml", 4, 30000)];
  for (const [cau, cam] of [
    ["paracetamol con hang khong, nha em co 2 be nho", /2ml/],
    ["paracetamol con hang khong, em con 2 don chua nhan", /2ml/],
    ["paracetamol con hang khong, cai nay la 5 phai khong", /5ml/],
    ["paracetamol con hang khong, em lay 2 vi thoi", /2ml/]
  ]) {
    const f = fakePorts({ items: [PARA], rows });
    const r = await ask(f.ports, cau, {}, "nha-thuoc");
    assert.ok(!cam.test(r.reply), `"${cau}" -> ${r.reply}`);
  }
  // Nhung cach hoi that thi van qua.
  // "lay 5" thi KHONG: "lay" la dong tu dat hang, tan ngu cua no la so luong — hoi lai la dung.
  for (const cau of ["paracetamol con 5 khong", "paracetamol con 5 khong shop", "co paracetamol 5 khong"]) {
    const f = fakePorts({ items: [PARA], rows });
    const r = await ask(f.ports, cau, {}, "nha-thuoc");
    assert.match(r.reply, /Còn 9 hộp 5ml/, `Hoi lai oan: "${cau}" -> ${r.reply}`);
  }
});

test("so nam trong dai cua mot truc (size 41) KHONG bi coi la ten mon (Pegasus 41)", async () => {
  const PEG41 = { id: "i7", code: "PEG41", name: "Pegasus 41", brand: "nike", priceFrom: 3690000, variantCount: 6 };
  const f = fakePorts({ items: [BOSTON, PEG41], rows: [row("41", 4), row("42", 3)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "41 con khong");
  assert.equal(r.itemCode, "IE0000", "Nhay sang Pegasus 41 chi vi so 41.");
  assert.match(r.reply, /Còn 4 đôi size 41/, r.reply);
});

test("bo tim kiem tra theo THU TU KHO: 'Con O' dung dau bang khong lam mat tam diem Vitamin C 500", async () => {
  const CONO = { id: "i1", code: "DGCO", name: "Dầu gió Con Ó", brand: "x", priceFrom: 20000, variantCount: 1 };
  const VITC = { id: "i8", code: "VITC500", name: "Vitamin C 500", brand: "dhg", priceFrom: 40000, variantCount: 1 };
  const f = fakePorts({ items: [CONO, VITC], giuThuTuKho: true,
    rows: [{ itemId: "i8", variantId: "h5", variantLabel: "500mg", warehouseId: "q1", warehouseName: "Quay 1", qty: 7, price: 40000 }] });
  const r1 = await ask(f.ports, "co vitamin c 500 khong", {}, "nha-thuoc");
  assert.equal(r1.itemCode, "VITC500");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "500 con khong shop", {}, "nha-thuoc");
  assert.equal(r2.itemCode, "VITC500", `Tam diem mat vi 'Con O' dung dau bang: ${r2.reply}`);
  assert.notEqual(r2.action, "handoff", r2.reply);
});

test("hai so tran o truc doi don vi: khong doan duoc thi gia tri ghim cu cung bi GO", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000), HL("700mg", 2, 35000)] });
  await ask(f.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  f.setNow(new Date(T0.getTime() + 60_000));
  // Mau ham luong doi don vi nen "650"/"700" khong duoc rut ra; hai so tran thi khong doan.
  // Nhung o 500mg dang ghim tu luot truoc KHONG duoc dem ra tra loi.
  const r = await ask(f.ports, "loai 650 hay 700 con khong", {}, "nha-thuoc");
  assert.ok(!/500mg/.test(r.reply), "Hai so moi khong doan duoc ma tra loi bang 500mg cu: " + r.reply);
  assert.equal(r.action, "ask_back", r.reply);
});

test("bang tu dong nghia doi CHU thanh SO thi mau cua ho so phai thay con so do", async () => {
  const pack = JSON.parse(JSON.stringify(B.giayChayPack));
  pack.lexicon.aliases = { ...pack.lexicon.aliases, "bon hai": "42" };
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r = await B.handleTurn(pack, f.ports, {
    tenant: TENANT, conversationId: CONV, text: "adizero boston 13 con size bon hai khong"
  });
  // Cong so tran doc cau DA qua bang dong nghia ("size 42") — mau cua ho so cung phai doc
  // dung chuoi do, khong thi mot ben thay 42 mot ben khong, va phan quyet lech nhau.
  assert.match(r.reply, /Còn 3 đôi size 42/, r.reply);
});

// ===========================================================================
// VONG PHAN BIEN 10 — dong tu dat hang khong phai tu bao hieu bien the.
// ===========================================================================

test("cau CHOT DON ('minh lay 2 nhe') khong duoc tra loi bang ton cua lo 2ml", async () => {
  const rows = [HL("2ml", 4, 9000), HL("5ml", 9, 18000), HL("10ml", 4, 30000)];
  for (const cau of [
    "paracetamol con hang khong shop, minh lay 2 nhe",
    "paracetamol con hang khong, cho em 2 nhe",
    "paracetamol con hang khong, em mua 2 duoc khong",
    "paracetamol con hang khong, em can 2 thoi",
    "paracetamol con hang khong, em lay 2 a",
    "paracetamol con hang khong, em can mua 2 hay 3 hop"
  ]) {
    const f = fakePorts({ items: [PARA], rows });
    const r = await ask(f.ports, cau, {}, "nha-thuoc");
    assert.ok(!/2ml|5ml|10ml/.test(r.reply), `Cau dat hang bi doc thanh bien the: "${cau}" -> ${r.reply}`);
  }
});

test("chot don sau khi da noi ham luong: KHONG bi hoi lai ham luong", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  await ask(f.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "paracetamol con hang khong shop, minh lay 2 nhe", {}, "nha-thuoc");
  assert.match(r.reply, /Còn 12 hộp 500mg/, `Ghim 500mg bi go oan vi mot so luong: ${r.reply}`);
});

test("U1: mot so tran khop HAI nhan, co o da ghim -> hoi lai, khong tra loi bang o cu", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("500ml", 3, 40000), HL("650mg", 4, 32000)] });
  await ask(f.ports, "co paracetamol 650mg khong", {}, "nha-thuoc");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r = await ask(f.ports, "paracetamol con 500 khong", {}, "nha-thuoc");
  assert.ok(!/650mg/.test(r.reply), `Mot con so DUNG cho mot cau hoi KHAC: ${r.reply}`);
  assert.equal(r.action, "ask_back", r.reply);
});

test("hai cho go ghim co CUNG tuoi tho: luot thu ba khong duoc thay gia tri cu quay lai", async () => {
  const f = fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000), HL("700mg", 2, 35000)] });
  await ask(f.ports, "co paracetamol 500mg khong", {}, "nha-thuoc");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "loai 650 hay 700 con khong", {}, "nha-thuoc");
  assert.equal(r2.action, "ask_back", r2.reply);
  // Qua cua so 30 phut cua cong `ask_back_once`, de luot ba KHONG bi chuyen nguoi that
  // vi ly do khac — bai nay chi duoc phep phan biet "hoi lai" voi "tra loi bang so cu".
  f.setNow(new Date(T0.getTime() + 40 * 60_000));
  // Luot ba khong noi ham luong: ghim 500mg da bi go o luot hai thi khong duoc quay lai,
  // va bot phai HOI LAI ham luong chu khong tra loi bang 500mg.
  const r3 = await ask(f.ports, "the con hang khong", {}, "nha-thuoc");
  assert.ok(!/500mg/.test(r3.reply), `Gia tri cu quay lai o luot thu ba: ${r3.reply}`);
  // Hai lan hoi lai lien tiep khong duoc dap thi luat "hoi lai qua so lan" chuyen nguoi
  // that — do la hanh vi co san. Dieu bai nay giu la: KHONG tra loi bang con so cu.
  assert.notEqual(r3.action, "send", `Tra loi bang gia tri da bi go: ${r3.reply}`);
});

test("cueThem: 'boston 43' duoc LUU (luot thu ba van la 43, khong hoi lai)", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  await ask(f.ports, "adizero boston 13 con size 42 khong");
  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "boston 43 con khong");
  assert.match(r2.reply, /Còn 6 đôi size 43/, r2.reply);
  f.setNow(new Date(T0.getTime() + 120_000));
  const r3 = await ask(f.ports, "con hang khong shop");
  assert.match(r3.reply, /Còn 6 đôi size 43/, `Size 43 vua noi khong duoc giu sang luot sau: ${r3.reply}`);
});

// ===========================================================================
// VONG PHAN BIEN 11 — ten mon va dau tin cung phai qua chot cau hoi; veto dat hang
// chi trong cua so gan.
// ===========================================================================

test("chot don voi so dung SAU TEN MON hoac MO DAU TIN khong duoc doc thanh bien the", async () => {
  const rows = [HL("2ml", 4, 9000), HL("5ml", 9, 18000), HL("10ml", 4, 30000)];
  for (const cau of ["cho em paracetamol 2 nhe", "paracetamol 2 nhe shop", "paracetamol 2 thoi"]) {
    const f = fakePorts({ items: [PARA], rows });
    const r = await ask(f.ports, cau, {}, "nha-thuoc");
    assert.ok(!/2ml/.test(r.reply), `"${cau}" -> ${r.reply}`);
  }
  // Luot hai, KHONG co cau hoi nao dang cho: "2 nhe shop" la so luong.
  for (const cau of ["2 nhe shop", "2 duoc khong shop"]) {
    const f = fakePorts({ items: [PARA], rows });
    await ask(f.ports, "co paracetamol 5ml khong", {}, "nha-thuoc");
    f.setNow(new Date(T0.getTime() + 60_000));
    const r = await ask(f.ports, cau, {}, "nha-thuoc");
    assert.ok(!/2ml/.test(r.reply), `luot hai "${cau}" -> ${r.reply}`);
  }
});

test("bot vua hoi truc do thi con so mo dau tin la cau tra loi, tieu tu gi cung duoc", async () => {
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r1 = await ask(f.ports, "shop oi co adizero boston 13 khong");
  assert.equal(r1.action, "ask_back", r1.reply);
  f.setNow(new Date(T0.getTime() + 60_000));
  const r2 = await ask(f.ports, "42 nhe shop");
  assert.match(r2.reply, /Còn 3 đôi size 42/, `Khach tra loi size ma bi hoi lai: ${r2.reply}`);
});

test("'cho em hoi' / 'xin hoi' o dau cau KHONG vo hieu hoa cau hoi bien the", async () => {
  const thuoc = () => fakePorts({ items: [PARA], rows: [HL("500mg", 12, 25000), HL("650mg", 4, 32000)] });
  for (const cau of ["cho em hoi paracetamol con 650 khong", "xin hoi paracetamol con 650 khong",
    "em mua hom truoc roi, paracetamol con 650 khong"]) {
    const r = await ask(thuoc().ports, cau, {}, "nha-thuoc");
    assert.match(r.reply, /Còn 4 hộp 650mg/, `Hoi lai oan: "${cau}" -> ${r.reply}`);
  }
  const f = fakePorts({ rows: [row("42", 3), row("43", 6)] });
  const r = await ask(f.ports, "cho em hoi adizero boston 13 con 43 khong");
  assert.match(r.reply, /Còn 6 đôi size 43/, r.reply);
  // Nhung dong tu dat hang dung GAN con so thi van veto.
  const g = fakePorts({ items: [PARA], rows: [HL("2ml", 4, 9000), HL("5ml", 9, 18000)] });
  const r2 = await ask(g.ports, "paracetamol con hang khong, cho em 2 nhe", {}, "nha-thuoc");
  assert.ok(!/2ml/.test(r2.reply), r2.reply);
});

test("tu chung 'cai nay', 'san pham nay', 'chai nay' khong lam mat tam diem", async () => {
  for (const [packId, items, rows, cau, mong] of [
    ["nha-thuoc", [PARA], [HL("500mg", 12, 25000)], "cai nay con khong", /Còn 12 hộp 500mg/],
    ["nha-thuoc", [PARA], [HL("500mg", 12, 25000)], "chai nay con khong", /Còn 12 hộp 500mg/],
    ["giay-chay", [BOSTON], [row("42", 3)], "san pham nay con khong", /Còn 3 đôi size 42/]
  ]) {
    const f = fakePorts({ items, rows });
    await ask(f.ports, packId === "giay-chay" ? "adizero boston 13 con size 42 khong" : "co paracetamol 500mg khong", {}, packId);
    f.setNow(new Date(T0.getTime() + 60_000));
    const r = await ask(f.ports, cau, {}, packId);
    assert.match(r.reply, mong, `"${cau}" (${packId}) -> ${r.reply}`);
  }
});

// ===========================================================================
// A4 — MUC LUC TREN XEON: noi DUY NHAT muc luc di vao Bo nao, hai cong lap o do.
// ===========================================================================

const MON = (over = {}) => ({
  tenant: TENANT, id: "i1", code: "IE0000", name: "Adizero Boston 13", brand: "adidas",
  variantAxis: "size",
  variants: [{ id: "v43", label: "43", price: 3290000, sort: 43 }, { id: "v42", label: "42", price: 3190000, sort: 42 }],
  attributes: { "màu": "Đen" }, images: [], updatedAt: "2026-09-10T00:00:00.000Z", ...over
});

test("muc luc Xeon: nap qua cong QD3 o dau NHAN — mon mang so dien thoai la tu choi CA DOT, ban cu giu nguyen", async () => {
  const ml = B.mucLucTrongBoNho();
  ml.nap(TENANT, B.giayChayPack, [MON()]);
  assert.equal(await ml.size(TENANT), 1);
  assert.throws(
    () => ml.nap(TENANT, B.giayChayPack, [MON({ id: "i2", code: "OK" }),
      MON({ id: "i3", code: "X", attributes: { note: "Chị Lan 0968411655" } })]),
    /QUYET DINH 3/
  );
  assert.equal(await ml.size(TENANT), 1, "Dot nap hong ma ban cu bi thay: nua dot nap loi lot vao.");
  assert.equal((await ml.search(TENANT, "adizero boston 13", 5))[0].code, "IE0000");
});

test("muc luc Xeon: mon cua shop KHAC lan vao, hay hai mon cung ma — tu choi ca dot", () => {
  const ml = B.mucLucTrongBoNho();
  assert.throws(() => ml.nap(TENANT, B.giayChayPack, [MON(), MON({ id: "i2", tenant: "shopB" })]), /shop "shopB"/);
  assert.throws(() => ml.nap(TENANT, B.giayChayPack, [MON(), MON({ code: "KHAC" })]), /cung ma "i1"/);
  assert.equal(ml.tuDemPham(TENANT).length, 0);
});

test("muc luc Xeon: `kiemTuDemVoiMucLuc` CO NOI GOI — tu dem nuot ten mon thi bao ve, ghi nhat ky, van nap (loi o ho so, khong o shop)", async () => {
  const nhatKy = [];
  const ml = B.mucLucTrongBoNho({ ghi: (d) => nhatKy.push(d) });
  const xau = JSON.parse(JSON.stringify(B.giayChayPack));
  xau.lexicon.fillerWords = [...xau.lexicon.fillerWords, "moi"];
  const kq = ml.nap(TENANT, xau, [MON(), MON({ id: "i2", code: "GM1", name: "Giày mọi da bò" })]);
  assert.deepEqual(kq, { soMon: 2, tuDemPham: ["moi"] });
  assert.deepEqual(ml.tuDemPham(TENANT), ["moi"]);
  assert.equal(nhatKy.length, 1);
  assert.match(nhatKy[0], /\[muc-luc\] t1: .*"giay-chay".*: moi/);
  assert.equal(await ml.size(TENANT), 2, "Mot ten mon lam ca shop mat muc luc.");
  // Nap lai bang ho so da sua: het pham loi, khong con giu danh sach cu.
  const sach = ml.nap(TENANT, B.giayChayPack, [MON({ id: "i2", code: "GM1", name: "Giày mọi da bò" })]);
  assert.deepEqual(sach, { soMon: 1, tuDemPham: [] });
  assert.deepEqual(ml.tuDemPham(TENANT), []);
  assert.equal(nhatKy.length, 1);
});

test("muc luc Xeon: tim theo do phu, bang nhau thi THU TU KHO, co tran, va KHONG thay mon cua shop khac", async () => {
  const ml = B.mucLucTrongBoNho();
  ml.nap(TENANT, B.giayChayPack, [
    MON({ id: "i1", code: "A1", name: "Pegasus 41" }),
    MON({ id: "i2", code: "A2", name: "Pegasus 40" }),
    MON({ id: "i3", code: "A3", name: "Adizero Boston 13", variants: [] }),
    MON({ id: "i4", code: "A4", name: "Pegasus 41 Premium" })
  ]);
  ml.nap("shopB", B.giayChayPack, [MON({ tenant: "shopB", id: "i1", code: "B1", name: "Pegasus 41" })]);
  const r = await ml.search(TENANT, "pegasus 41 con khong", 10);
  assert.deepEqual(r.map((x) => x.code), ["A1", "A4", "A2"], "A1 phu tron; A4 va A2 phu mot phan — A4 dung truoc vi 2/3 > 1/2.");
  assert.deepEqual((await ml.search(TENANT, "pegasus", 10)).map((x) => x.code), ["A1", "A2", "A4"], "Bang diem thi giu thu tu kho.");
  assert.deepEqual((await ml.search(TENANT, "pegasus", 2)).map((x) => x.code), ["A1", "A2"]);
  assert.deepEqual(await ml.search(TENANT, "pegasus", 0), []);
  assert.deepEqual(await ml.search(TENANT, "!!!", 5), []);
  assert.deepEqual(await ml.search("shopC", "pegasus", 5), []);
  assert.equal(await ml.size("shopC"), 0);
  assert.deepEqual((await ml.search("shopB", "pegasus", 5)).map((x) => x.code), ["B1"]);
  // Ban gon: gia THAP NHAT, so bien the; mon khong bien the thi gia 0 nhu OMI.
  const a1 = r[0];
  assert.deepEqual([a1.priceFrom, a1.variantCount, a1.brand], [3190000, 2, "adidas"]);
  assert.equal((await ml.search(TENANT, "boston", 5))[0].priceFrom, 0);
  // Ket qua la BAN SAO: nguoi goi sua khong lam hong kho.
  a1.name = "hong";
  assert.equal((await ml.search(TENANT, "pegasus 41", 1))[0].name, "Pegasus 41");
  ml.bo(TENANT);
  assert.equal(await ml.size(TENANT), 0);
  assert.equal(await ml.size("shopB"), 1);
  // Tim theo MA mon (shop go ma hang ngay), va `url` di theo ban gon.
  ml.nap(TENANT, B.giayChayPack, [MON({ id: "i1", code: "A1", name: "Pegasus 41", url: "https://shop/a1" }),
    MON({ id: "i2", code: "A2", name: "Pegasus 40" })]);
  const theoMa = await ml.search(TENANT, "con a2 khong", 5);
  assert.deepEqual(theoMa.map((x) => x.code), ["A2"]);
  assert.equal((await ml.search(TENANT, "pegasus 41", 1))[0].url, "https://shop/a1");
  // Do phu tinh tren TEN MON (phan ten mon co trong cau), khong phai tren cau: ten ngan
  // khop tron xep tren ten dai khop mot phan — cung chieu voi OMI `catalog.search`.
  ml.nap(TENANT, B.giayChayPack, [MON({ id: "i1", code: "D1", name: "Pegasus 41 Premium Gore Tex" }),
    MON({ id: "i2", code: "D2", name: "Pegasus" })]);
  assert.deepEqual((await ml.search(TENANT, "pegasus 41 con khong", 5)).map((x) => x.code), ["D2", "D1"],
    "D2 (2 token, phu 1/2) phai dung truoc D1 (6 token, phu 2/6); dao chieu coverage thi D1 len truoc.");
});

test("muc luc Xeon: bo may nhan ra mon qua kho THAT, khong qua ban gia cua bai kiem tra", async () => {
  const ml = B.mucLucTrongBoNho();
  ml.nap(TENANT, B.giayChayPack, [MON(), MON({ id: "i2", code: "PG41", name: "Pegasus 41" })]);
  const f = fakePorts({ rows: [row("42", 3)] });
  f.ports.catalog = ml;
  const r = await ask(f.ports, "adizero boston 13 con size 42 khong");
  assert.equal(r.action, "send", JSON.stringify(r.gates));
  assert.equal(r.itemCode, "IE0000");
  assert.match(r.reply, /Còn 3 đôi size 42/);
});
