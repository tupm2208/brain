// Bộ đo nhận ảnh khách thật (01/10/2026): chạy ĐÚNG mã đọc ảnh + so ảnh catalog của bộ não (bản build)
// với model thật và kho thật của từng landing, đối chiếu đáp án ở bo-do-anh/dap-an.json.
// Chạy: node bo-nao/scripts/do-nhan-anh.mjs [--lan 2] [--ca pegasus-41-sadida] [--model ag/gemini-3.8-flash-low]
// Cần: bo-nao/.env (XEON_AI_CHAT_URL, XEON_AI_CHAT_KEY, XEON_AI_CHAT_MODEL), du-lieu/ (khoá ký vé, license). Tốn token.
//
// Chấm theo AN TOÀN (anh chốt 01/10: sửa nền cho mọi trường hợp, không chỉnh lời dặn cho trúng từng ca):
//   NGUY HIỂM = một mã khác đời bị xếp "cùng mẫu" (bot sẽ chào nhầm), hoặc khẳng định chắc "kho không có" khi kho CÓ,
//               hoặc đọc ra DÒNG khác mà hệ thống không tự biết là chưa xác nhận (bot sẽ gọi sai tên dòng);
//   CHƯA CHẮC = hệ thống tự biết mình chưa chắc / thiếu một phần và mời khách xác nhận — an toàn, tốn một câu hỏi;
//   ĐÚNG      = đủ và không lẫn.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const boNao = path.resolve(here, "..");
const require = createRequire(path.join(boNao, "package.json"));
const xeon = require(path.join(boNao, "packages", "xeon", "dist", "index.js"));
const brain = require("@sp/brain");
const { sharpShrink } = require(path.join(boNao, "packages", "xeon", "dist", "brain", "image-shrink.js"));
const kit = require(path.join(boNao, "kit", "ve-may.js"));

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const env = Object.fromEntries(fs.readFileSync(path.join(boNao, ".env"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
for (const k of ["XEON_AI_CHAT_URL", "XEON_AI_CHAT_KEY"]) if (!env[k]) { console.error(`Thiếu ${k} trong bo-nao/.env`); process.exit(1); }

brain.usePackSource(new xeon.DiskPackSource());
const logger = { info: () => undefined, warn: (m) => console.warn("   ", m) };
const modelName = arg("model", env.XEON_AI_CHAT_MODEL);
const model = new xeon.OpenAiCompatChatModel({ baseUrl: env.XEON_AI_CHAT_URL, apiKey: env.XEON_AI_CHAT_KEY, model: modelName, logger });
console.log(`model: ${modelName || "(mặc định)"}`);

const khoaRiengPem = fs.readFileSync(path.join(boNao, "du-lieu", "xeon.ky.key.pem"), "utf8");
const khoaCongPem = fs.readFileSync(path.join(boNao, "du-lieu", "xeon.ky.pub.pem"), "utf8");
const keys = Object.values(JSON.parse(fs.readFileSync(path.join(boNao, "du-lieu", "license.json"), "utf8")).cacKey);

/** The landing's tools, called as the brain calls them (a service ticket signed with Xeon's key). */
function toolsOf(landing, shop) {
  const key = keys.find((k) => k.shop === shop);
  if (!key) throw new Error(`Không có key của shop ${shop} trong license`);
  const ticket = () => { const now = Date.now(); return kit.kyVe({ vai: "dich-vu", shop: key.shop, tenShop: key.tenShop, maMay: "xeon", tenMay: "xeon", manh: key.manh, truc: false, phatLuc: now, hetLuc: now + 3600e3 }, { khoaRiengPem, keyId: kit.keyIdCuaKhoaCong(khoaCongPem) }); };
  return {
    available: () => ["catalog.find", "catalog.matchImage"],
    call: async (ten, input) => {
      const r = await fetch(`${landing}/api/bo-nao/cong-cu`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ticket()}` }, body: JSON.stringify({ ten, input }) });
      const body = await r.json().catch(() => ({}));
      return body.ok ? { ok: true, data: body.data } : { ok: false, error: { message: body.error?.message ?? body.loi ?? `HTTP ${r.status}` } };
    }
  };
}

const dapAn = JSON.parse(fs.readFileSync(path.join(boNao, "bo-do-anh", "dap-an.json"), "utf8"));
const lan = Number(arg("lan", "1"));
const only = arg("ca", "");
const dem = { dung: 0, chuaChac: 0, nguyHiem: 0 };
for (const ca of dapAn.ca.filter((c) => !only || c.ten === only)) {
  const file = path.join(boNao, "bo-do-anh", ca.anh);
  // The intake reads https addresses only: the photo gets one, and the fetcher serves it from disk.
  const url = `https://bo-do-anh.local/${ca.anh}`;
  const fetcher = new xeon.ImageFetcher({
    fetch: async (u, init) => u === url ? { ok: true, status: 200, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => fs.readFileSync(file) } : fetch(u, { signal: init.signal, redirect: "follow" }),
    shrink: sharpShrink()
  });
  // 'docGia': every READING returns this line (a misreading on purpose); the comparison still sees the real photo.
  const forced = ca.docGia ? { ready: () => true, complete: async (messages, o) => (String(messages[1]?.content ?? "").startsWith("Nhận diện ảnh")
    ? { ok: true, text: JSON.stringify({ loai: "san_pham", ...ca.docGia, code: "", confidence: 0.9 }), model: "doc-gia" }
    : model.complete(messages, o)) } : model;
  const intake = new xeon.ImageIntake({ vision: forced, fetcher, logger, clock: { now: () => new Date() } });
  const binding = { gateway: { tools: toolsOf(ca.landing, ca.shop) } };
  for (let k = 0; k < lan; k++) {
    const t0 = Date.now();
    const r = await intake.read({ tenant: ca.shop, binding, photos: [{ url, at: new Date().toISOString() }], conversationId: "do-nhan-anh", text: brain.loadImageReadText("giay-chay"), compareText: brain.loadImageCompareText("giay-chay") });
    const ms = Date.now() - t0;
    const cmp = r?.soSanh ?? null;
    const same = (cmp?.cungPhienBan ?? []).map((c) => c.ten.toLowerCase());
    const maybe = (cmp?.coTheLa ?? []).map((c) => c.ten.toLowerCase());
    const nguy = [];
    for (const re of ca.phienBanKhong) if (same.some((n) => new RegExp(re, "i").test(n))) nguy.push(`xếp nhầm /${re}/ là cùng mẫu`);
    if (ca.phienBanCo.length > 0 && cmp?.chacChan && same.length === 0) nguy.push("khẳng định kho không có trong khi kho có");
    const thieu = ca.phienBanCo.filter((re) => !same.some((n) => new RegExp(re, "i").test(n)));
    // THE LINE: read as another line and not flagged as a guess; or the pictures "confirmed" another line.
    const dongRe = ca.dong ? new RegExp(ca.dong, "i") : null;
    const pinnedByCode = r?.chot?.ket === "tu_tin";
    if (dongRe && !pinnedByCode && r !== null && !dongRe.test(r.read.model) && !r.dongChuaChac) nguy.push(`đọc ra dòng khác (${r.read.model}) mà không tự biết`);
    if (dongRe && cmp?.dongXacNhan && cmp.cungDong.length > 0 && !cmp.cungDong.some((c) => dongRe.test(c.ten))) nguy.push(`xác nhận nhầm dòng: ${cmp.cungDong.map((c) => c.ten).join(" | ")}`);
    for (const re of ca.ghiChu ?? []) if (!new RegExp(re, "i").test(r?.note ?? "")) thieu.push(`ghi chú /${re}/`);
    // A case with a code printed on the photo: right = that code pinned (fingerprint / code read), or the only colour match.
    const pinned = r?.chot?.ket === "tu_tin" ? r.chot.ma : (cmp?.trungMau.length === 1 ? cmp.trungMau[0].ma : "");
    if (ca.maDung && pinned !== "" && pinned.toUpperCase() !== ca.maDung) nguy.push(`chốt nhầm mã ${pinned}`);
    const loai = nguy.length > 0 ? "NGUY HIỂM"
      : ca.maDung ? (pinned.toUpperCase() === ca.maDung ? "ĐÚNG" : "CHƯA CHẮC")
      : thieu.length > 0 || !cmp?.chacChan ? "CHƯA CHẮC" : "ĐÚNG";
    if (loai === "ĐÚNG") dem.dung += 1; else if (loai === "NGUY HIỂM") dem.nguyHiem += 1; else dem.chuaChac += 1;
    console.log(`${loai.padEnd(9)} ${ca.ten} lần ${k + 1} · ${(ms / 1000).toFixed(1)}s · đọc: ${r?.read.brand ?? ""} ${r?.read.model ?? ""}${r?.dongChuaChac ? " (dòng CHƯA XÁC NHẬN)" : ""} · cùng dòng: ${cmp?.dongXacNhan ? cmp.cungDong.length : "—"} · chốt: ${r?.chot?.ket === "tu_tin" ? r.chot.ma : "—"} · ứng viên ${cmp?.ungVien.length ?? 0} · cùng mẫu: ${same.join(" | ") || "—"}${maybe.length ? ` · có thể: ${maybe.join(" | ")}` : ""}`);
    if (loai !== "ĐÚNG") {
      console.log("      ", [...nguy, ...thieu.map((re) => (re.startsWith("ghi chú") ? `thiếu ${re}` : `chưa có /${re}/`))].join("; ") || "(chưa chắc)");
      console.log("       ghi chú:", (r?.note ?? "").slice(0, 400));
      if (r?.loi?.length) console.log("       lỗi:", r.loi.join("; "));
    }
  }
}
const tong = dem.dung + dem.chuaChac + dem.nguyHiem;
console.log(`\nĐÚNG ${dem.dung}/${tong} · CHƯA CHẮC (an toàn) ${dem.chuaChac}/${tong} · NGUY HIỂM ${dem.nguyHiem}/${tong}`);
