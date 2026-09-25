// ĐÁNH GIÁ BỘ NÃO BA TẦNG bằng hội thoại thật và kịch bản tự dựng (24/09/2026).
//
// Hai nguồn, một đường chạy:
//   - THẬT: N hội thoại Facebook ngẫu nhiên trong 10 ngày qua, đọc từ kho lưu trữ của Desk
//     (D:\projects\toprun-sales-desk\data\facebook-message-archive — CHỈ ĐỌC, không đụng Desk).
//     Cắt tại tin CUỐI CÙNG của khách có chữ; lịch sử trước đó làm ngữ cảnh; câu trả lời thật của
//     shop (nếu có, ngay sau tin đó) giữ lại để so.
//   - KỊCH BẢN: tệp JSON các tình huống tự dựng (kich-ban-danh-gia.json).
// Mỗi ca gọi Xeon /ai/hop-cat (hộp cát: công cụ chỉ đọc, KHÔNG gửi khách, KHÔNG ghi trí nhớ) bằng
// mã nhận tin của landing, ghi lại câu bot + "AI nghĩ gì". Kết quả ra logs/danh-gia/<ten>-<luc>.json
// để người đọc chấm. Tên khách được che.
//
// Chạy (ở thư mục gốc dự án):
//   node bo-nao/scripts/danh-gia-chatbot.mjs that --so 20 --ngay 10
//   node bo-nao/scripts/danh-gia-chatbot.mjs kich-ban bo-nao/scripts/kich-ban-danh-gia.json
// Cần: XEON (mặc định http://127.0.0.1:4299) và MA_NHAN_TIN (không có thì đọc từ MySQL landing).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const XEON = process.env.XEON || "http://127.0.0.1:4299";
const ARCHIVE = process.env.DESK_ARCHIVE || "D:/projects/toprun-sales-desk/data/facebook-message-archive";
const OUT = path.join(root, "logs", "danh-gia");
fs.mkdirSync(OUT, { recursive: true });

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const mode = process.argv[2];

async function inboxToken() {
  if (process.env.MA_NHAN_TIN) return process.env.MA_NHAN_TIN;
  const require = createRequire(path.join(root, "server-khach", "package.json"));
  const mysql = require("mysql2/promise");
  const env = Object.fromEntries(fs.readFileSync(path.join(root, "server-khach", ".env"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
  const url = new URL(env.TOPRUN_MYSQL_URL);
  const conn = await mysql.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) });
  const [rows] = await conn.execute("SELECT noi_dung FROM so_du_lieu WHERE ten = ?", ["khung-nen-tang-xeon"]);
  await conn.end();
  return JSON.parse(rows[0].noi_dung).maNhanTin;
}

async function sandbox(token, lichSu, chu, anh = []) {
  const started = Date.now();
  const r = await fetch(`${XEON}/ai/hop-cat`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ lichSu, chu, anh }) });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ms: Date.now() - started, ...body };
}

/** Che tên riêng và số điện thoại trước khi ghi ra tệp. */
const mask = (s) => String(s ?? "").replace(/\b0\d{9,10}\b/g, "0xxxxxxxxx").replace(/\b\d{3}[ .]?\d{3}[ .]?\d{4}\b/g, "0xxxxxxxxx");

