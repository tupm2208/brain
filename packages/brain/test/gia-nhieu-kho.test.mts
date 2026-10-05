/**
 * 05/10/2026 — phiếu Desk 2026-09-07 "giá theo size lấy thấp nhất giữa kho" (bước 5 sự thật + máy luật).
 *
 * Nguyên tắc chung: một biến thể có ở nhiều kho, mỗi kho một giá → giá bot báo là ĐÚNG giá web của biến thể
 * đó: giá dương thấp nhất trong các dòng còn hàng (dòng giá 0 không phải giá), không phải giá của dòng / kho
 * đứng đầu. Giá "từ" của một mã = giá thấp nhất trong các biến thể còn hàng, không phải giá biến thể đầu bảng.
 *
 * Tầng 1: máy luật chạy gói NHÀ THUỐC (hai quầy, một quầy chưa có giá); sự thật tồn + cổng chạy gói giày thật
 * trên các dòng landing đã gộp (landing lấy giá thấp nhất — test ở landing_page/test/gia-nhieu-kho.test.mts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import type { ItemId, StockRow, VariantId, WarehouseId } from "@sp/contract";
import { ask, fakePorts, PARA } from "./fixtures.mts";
import { cfg } from "./stage3-fixtures.mts";

const counter = (label: string, wh: string, qty: number, price: number): StockRow => ({
  itemId: "i9" as ItemId, variantId: `h-${label}-${wh}` as VariantId, variantLabel: label,
  warehouseId: wh as WarehouseId, warehouseName: "", qty, price
});

test("máy luật (nhà thuốc): hai quầy cùng biến thể, quầy đầu CHƯA có giá (0) → báo giá quầy kia, không bao giờ '0đ'", async () => {
  const f = fakePorts({ items: [PARA], rows: [counter("500mg", "q1", 5, 0), counter("500mg", "q2", 7, 25000)] });
  const r = await ask(f.ports, "paracetamol 500mg gia bao nhieu", {}, "nha-thuoc");
  assert.doesNotMatch(r.reply, /(^|[^\d.])0\s?(đ|d|k)(?![\p{L}\d])/iu, r.reply);
  if (r.action === "send") assert.match(r.reply, /25[.,]?000/, r.reply);
  assert.doesNotMatch(r.reply, /từ .* đến/, `một biến thể không có khoảng giá: ${r.reply}`);
});

test("máy luật (nhà thuốc): hai quầy hai giá → giá thấp nhất, dù quầy đắt đứng đầu", async () => {
  const f = fakePorts({ items: [PARA], rows: [counter("500mg", "q1", 5, 27000), counter("500mg", "q2", 7, 25000)] });
  const r = await ask(f.ports, "paracetamol 500mg gia bao nhieu", {}, "nha-thuoc");
  if (r.action === "send") {
    assert.match(r.reply, /25[.,]?000/, r.reply);
    assert.doesNotMatch(r.reply, /27[.,]?000/, r.reply);
  }
});

// Landing đã gộp các dòng cùng size (giá thấp nhất, cộng số lượng, có dòng sẵn thì "sẵn").
const merged = (gia: number, kho = "kho_a1b2c3d4", loai = "HANG SAN"): B.FoundSize => ({ size: "42", gia, so_luong: 2, kho, loai });

test("sự thật tồn (giày): size đã gộp từ hai kho → giá đúng dòng landing đưa (giá web), không lấy giá biến thể khác", () => {
  const found: B.FoundItem[] = [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M", link: "https://shop.example/product/JP9252", cac_size: [
    { size: "41", gia: 1990000, so_luong: 1, kho: "kho_a1b2c3d4", loai: "HANG SAN" }, merged(1790000)
  ] }];
  const facts = B.buildStockFacts(found, { code: "JP9252", requestedSize: "42" }, cfg);
  assert.equal(facts?.price, 1790000);
});

test("giá 'từ' của một mã = giá thấp nhất trong các biến thể còn hàng (priceOf), không phải biến thể đầu bảng", () => {
  const item: B.FoundItem = { ma: "JP9252", ten: "ADIZERO BOSTON 13 M", cac_size: [
    { size: "40", gia: 1990000, so_luong: 0 }, { size: "41", gia: 0, so_luong: 2 }, { size: "42", gia: 1790000, so_luong: 2 }
  ] };
  assert.equal(B.priceOf(item), 1790000);
});

test("cổng (giày): nháp báo giá dòng kho đắt (1.990.000) cho size landing đã chốt 1.790.000 → đổi về 1.790.000", () => {
  const gate = new B.ReplyGate(B.loadReplyGateConfig("giay-chay"));
  const found: B.FoundItem[] = [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M", link: "https://shop.example/product/JP9252", cac_size: [merged(1790000)] }];
  const stockFacts = B.buildStockFacts(found, { code: "JP9252", requestedSize: "42" }, cfg);
  const r = gate.run("Dạ JP9252 size 42 còn hàng, giá 1.990.000đ ạ.", {
    shopSaid: "", customerSaid: "JP9252 size 42 con khong", policy: "", hoSo: null, found, stockFacts,
    lookups: { orderLooked: false }, links: {}, pronoun: "anh", uncertainProduct: false, site: "shop.example"
  });
  assert.doesNotMatch(r.reply, /1\.990/, r.reply);
  assert.match(r.reply, /1\.790/, r.reply);
});

test("cổng (giày): khách 'trên đây e để giá 1,790tr?' và bot nói đúng giá web 1.790.000 → giữ nguyên, không cãi, không gọi người", () => {
  const gate = new B.ReplyGate(B.loadReplyGateConfig("giay-chay"));
  const found: B.FoundItem[] = [{ ma: "JP9252", ten: "ADIZERO BOSTON 13 M", link: "https://shop.example/product/JP9252", cac_size: [merged(1790000)] }];
  const draft = "Dạ đúng rồi ạ, JP9252 size 42 giá 1.790.000đ ạ.";
  const r = gate.run(draft, {
    shopSaid: "", customerSaid: "tren day e de gia 1,790tr?", policy: "", hoSo: null, found,
    stockFacts: B.buildStockFacts(found, { code: "JP9252", requestedSize: "42" }, cfg),
    lookups: { orderLooked: false }, links: {}, pronoun: "anh", uncertainProduct: false, site: "shop.example"
  });
  assert.match(r.reply, /1\.790\.000/, r.reply);
  assert.equal(r.needsHuman, false, r.trace.join(","));
});
