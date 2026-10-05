/**
 * 05/10/2026 — phiếu Desk 2026-09-02 "khách gõ mã có khoảng trắng giữa chữ và số" (bước 1/4 đọc thực thể).
 *
 * Nguyên tắc chung: khách gõ tay hay chèn MỘT khoảng trắng giữa phần chữ và phần số của mã ("IM 7681"); mã đọc
 * được phải là dạng LIỀN ("IM7681") để tra kho, và các chuỗi chữ + số thường ("size 42 2026", "so 1234") không
 * thành mã. Cơ chế ghép (tầng 1) chỉ ghép khi phần chữ viết HOA và kết quả khớp HÌNH MÃ CỦA NGÀNH (tầng 2,
 * `productCodePatterns`); ngành không khai hình mã thì chỉ còn lưới chung (cũng trả dạng liền).
 *
 * Tầng 1: ngành giả (hình mã "3 chữ + 3 số") trên cấu hình thực thể của nhà thuốc; tầng 2: gói giày thật.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "@sp/brain";
import { runningShoesPack } from "./fixtures.mts";

const shoes = new B.EntityExtractor(B.loadEntityConfig("giay-chay"), B.entityLexiconOf(runningShoesPack.lexicon, B.loadDialogueConfig("giay-chay")));
const fake = new B.EntityExtractor(B.loadEntityConfig("nha-thuoc"), { brands: [], aliases: {}, productCodePatterns: ["\\b([A-Za-z]{3}\\d{3})\\b"] });

test("tầng 1 (ngành giả, hình mã 3 chữ + 3 số): 'PAR 500' → PAR500; viết liền giữ nguyên; chữ thường không ghép", () => {
  assert.equal(fake.extract("cho em hop PAR 500 nhe").productCode, "PAR500");
  assert.equal(fake.extract("con PAR500 khong").productCode, "PAR500");
  assert.equal(fake.extract("uong 2 vien 500 mg nhe").productCode, "", "chữ thường + số không phải mã");
});

test("giày: 'Áo IM 7681 size A/XL' → mã IM7681 (dạng liền, không còn khoảng trắng)", () => {
  assert.equal(shoes.extract("Áo IM 7681 size A/XL").productCode, "IM7681");
  assert.equal(shoes.extract("con ma IM 7681-001 khong").productCode, "IM7681-001");
});

test("giày: tin hai dòng 'JP9252 size 43 1/3' + 'Áo IM 7681 size A/XL' → đọc từng dòng ra đúng mã của dòng đó", () => {
  const lines = "JP9252 size 43 1/3\nÁo IM 7681 size A/XL".split("\n");
  assert.deepEqual(lines.map((l) => shoes.extract(l).productCode), ["JP9252", "IM7681"]);
  assert.equal(shoes.extract(lines[0]!).size, "43 1/3");
});

test("giày: 'còn IM7681 không em' giữ dạng liền; 'mình lấy size 42 2026 nhé' / 'so 1234' không có mã", () => {
  assert.equal(shoes.extract("còn IM7681 không em").productCode, "IM7681");
  assert.equal(shoes.extract("mình lấy size 42 2026 nhé").productCode, "");
  assert.equal(shoes.extract("so 1234 nha shop").productCode, "");
  assert.equal(shoes.extract("số 1234 nha shop").productCode, "");
});

test("giày: mã gõ cách không để lại phần số trong gợi ý tên mẫu", () => {
  const e = shoes.extract("Áo IM 7681 size A/XL");
  assert.doesNotMatch(e.productName, /7681|\bim\b/, e.productName);
});

test("lưới chung (ngành không khai hình mã) cũng trả mã dạng liền", () => {
  const plain = new B.EntityExtractor(B.loadEntityConfig("nha-thuoc"), { brands: [], aliases: {}, productCodePatterns: [] });
  assert.equal(plain.extract("con XY 2040 khong").productCode, "XY2040");
});
