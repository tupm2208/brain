/**
 * CONFIGURATION — `bo-nao/.env` is this repo's own file: it deploys alone, so nothing above it is read.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configFromEnv, loadEnvFile } from "@sp/xeon";

test("loadEnvFile: reads dotenv lines, quotes and comments; variables already set win; a missing file adds nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xeon-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, [
    "# ghi chu",
    "PORT=4299",
    "XEON_DIA_CHI=\"https://xeon.toprun.vn\"",
    "XEON_ADMIN_MAT_KHAU=tu-tep",
    "SHOP_JSON='{\"toprun\":{\"diaChi\":\"http://127.0.0.1:4181\",\"ma\":\"m\",\"nganh\":\"giay-chay\"}}'",
    ""
  ].join("\n"));

  const env: NodeJS.ProcessEnv = { XEON_ADMIN_MAT_KHAU: "tu-moi-truong" };
  assert.equal(loadEnvFile(file, env), 3);
  assert.equal(env["XEON_ADMIN_MAT_KHAU"], "tu-moi-truong");

  const config = configFromEnv(env, dir);
  assert.equal(config.port, 4299);
  assert.equal(config.xeonAddress, "https://xeon.toprun.vn");
  assert.equal(config.legacyShops["toprun"]?.diaChi, "http://127.0.0.1:4181");

  assert.equal(loadEnvFile(path.join(dir, "khong-co.env"), env), 0);
});
