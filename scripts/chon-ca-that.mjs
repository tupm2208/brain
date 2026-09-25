// Lấy vài ca thật theo mã (cùng hạt giống) ra một tệp, để chạy lại riêng những ca đã hỏng.
// Chạy: node bo-nao/scripts/chon-ca-that.mjs --hat 5 --so 20 --ngay 10 --chi that-17,that-18 --ra logs/danh-gia/lai.json
import fs from "node:fs";
import { realCases } from "./danh-gia-chatbot.mjs";
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const want = new Set(String(arg("chi", "")).split(",").map((s) => s.trim()).filter(Boolean));
const all = realCases(Number(arg("so", 20)), Number(arg("ngay", 10)));
const picked = all.filter((c) => want.size === 0 || want.has(c.ma));
fs.writeFileSync(arg("ra", "logs/danh-gia/ca-chon.json"), JSON.stringify(picked, null, 1));
console.log(`Đã chọn ${picked.length} ca: ${picked.map((c) => c.ma).join(", ")}`);
