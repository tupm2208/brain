// BÀN CÂN: cho Sales Desk cũ và bộ não mới cùng đọc MỘT CÂU KHÁCH THẬT, rồi đếm chỗ khác nhau.
//
// Vì sao cần: phần trả lời khách của bản mới được VIẾT LẠI chứ không chép (kế hoạch 14/09), nên
// không thể tin là "chắc vẫn thế". Vá từng lỗi khách kêu thì mãi không hết — phải đo được còn
// lệch bao nhiêu, lệch ở đâu, và mảng nào ảnh hưởng nhiều khách nhất.
//
//   node scripts/doi-chieu-desk.mjs --so 500
//   node scripts/doi-chieu-desk.mjs --so 2000 --ra logs/doi-chieu-<ngày>.md
//
// CHỈ ĐỌC hai bên: Desk chạy hàm `routeCustomerMessage` trong tiến trình này (không đụng tệp của
// Desk, không gọi mạng, không gọi model); bộ não mới chạy MÁY LUẬT với cổng giả (cũng không mạng).
// Câu khách lấy từ kho lưu trữ đã chuyển nhà (bảng `hop_thu_luu_tru_tin`), hoặc từ trí nhớ hội
// thoại của Desk nếu chưa có cơ sở dữ liệu đó.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const GOC = path.resolve(import.meta.dirname, "..");
const GOC_DU_AN = path.resolve(GOC, "..");
const DESK = process.env["NGUON_DESK_GOC"] || path.join("D:", "projects", "toprun-sales-desk");
const require = createRequire(path.join(GOC, "package.json"));