export function realCases(count, days) {
  const cut = Date.now() - days * 86400e3;
  // Chỉ mục là tệp nối thêm: một hội thoại xuất hiện nhiều dòng — giữ dòng mới nhất của mỗi hội thoại.
  const byKey = new Map();
  for (const l of fs.readFileSync(path.join(ARCHIVE, "threads-index.ndjson"), "utf8").trim().split("\n")) {
    try { const t = JSON.parse(l).thread; if (t && t.threadKey) byKey.set(t.threadKey, t); } catch { /* dòng hỏng */ }
  }
  const index = [...byKey.values()].filter((t) => Date.parse(t.lastMessageAt) >= cut && t.messageCount >= 2);
  // Ngẫu nhiên nhưng lặp lại được: trộn theo hạt giống cố định.
  let seed = Number(arg("hat", 20260924));
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const shuffled = [...index].sort(() => rnd() - 0.5);
  const cases = [];
  for (const t of shuffled) {
    if (cases.length >= count) break;
    const file = path.join(ARCHIVE, "threads", t.threadKey, "messages.ndjson");
    if (!fs.existsSync(file)) continue;
    // Tin cũng có thể được lưu nhiều lần — gộp theo khoá tin.
    const seenKeys = new Map();
    for (const l of fs.readFileSync(file, "utf8").trim().split("\n")) { try { const m = JSON.parse(l).message; if (m && m.createdAt) seenKeys.set(m.key || m.id, m); } catch { /* dòng hỏng */ } }
    const messages = [...seenKeys.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    // Tin cuối cùng của khách CÓ CHỮ và mới (trong khoảng ngày), sau khi đã có ít nhất một tin trước đó.
    let cutAt = -1;
    for (let i = messages.length - 1; i >= 1; i -= 1) {
      const m = messages[i];
      // Tin cuối của khách: có chữ, HOẶC chỉ có ảnh (ảnh giờ đọc được) — miễn là mới.
    if (!m.isFromPage && Date.parse(m.createdAt) >= cut && (String(m.text || "").trim().length >= 3 || (m.attachments ?? []).some((a) => a && a.type === "image"))) { cutAt = i; break; }
    }
    if (cutAt < 0) continue;
    const before = messages.slice(Math.max(0, cutAt - 12), cutAt);
    // Ảnh của tin cuối, và ảnh khách gửi trong 3 tin liền trước (chùm tin: ảnh rồi mới gõ chữ).
    const pics = (m) => (m.attachments ?? []).filter((a) => a && a.type === "image" && String(a.url ?? "").startsWith("https://")).map((a) => String(a.url));
    // Lịch sử giữ cả ảnh thật và mốc giờ của từng dòng, để đường thật nạp lại đúng như Desk đã thấy.
    const lichSu = before.map((m) => ({ ai: m.isFromPage ? "shop" : "khach", chu: mask(String(m.text || "").trim() || (m.attachments?.length ? `[gửi ${m.attachments.length} ảnh]` : "")), anh: m.isFromPage ? [] : pics(m), luc: m.createdAt })).filter((m) => m.chu);
    const after = messages.slice(cutAt + 1).find((m) => m.isFromPage && String(m.text || "").trim());
    const anhUrls = [...pics(messages[cutAt]), ...before.slice(-3).filter((m) => !m.isFromPage).flatMap(pics)].slice(0, 4);
    const anh = messages[cutAt].attachments?.length ?? 0;
    cases.push({ ma: `that-${cases.length + 1}`, nguon: t.threadKey.slice(0, 12), luc: messages[cutAt].createdAt, lichSu, chu: mask(String(messages[cutAt].text).trim()), soAnhGoc: anh, anh: anhUrls, shopThucTe: after ? mask(String(after.text).trim()) : "" });
  }
  return cases;
}

async function run(cases, name) {
  const token = await inboxToken();
  const results = [];
  for (const c of cases) {
    process.stdout.write(`${c.ma} … `);
    const r = await sandbox(token, c.lichSu, c.chu, c.anh ?? []);
    const out = { ...c, ket: { status: r.status, ms: r.ms, traLoi: r.traLoi ?? "", nguonTraLoi: r.nguonTraLoi ?? "", hanhDong: r.hanhDong ?? "", canNguoi: r.canNguoi ?? false, lyDo: r.lyDo ?? r.message ?? "", dauVet: (r.dauVet ?? []).map((b) => `${b.loai}:${b.ten}: ${String(b.chiTiet ?? "").slice(0, 400)}`) } };
    results.push(out);
    console.log(`${r.status} ${r.ms}ms → ${String(out.ket.traLoi || out.ket.lyDo).slice(0, 90)}`);
  }
  const file = path.join(OUT, `${name}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 1));
  console.log(`Đã ghi ${results.length} ca vào ${file}`);
}

const runDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) {
  if (mode === "that") await run(realCases(Number(arg("so", 20)), Number(arg("ngay", 10))), "that");
  else if (mode === "kich-ban") await run(JSON.parse(fs.readFileSync(process.argv[3], "utf8")), "kich-ban");
  else { console.error("Dùng: that [--so N --ngay D --hat S] | kich-ban <tệp.json>"); process.exit(1); }
}
