/**
 * LƯỢT THẬT — every case cut from a real bug, replayed on every `npm test`.
 *
 * A file lands here through `npm run chan-doan dong-bai <maHoiThoai>`, which pseudonymises the
 * customer's data and refuses to save a case that does not reproduce. From then on the case is a
 * regression test: with many landings the same mistake comes back at another shop, and this is
 * what stops it twice.
 *
 * The folder starts empty, and that is fine — this file says so rather than failing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { CASE_DIRECTORY, runCase, type CaseFile } from "@sp/xeon";

test("LƯỢT THẬT: mọi bài đóng từ bug thật vẫn diễn lại đúng", async (t) => {
  const names = (await fs.readdir(CASE_DIRECTORY).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort();
  if (names.length === 0) {
    t.diagnostic("chưa có bài nào — đóng bằng `npm run chan-doan dong-bai <maHoiThoai>`");
    return;
  }
  for (const name of names) {
    const file = JSON.parse(await fs.readFile(path.join(CASE_DIRECTORY, name), "utf8")) as CaseFile;
    await t.test(`${name} — ${file.ghiChu || file.nguon.shop}`, async () => {
      const outcome = await runCase(file);
      assert.ok(
        outcome.dat,
        `Bài "${file.ten}" không còn tái hiện được (${outcome.khac.join("; ")}).\n`
        + `  Nguồn: ${file.nguon.shop}/${file.nguon.maHoiThoai}#${file.nguon.stt} lúc ${file.nguon.luc}\n`
        + `  Mong đợi: ${file.mongDoi.traLoi ?? file.mongDoi.viSao}\n`
        + `  Đây là HỒI QUY: một thay đổi vừa rồi đã đổi cách bot xử ca này.`
      );
    });
  }
});
