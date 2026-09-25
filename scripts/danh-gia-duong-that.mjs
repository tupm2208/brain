// ĐÁNH GIÁ ĐƯỜNG THẬT (24/09/2026): chạy kịch bản qua đúng đường tin thật của landing + Xeon,
// KHÔNG qua hộp cát và KHÔNG đụng Meta.
//
// Đường đi: kịch bản → (vé máy TRỰC do chính khoá ký Xeon cấp, như OMI) → landing
// POST /api/hop-thu/tin-vao (kênh "zalo", như OMI đọc màn Zalo) → landing đẩy /tin-den → Xeon gom
// tin 6–13 giây, đọc ảnh, agent → landing /api/hop-thu/gui → câu trả lời vào HÀNG CHỜ Zalo (cho-gui)
// và ghi vào hội thoại. Người trực (ở đây là kịch bản) đọc hội thoại, gửi tin tiếp theo nếu có, và
// ghi kết quả. Hồ sơ lượt trên Xeon (logs/ho-so) cũng được ghi như thật — `npm run chan-doan` xem được.
//
// Lịch sử (câu khách kèm ảnh thật + câu người trực) được NẠP với bot tắt, rồi bật bot và chỉ đẩy tin cuối —
// như Desk replay: bot thấy đủ ngữ cảnh và mỗi ca chỉ tốn một lượt AI. --nghi N: nghỉ N giây giữa hai ca.
// Mỗi kịch bản là một hội thoại "zalo:danh-gia-<ma>" riêng; hàng chờ Zalo KHÔNG được nhận (không có
// OMI nào gõ), nên không có gì gửi đi đâu.
//
// Chạy (ở gốc dự án):
//   node bo-nao/scripts/danh-gia-duong-that.mjs bo-nao/scripts/kich-ban-danh-gia-2.json [--cho 40]
//   node bo-nao/scripts/danh-gia-duong-that.mjs that --so 20 --ngay 10 --hat 5      (hội thoại thật, cắt như hộp cát)
// Cần: LANDING (mặc định http://127.0.0.1:4180), khoá ký Xeon ở bo-nao/du-lieu, sổ license.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const LANDING = process.env.LANDING || "http://127.0.0.1:4180";
const OUT = path.join(root, "logs", "danh-gia");
fs.mkdirSync(OUT, { recursive: true });
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const WAIT_S = Number(arg("cho", 90)); // gom tin 6–13s + đọc ảnh tới 45s + agent: 60s là hụt

// ---- vé máy trực, ký bằng khoá riêng của Xeon (chính là cách Xeon cấp vé cho OMI) ----
const kit = createRequire(path.join(root, "bo-nao", "package.json"))(path.join(root, "bo-nao", "kit", "ve-may.js"));
const khoaRiengPem = fs.readFileSync(path.join(root, "bo-nao", "du-lieu", "xeon.ky.key.pem"), "utf8");
const khoaCongPem = fs.readFileSync(path.join(root, "bo-nao", "du-lieu", "xeon.ky.pub.pem"), "utf8");
const ledger = JSON.parse(fs.readFileSync(path.join(root, "bo-nao", "du-lieu", "license.json"), "utf8"));
const key = Object.values(ledger.cacKey)[0];
const may = key.may.find((m) => m.maMay === key.mayTruc) ?? key.may[0];
const now = Date.now();
const ticket = kit.kyVe({ vai: "quan-tri", shop: key.shop, tenShop: key.tenShop, maMay: may.maMay, tenMay: "danh-gia", manh: key.manh, truc: true, phatLuc: now, hetLuc: now + 6 * 3600 * 1000 }, { khoaRiengPem, keyId: kit.keyIdCuaKhoaCong(khoaCongPem) });