const co = (ten, macDinh) => {
  const i = process.argv.indexOf(`--${ten}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : macDinh;
};
const SO_CAU = Number(co("so", "300"));
const TEP_RA = co("ra", path.join(GOC, "logs", `doi-chieu-desk-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13)}.md`));

// ------------------------------------------------------------------ câu khách thật

async function layCauKhach(soCau) {
  // Cùng cơ sở bộ chuyển nhà dựng, nên đọc cùng một chỗ khai: biến môi trường, rồi chuyen-nha/.env.
  // Mật khẩu không nằm trong mã.
  let url = process.env["DICH_MYSQL_URL"] || "";
  try {
    const dong = fs.readFileSync(path.join(GOC_DU_AN, "chuyen-nha", ".env"), "utf8").split(/\r?\n/).find((d) => /^\s*DICH_MYSQL_URL\s*=/.test(d));
    if (!url && dong) url = dong.slice(dong.indexOf("=") + 1).trim();
  } catch { /* không có chuyen-nha/.env */ }
  try {
    if (!url) throw new Error("thiếu DICH_MYSQL_URL (biến môi trường hoặc chuyen-nha/.env)");
    const mysql = createRequire(path.join(GOC_DU_AN, "server-khach", "package.json"))("mysql2/promise");
    const u = new URL(url);
    const conn = await mysql.createConnection({
      host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password), database: decodeURIComponent(u.pathname.slice(1))
    });
    try {
      // Tin của KHÁCH, có chữ, không quá ngắn (một ký tự thì hai bên đều không quyết định gì),
      // mới nhất trước — việc hôm nay quan trọng hơn việc năm ngoái.
      const [rows] = await conn.query(
        `SELECT chu FROM hop_thu_luu_tru_tin
          WHERE chieu = 'den' AND chu <> '' AND CHAR_LENGTH(chu) BETWEEN 4 AND 300
          ORDER BY luc DESC LIMIT ?`, [soCau * 2]
      );
      const thay = new Set();
      const ra = [];
      for (const r of rows) {
        const chu = String(r.chu).replace(/\s+/g, " ").trim();
        const khoa = chu.toLowerCase();
        if (thay.has(khoa)) continue;
        thay.add(khoa);
        ra.push(chu);
        if (ra.length >= soCau) break;
      }
      if (ra.length) return { nguon: "kho lưu trữ tin nhắn (MySQL)", cau: ra };
    } finally { await conn.end(); }
  } catch { /* chưa có cơ sở dữ liệu — rơi xuống nguồn dưới */ }

  const tep = path.join(DESK, "data", "conversation_memory.json");
  const bo = JSON.parse(fs.readFileSync(tep, "utf8"));
  const thay = new Set();
  const ra = [];
  for (const h of Object.values(bo.conversations ?? {})) {
    for (const m of h.recentMessages ?? []) {
      if (m.role !== "customer") continue;
      const chu = String(m.text ?? "").replace(/\s+/g, " ").trim();
      if (chu.length < 4 || chu.length > 300 || thay.has(chu.toLowerCase())) continue;
      thay.add(chu.toLowerCase());
      ra.push(chu);
    }
  }
  return { nguon: "trí nhớ hội thoại của Desk", cau: ra.slice(0, soCau) };
}

// ------------------------------------------------------------------ bên cũ

function moDesk() {
  const router = createRequire(path.join(DESK, "package.json"))(path.join(DESK, "ai_router.js"));
  const store = JSON.parse(fs.readFileSync(path.join(DESK, "data", "store.json"), "utf8"));
  const kho = { ...store, products: store.landingProducts ?? store.products ?? [] };
  return (chu) => {
    try {
      const r = router.routeCustomerMessage({ message: chu, recentMessages: [] }, kho);
      return { yDinh: String(r?.intent?.intent ?? "?"), hanhDong: String(r?.decision?.action ?? "?"), viSao: String(r?.decision?.reason ?? "") };
    } catch (e) {
      return { yDinh: "LỖI", hanhDong: "LỖI", viSao: e instanceof Error ? e.message : String(e) };
    }
  };
}

// ------------------------------------------------------------------ bên mới (máy luật, không model)

function moBoNao() {
  const B = require(path.join(GOC, "packages", "brain", "dist", "index.js"));
  const thuMucNganh = path.join(GOC, "nganh");
  const doc = (id, tep) => {
    const duong = path.join(thuMucNganh, id, tep);
    return fs.existsSync(duong) ? JSON.parse(fs.readFileSync(duong, "utf8")) : null;
  };
  B.usePackSource({
    ids: () => fs.readdirSync(thuMucNganh, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
    read: (id) => {
      const rules = doc(id, "bo-luat.json");
      if (rules === null) return null;
      const agent = doc(id, "agent.json");
      return agent === null ? { rules } : { rules, agent };
    }
  });
  const pack = B.loadPack("giay-chay");
  // Luật "câu này phải để người thật" của bản mới — tính được ngay tại đây, không cần chạy agent.
  const boDau = (x) => String(x).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();
  const mauNguoiThat = pack.agent?.mustHumanPattern ? new RegExp(pack.agent.mustHumanPattern) : null;
  const soTriNho = new Map();
  const now = new Date();
  // Cổng giả: KHÔNG mạng, không model. Kho trả về rỗng — ta đang so QUYẾT ĐỊNH (ý định, hành động,
  // cổng nào chặn), không so câu chữ cuối cùng.
  const ports = {
    clock: { now: () => now },
    tools: {
      online: () => true,
      available: () => ["catalog.search", "stock.lookup", "order.lookup", "payment.status", "shipment.track", "storefront.link",
        "catalog.count", "variant.chart", "policy.get", "purchase.eta", "customer.recognize", "catalog.find",
        "shop.bankAccount", "conversation.recent", "training.knowledge"],
      call: async (tool) => {
        if (tool === "stock.lookup") return { ok: true, tool, data: { rows: [], asOf: now.toISOString(), truncated: false } };
        if (tool === "catalog.search" || tool === "catalog.find") return { ok: true, tool, data: { items: [], truncated: false } };
        if (tool === "catalog.count") return { ok: true, tool, data: { total: 4834 } };
        if (tool === "policy.get") return { ok: true, tool, data: { text: "" } };
        return { ok: true, tool, data: {} };
      }
    },
    catalog: { search: async () => [], size: async () => 4834 },
    memory: {
      load: async (_t, id) => soTriNho.get(String(id)) ?? null,
      save: async (s) => { soTriNho.set(String(s.conversationId), s); }
    }
  };
  return async (chu, i) => {
    try {
      const engine = new B.TurnEngine(pack, ports);
      const r = await engine.handle({ tenant: "toprun", conversationId: `ban-can:${i}`, text: chu, imageCount: 0, at: now.toISOString() });
      return {
        yDinh: String(r.intentId ?? "—"),
        hanhDong: String(r.action ?? "?"),
        cong: (r.gates ?? []).map((g) => g.rule).join(","),
        chanAgent: mauNguoiThat !== null && mauNguoiThat.test(boDau(chu))
      };
    } catch (e) {
      return { yDinh: "LỖI", hanhDong: "LỖI", cong: e instanceof Error ? e.message : String(e) };
    }
  };
}

// ------------------------------------------------------------------ chạy

const { nguon, cau } = await layCauKhach(SO_CAU);
console.log(`Bàn cân: ${cau.length} câu khách thật, lấy từ ${nguon}.\n`);
if (cau.length === 0) { console.error("Không lấy được câu nào."); process.exit(1); }

const hoiDesk = moDesk();
const hoiBoNao = moBoNao();

const dong = [];
for (let i = 0; i < cau.length; i += 1) {
  const chu = cau[i];
  const cu = hoiDesk(chu);
  const moi = await hoiBoNao(chu, i);
  dong.push({ chu, cu, moi });
  if ((i + 1) % 100 === 0) console.log(`  ... ${i + 1}/${cau.length}`);
}

// Bảng chéo: Desk quyết định gì → bộ não mới quyết định gì.
const cheo = new Map();
for (const d of dong) {
  const khoa = `${d.cu.yDinh} / ${d.cu.hanhDong}  →  ${d.moi.yDinh} / ${d.moi.hanhDong}`;
  const o = cheo.get(khoa) ?? { so: 0, viDu: [] };
  o.so += 1;
  if (o.viDu.length < 3) o.viDu.push(d.chu);
  cheo.set(khoa, o);
}
const sapXep = [...cheo.entries()].sort((a, b) => b[1].so - a[1].so);

// BA LỚP, tách riêng vì mỗi lớp là một loại thiệt hại khác nhau.
//  1. Desk trả lời bằng KỊCH BẢN hoặc CHUYỂN NGƯỜI — câu trả lời chắc chắn đúng, không cần model.
//     Bên mới không có kịch bản nào cho chính sách shop, nên đây là mất mát rõ ràng.
//  2. Desk đẩy sang AI của nó. Bên mới cũng có agent — coi như hoà, MIỄN LÀ agent được chạy.
//  3. Bên mới CHẶN agent (mustHuman) trong khi Desk vẫn trả lời: khách nhận câu mặc định của máy
//     luật, và không ai được báo. Đây là lớp tệ nhất.
const mayLuatKhongLo = (d) => d.moi.yDinh === "—" || d.moi.hanhDong === "ask_back";
const lop1 = dong.filter((d) => ["script_reply", "human_handoff"].includes(d.cu.hanhDong) && mayLuatKhongLo(d));
const lop2 = dong.filter((d) => d.cu.hanhDong === "ai_fallback_draft" && !d.moi.chanAgent);
const lop3 = dong.filter((d) => d.moi.chanAgent && d.cu.hanhDong !== "human_handoff");
const thiet = [...lop1, ...lop3];

console.log(`\nTOP CHÊNH LỆCH (Desk → bộ não mới):`);
for (const [khoa, o] of sapXep.slice(0, 12)) console.log(`  ${String(o.so).padStart(5)}  ${khoa}`);
const ptram = (n) => `${n}/${dong.length} (${Math.round(n / dong.length * 100)}%)`;
console.log(`
LỚP 1 — Desk có kịch bản/chuyển người, bên mới không có gì: ${ptram(lop1.length)}`);
console.log(`LỚP 2 — cả hai đẩy sang AI (hoà, nếu agent chạy được):       ${ptram(lop2.length)}`);
console.log(`LỚP 3 — bên mới CHẶN agent mà Desk vẫn trả lời:              ${ptram(lop3.length)}`);

fs.mkdirSync(path.dirname(TEP_RA), { recursive: true });
const md = [
  `# Bàn cân bộ não: Sales Desk cũ ↔ bộ não mới`, "",
  `${dong.length} câu khách thật, lấy từ ${nguon}. Chạy lúc ${new Date().toLocaleString("vi-VN")}.`, "",
  `| Lớp | Nghĩa | Số câu |`, `|---|---|---:|`,
  `| 1 | Desk trả lời bằng **kịch bản / chuyển người**, bên mới không có gì tương đương | ${lop1.length}/${dong.length} |`,
  `| 2 | Cả hai đẩy sang **AI** — hoà, miễn là agent bên mới được chạy | ${lop2.length}/${dong.length} |`,
  `| 3 | Bên mới **chặn agent** (\`mustHuman\`) trong khi Desk vẫn trả lời | ${lop3.length}/${dong.length} |`, "",
  `## Bảng chéo quyết định`, "",
  `| Số câu | Desk (ý định / hành động) | Bộ não mới (ý định / hành động) | Ví dụ |`,
  `|---:|---|---|---|`,
  ...sapXep.map(([khoa, o]) => {
    const [trai, phai] = khoa.split("  →  ");
    return `| ${o.so} | ${trai} | ${phai} | ${o.viDu.map((v) => v.replace(/\|/g, "/")).join(" · ").slice(0, 160)} |`;
  }),
  "", `## Câu Desk lo được mà bên mới bỏ rơi (${thiet.length})`, "",
  ...thiet.slice(0, 80).map((d) => `- *"${d.chu.replace(/\|/g, "/")}"* — Desk: \`${d.cu.yDinh}\` → \`${d.cu.hanhDong}\` (${d.cu.viSao}); mới: \`${d.moi.yDinh}\` → \`${d.moi.hanhDong}\``),
  ""
].join("\n");
fs.writeFileSync(TEP_RA, md, "utf8");
console.log(`\nBáo cáo: ${TEP_RA}`);
