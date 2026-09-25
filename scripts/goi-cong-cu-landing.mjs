// Gọi thẳng một công cụ của landing như bộ não gọi (vé dịch vụ ký bằng khoá Xeon) — để chẩn đoán.
// Chạy: node bo-nao/scripts/goi-cong-cu-landing.mjs catalog.matchImage '{"anh":"https://…","maDocDuoc":"JQ8077"}'
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LANDING = process.env.LANDING || "http://127.0.0.1:4180";
const kit = createRequire(path.join(root, "bo-nao", "package.json"))(path.join(root, "bo-nao", "kit", "ve-may.js"));
const khoaRiengPem = fs.readFileSync(path.join(root, "bo-nao", "du-lieu", "xeon.ky.key.pem"), "utf8");
const khoaCongPem = fs.readFileSync(path.join(root, "bo-nao", "du-lieu", "xeon.ky.pub.pem"), "utf8");
const key = Object.values(JSON.parse(fs.readFileSync(path.join(root, "bo-nao", "du-lieu", "license.json"), "utf8")).cacKey)[0];
const now = Date.now();
const ticket = kit.kyVe({ vai: "dich-vu", shop: key.shop, tenShop: key.tenShop, maMay: "xeon", tenMay: "xeon", manh: key.manh, truc: false, phatLuc: now, hetLuc: now + 3600 * 1000 }, { khoaRiengPem, keyId: kit.keyIdCuaKhoaCong(khoaCongPem) });
const [ten, input] = [process.argv[2], JSON.parse(process.argv[3] || "{}")];
const r = await fetch(`${LANDING}/api/bo-nao/cong-cu`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ticket}` }, body: JSON.stringify({ ten, input }) });
console.log(r.status, JSON.stringify(await r.json()).slice(0, 1500));