async function landing(method, route, body) {
  const r = await fetch(`${LANDING}${route}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${ticket}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (s) => String(s ?? "").replace(/\b0\d{9,10}\b/g, "0xxxxxxxxx");

/** Tên người trực giả trong đợt đánh giá — phải nằm trong `nguoiCuaShop` để landing xếp lời đó là lời shop. */
const STAFF = "danh-gia-shop";
/** Câu shop trong lịch sử thật do BOT Desk viết thì nạp với tác giả này để bộ não dán nhãn "bot — không phải nguồn sự thật". */
const BOT = "bo-nao";
/** Chữ ký bot của Desk (`looksLikeBotText`, server.js): câu chào trợ lý AI, phiếu m-order, hoặc mở đầu "Dạ" dài ≥60 ký tự. */
const looksLikeBot = (t) => /trợ lý AI|m-order\.html|để em gọi anh Dũng vào lên đơn|🧾 \[Thẻ SP\]/i.test(t) || (/^D[ạa]\s/.test(t) && t.length >= 60);

/** Đẩy một tin khách vào landing như OMI đọc từ Zalo. */
async function push(nguoi, chu, anh = [], luc = new Date().toISOString()) {
  const maTin = `dg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const r = await landing("POST", "/api/hop-thu/tin-vao", { kenh: "zalo", nguoi, tenNguoi: "Khách đánh giá", chu, maTin, soAnh: anh.length, anh, luc });
  if (r.status !== 200) throw new Error(`tin-vao ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return maTin;
}

/** Nạp một câu người trực đã nói (từ lịch sử thật) — đi qua đúng cửa "người của shop nói trong nhóm Zalo". */
async function pushStaff(nguoi, chu, luc) {
  const maTin = `dgs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const author = looksLikeBot(chu) ? BOT : STAFF;
  const r = await landing("POST", "/api/hop-thu/tin-vao", { kenh: "zalo", nguoi, tenNguoi: `Nhóm · ${author}`, chu, maTin, soAnh: 0, anh: [], luc });
  if (r.status !== 200) throw new Error(`tin-vao (shop) ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  if (!r.body?.cuaShop) throw new Error(`landing không nhận "${STAFF}" là người của shop — kiểm cấu hình nguoiCuaShop`);
}

/** Tắt/bật bot cho một hội thoại (Đ6) — lúc nạp lịch sử thì tắt để bot không trả lời từng dòng cũ. */
async function setBot(maHoiThoai, mode) {
  const r = await landing("POST", `/api/hop-thu/hoi-thoai/${encodeURIComponent(maHoiThoai)}/thong-tin`, { bot: mode });
  if (r.status !== 200) throw new Error(`thong-tin bot=${mode} ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
}

/** Đảm bảo tên người trực giả nằm trong danh sách người của shop. */
async function ensureStaffName() {
  const current = (await landing("GET", "/api/hop-thu/cau-hinh")).body?.cauHinh?.nguoiCuaShop ?? [];
  const missing = [STAFF, BOT].filter((n) => !current.some((c) => String(c).toLowerCase() === n));
  if (missing.length === 0) return;
  const r = await landing("POST", "/api/hop-thu/cau-hinh", { nguoiCuaShop: [...current, ...missing] });
  if (r.status !== 200) throw new Error(`cau-hinh ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
}

/** Chuẩn "shop thật" chỉ là 👍/ok/câu chào thì không dùng để so — đánh dấu để bảng kết quả bỏ qua. */
function weakReference(s) {
  const t = String(s ?? "").trim();
  return t.length < 12 || /^[\p{Emoji}\s👍ok.]+$/iu.test(t) || /xin chào|chào (anh|chị|bạn)|em là trợ lý/i.test(t);
}

/** Chờ tới khi hội thoại có tin đi mới hơn `sau`, hoặc hết giờ. */
async function waitReply(maHoiThoai, sinceIso) {
  const deadline = Date.now() + WAIT_S * 1000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const r = await landing("GET", `/api/hop-thu/hoi-thoai/${encodeURIComponent(maHoiThoai)}`);
    const tin = r.body?.hoiThoai?.tin ?? [];
    const out = tin.filter((m) => m.chieu === "di" && m.luc > sinceIso);
    if (out.length > 0) return { traLoi: out.map((m) => m.chu).join("\n"), boi: out[0].boi, trangThai: out[0].trangThai };
  }
  return { traLoi: "", boi: "", trangThai: "het-gio" };
}

async function humanQueue() {
  const r = await landing("GET", "/api/hop-thu/can-nguoi");
  return (r.body?.muc ?? []).map((m) => ({ maHoiThoai: m.maHoiThoai, lyDo: m.lyDo }));
}

async function runCases(cases, name) {
  // Người trực: bot phải được tự trả lời — kiểm cấu hình vận hành trước.
  const ops = (await landing("GET", "/api/ai/van-hanh")).body?.vanHanh ?? {};
  if (ops.cheDoTraLoi !== "auto" || ops.nguoiTruc || ops.epNguoi) {
    console.log(`Cấu hình vận hành: ${JSON.stringify(ops)} → chuyển sang tự động để bot tự trả lời (người trực tắt) cho đợt đánh giá.`);
    await landing("POST", "/api/ai/van-hanh", { cheDoTraLoi: "auto", nguoiTruc: false, epNguoi: false });
  }
  await ensureStaffName();
  const results = [];
  const NGHI_MS = Number(arg("nghi", 0)) * 1000;
  for (const c of cases) {
    const nguoi = `danh-gia-${name}-${c.ma}-${Date.now().toString(36).slice(-4)}`;
    const maHoiThoai = `zalo:${nguoi}`;
    process.stdout.write(`${c.ma} … `);
    const started = Date.now();
    // Lịch sử được NẠP như Desk replay: cả câu khách (kèm ảnh thật) lẫn câu người trực, bot tắt trong lúc nạp,
    // nên chỉ tin cuối mới được bot trả lời — không đốt quota, không mất ngữ cảnh shop đã nói gì.
    const history = c.lichSu ?? [];
    let botOff = false;
    for (let i = 0; i < history.length; i += 1) {
      const m = history[i];
      // Kịch bản tự dựng không có mốc giờ: giãn 10 phút/dòng, dòng cuối ≥10 phút trước — nếu để "vài phút
      // trước" thì câu người trực giả khiến bot tưởng người trực đang trả lời (<5 phút) nên im (kb2-05/06/14/20).
      const luc = m.luc || new Date(Date.now() - (history.length - i + 1) * 10 * 60_000).toISOString();
      if (m.ai === "shop") { await pushStaff(nguoi, m.chu, luc); }
      else {
        // Chưa có hội thoại thì chưa tắt bot được: dòng khách đầu tiên đẩy với mốc giờ cũ (>24h) để landing chỉ lưu, không hỏi bot.
        const stale = new Date(Math.min(Date.parse(luc) || Date.now(), Date.now() - 30 * 3600_000)).toISOString();
        await push(nguoi, m.chu, m.anh ?? [], botOff ? luc : stale);
      }
      if (!botOff) { await setBot(maHoiThoai, "off"); botOff = true; }
    }
    if (botOff) await setBot(maHoiThoai, "auto");
    const since = new Date().toISOString();
    const anh = c.anh ?? [];
    await push(nguoi, c.chu, anh);
    const reply = await waitReply(maHoiThoai, since);
    const turns = [{ khach: mask(c.chu) + (anh.length ? ` [gửi ${anh.length} ảnh]` : ""), bot: reply.traLoi, boi: reply.boi, trangThai: reply.trangThai }];
    const human = (await humanQueue()).filter((h) => h.maHoiThoai === maHoiThoai);
    results.push({ ...c, maHoiThoai, luot: turns, chuanYeu: weakReference(c.shopThucTe), canNguoi: human.length > 0, lyDoCanNguoi: human.map((h) => h.lyDo).join("; "), ms: Date.now() - started });
    console.log(`${reply.trangThai} ${Date.now() - started}ms → ${String(reply.traLoi || "(không có câu trả lời)").slice(0, 90)}${human.length ? " [CẦN NGƯỜI]" : ""}`);
    if (NGHI_MS > 0) await sleep(NGHI_MS);
  }
  const file = path.join(OUT, `duong-that-${name}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 1));
  console.log(`Đã ghi ${results.length} ca vào ${file}`);
}

const mode = process.argv[2];
if (mode === "that") {
  const { realCases } = await import("./danh-gia-chatbot.mjs");
  await runCases(realCases(Number(arg("so", 20)), Number(arg("ngay", 10))), "that");
} else if (mode && fs.existsSync(mode)) {
  await runCases(JSON.parse(fs.readFileSync(mode, "utf8")), path.basename(mode, ".json"));
} else { console.error("Dùng: <tệp kịch bản.json> | that [--so N --ngay D --hat S]"); process.exit(1); }
