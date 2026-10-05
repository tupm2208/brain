/**
 * 05/10/2026 — phiếu Desk 2026-09-06 "khách mặc cả kiểu viết tắt" (bước 4 nhận diện + 10 cổng soát).
 *
 * Nguyên tắc chung: khách xin bớt giá — kể cả câu rất ngắn chỉ có số tiền + "được không" ("1tr dc kh a") — thì
 * bot trả lời theo LỰA CHỌN MẶC CẢ CỦA SHOP (tầng 3, `banHang.macCa`): không hứa bớt ngoài mức shop khai, không
 * hỏi ngược "muốn giá bao nhiêu"; shop chưa khai thì giữ giá niêm yết + gọi người. Hỏi CHƯƠNG TRÌNH sale ("giảm
 * bao nhiêu %", "đang sale không") không phải mặc cả. Số tiền đọc bằng CÙNG bộ đọc tiền của cổng (`amountsIn`).
 *
 * Tầng 1: gói NHÀ THUỐC (chỉ phần chung) và gói giày (tầng 2 ghép lên); tầng 3: ô mặc cả đã khai / để trống.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { emptyShopProfile, type ShopProfile } from "@sp/contract";
import "./fixtures.mts";

const profile = (kieu: "khong-giam" | "giam-toi-da" | "qua-tang" | "", chiTiet = ""): ShopProfile => {
  const p = emptyShopProfile();
  p.banHang.macCa = { kieu, chiTiet };
  if (kieu !== "") p.nguon["banHang.macCa"] = "shop";
  return p;
};
const item = (phanTramGiam = 0): B.FoundItem => ({
  ma: "AB1234", ten: "Mẫu A", link: "https://shop.example/product/AB1234",
  cac_size: [{ size: "M", gia: 1290000, so_luong: 3 }], ...(phanTramGiam > 0 ? { phan_tram_giam: phanTramGiam } : {})
});
const base = (over: Partial<B.GateSources> = {}): B.GateSources => ({
  shopSaid: "", customerSaid: "", policy: "", hoSo: profile("khong-giam"), found: [item()], stockFacts: null,
  lookups: { orderLooked: false }, links: {}, pronoun: "anh", uncertainProduct: false, site: "shop.example", tenShop: "Shop Mẫu",
  focusCode: "AB1234", ...over
});
const has = (trace: string[], name: string): boolean => trace.some((t) => t === name || t.startsWith(`${name}:`));

const BARGAIN = ["1tr dc kh a", "bớt chút được không shop", "1tr2 được ko", "shop fix giá nhẹ đi", "có giảm thêm được không", "mặc cả tí nhé", "giá sinh viên được k", "1250k ok không shop", "bớt cho em đi"];
const NOT_BARGAIN = ["giảm bao nhiêu % vậy shop", "còn size 42 không", "ship về HN bao nhiêu", "mẫu này đang sale không", "có mẫu nào rẻ hơn không", "giá bao nhiêu vậy", "1tr2 à shop", "size 42 được không"];

for (const pack of ["nha-thuoc", "giay-chay"]) {
  const cfg = B.loadReplyGateConfig(pack);
  const gate = new B.ReplyGate(cfg);

  test(`${pack}: nhận diện mặc cả hai chiều (bảng Ca kiểm)`, () => {
    for (const said of BARGAIN) assert.equal(B.bargainSaid(B.gateNormalize(said), cfg), true, `phải là mặc cả: ${said}`);
    for (const said of NOT_BARGAIN) assert.equal(B.bargainSaid(B.gateNormalize(said), cfg), false, `không phải mặc cả: ${said}`);
  });

  test(`${pack}: shop "không giảm", khách "1tr dc kh a", nháp hỏi ngược "muốn giá bao nhiêu" → câu giá niêm yết, không hỏi ngược`, () => {
    const r = gate.run("Dạ anh muốn mức giá bao nhiêu ạ?", base({ customerSaid: "1tr dc kh a" }));
    assert.ok(has(r.trace, "mac_ca"), r.trace.join(","));
    assert.doesNotMatch(r.reply, /bao nhiêu/);
    assert.match(r.reply, /giá niêm yết/);
    assert.match(r.reply, /không giảm/);
    assert.equal(r.needsHuman, false);
  });

  test(`${pack}: shop "không giảm", nháp hứa bớt / nhận giá khách → cắt câu hứa, giữ phần còn lại, thêm câu giá niêm yết`, () => {
    for (const [said, draft] of [
      ["bớt chút được không shop", "Dạ em bớt cho anh 50k nhé. Mẫu này còn size M ạ."],
      ["1tr dc kh a", "Dạ 1tr em để cho anh luôn ạ. Mẫu này còn size M ạ."],
      ["có giảm thêm được không", "Dạ được ạ, em giảm thêm cho anh 5% nhé."]
    ] as const) {
      const r = gate.run(draft, base({ customerSaid: said }));
      assert.ok(has(r.trace, "mac_ca"), `${draft} → ${r.trace.join(",")}`);
      assert.doesNotMatch(r.reply, /bớt cho|để cho anh|giảm thêm cho|50k|1tr\b/, r.reply);
      assert.match(r.reply, /không giảm/, r.reply);
      if (draft.includes("còn size M")) assert.match(r.reply, /còn size M/, r.reply);
      assert.equal(r.needsHuman, false);
    }
  });

  test(`${pack}: câu báo chương trình ("mẫu này đang giảm 20% rồi") không phải lời hứa bớt → giữ, thêm câu giá niêm yết`, () => {
    const r = gate.run("Dạ mẫu này đang giảm 20% rồi ạ.", base({ customerSaid: "bớt chút được không shop" }));
    assert.match(r.reply, /đang giảm 20% rồi/, r.reply);
    assert.match(r.reply, /không giảm thêm/, r.reply);
  });

  test(`${pack}: nháp đã nói rõ không giảm → giữ nguyên`, () => {
    const draft = "Dạ nhà em bán đúng giá niêm yết nên không giảm thêm được ạ. Anh lấy size nào ạ?";
    const r = gate.run(draft, base({ customerSaid: "bớt chút được không shop" }));
    assert.equal(r.reply, draft);
  });

  test(`${pack}: mẫu đang sale + khách xin giảm → "giá niêm yết, mẫu này đang sale rồi", không hứa, không gọi người`, () => {
    const r = gate.run("Dạ em giảm thêm cho anh 5% nhé.", base({ customerSaid: "bớt chút được không shop", found: [item(20)] }));
    assert.match(r.reply, /đang sale/, r.reply);
    assert.doesNotMatch(r.reply, /giảm thêm cho/, r.reply);
    assert.equal(r.needsHuman, false);
  });

  test(`${pack}: ô mặc cả CHƯA KHAI → không hứa, giữ giá niêm yết, gọi người`, () => {
    for (const hoSo of [null, profile("")]) {
      const r = gate.run("Dạ em bớt cho anh 50k nhé.", base({ customerSaid: "1tr2 được ko", hoSo }));
      assert.doesNotMatch(r.reply, /bớt cho|50k/, r.reply);
      assert.match(r.reply, /giá/, r.reply);
      assert.equal(r.needsHuman, true);
      assert.equal(r.handoffReason, "mac_ca_chua_khai");
    }
  });

  test(`${pack}: shop "giảm tối đa" → câu bớt của bot giữ (shop cho phép, mức trong hồ sơ); vẫn không hỏi ngược giá`, () => {
    const allow = profile("giam-toi-da", "tối đa 5%");
    const kept = gate.run("Dạ em bớt cho anh 5% nhé.", base({ customerSaid: "bớt chút được không shop", hoSo: allow }));
    assert.equal(kept.reply, "Dạ em bớt cho anh 5% nhé.");
    const asked = gate.run("Dạ anh muốn giá bao nhiêu ạ? Em báo lại nhé.", base({ customerSaid: "bớt chút được không shop", hoSo: allow }));
    assert.doesNotMatch(asked.reply, /muốn giá bao nhiêu/, asked.reply);
  });

  test(`${pack}: không phải mặc cả ("giảm bao nhiêu % vậy shop") → luật không chạy`, () => {
    const draft = "Dạ mẫu này đang giảm 20% ạ.";
    const r = gate.run(draft, base({ customerSaid: "giảm bao nhiêu % vậy shop" }));
    assert.ok(!has(r.trace, "mac_ca"), r.trace.join(","));
  });
}
