/**
 * chan-doan — tra và diễn lại một lượt bot đã trả lời khách.
 *
 *   node scripts/chan-doan.mjs tim "đôi này còn không" [--gio 24] [--hong] [--sau]
 *   node scripts/chan-doan.mjs gan-day [--shop x] [--gio 2] [--hong]
 *   node scripts/chan-doan.mjs hoi-thoai <maHoiThoai> [--stt N] [--day] [--prompt]
 *   node scripts/chan-doan.mjs dien-lai <maHoiThoai> [--stt N] [--model-that] [--pack <gói>]
 *   node scripts/chan-doan.mjs dong-bai <maHoiThoai> [--stt N] [--ten x] [--ghi-chu "..."]
 *   node scripts/chan-doan.mjs vet <maVet>
 *   node scripts/chan-doan.mjs doi-hinh [--gio 24]
 *   node scripts/chan-doan.mjs keo-log --shop x
 *   node scripts/chan-doan.mjs xoa --shop x
 *
 * Đọc hồ sơ lượt ở XEON_HO_SO_THU_MUC (bật bằng biến đó; xem KE-HOACH-NHAT-KY-CHAN-DOAN.md).
 *
 * CỬA VÀO THẬT là `tim` và `gan-day`: lúc shop kêu, họ có tên khách và giờ, không có mã hội thoại.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  CASE_DIRECTORY, CaseNotReproducible, DiskDossierStore, LandingLogStore, MeteredChatModel, OpenAiCompatChatModel,
  PriceTable, UsageLedger,
  agentProfileOf, configFromEnv, consoleLogger, installIndustryPacks, loadEnvFile, makeCase, renderDossier, renderFound,
  pathWord, replayTurn, systemClock
} from "../packages/xeon/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFile(path.join(root, ".env"), process.env);
const config = configFromEnv(process.env, path.join(root, "du-lieu"));
// Các gói ngành nằm ở `nganh/` dạng JSON; `dien-lai --pack` đổi gói nên phải nạp nguồn trước.
installIndustryPacks(config.industryDirectory);
// Đường dẫn lấy từ gói xeon, không chép lại ở đây (xem CASE_DIRECTORY).

const argv = process.argv.slice(2);
const command = argv[0] ?? "";
const positional = argv.slice(1).filter((a) => !a.startsWith("--") && !isFlagValue(a));
function isFlagValue(arg) {
  const at = argv.indexOf(arg);
  return at > 0 && argv[at - 1].startsWith("--");
}
const flag = (name) => {
  const at = argv.indexOf(`--${name}`);
  if (at < 0) return undefined;
  const next = argv[at + 1];
  return next === undefined || next.startsWith("--") ? "" : next;
};
const has = (name) => argv.includes(`--${name}`);
const num = (name) => {
  const raw = flag(name);
  return raw === undefined || raw === "" ? undefined : Number(raw);
};

function die(message) {
  console.error(message);
  process.exit(1);
}

if (config.dossierDirectory === "") {
  die("Hồ sơ lượt đang TẮT: đặt XEON_HO_SO_THU_MUC trong bo-nao/.env rồi chạy lại.\nXem KE-HOACH-NHAT-KY-CHAN-DOAN.md.");
}

const store = new DiskDossierStore({
  root: path.resolve(root, config.dossierDirectory),
  clock: systemClock,
  logger: consoleLogger
});

/** Nhật ký hạ tầng các landing đẩy lên. Chưa bật thì các lệnh cần nó nói rõ, không im lặng. */
const landingLogs = config.landingLogDirectory === "" ? null : new LandingLogStore({
  root: path.resolve(root, config.landingLogDirectory), clock: systemClock, logger: consoleLogger
});
function canLandingLogs() {
  if (landingLogs === null) die("Lệnh này cần kho nhật ký landing: đặt XEON_NHAT_KY_THU_MUC trong bo-nao/.env.");
  return landingLogs;
}

/** Model thật — chỉ dựng khi có --model-that, để lệnh thường không cần khoá. */
function realModel() {
  if (config.agentChatUrl === "" || config.agentChatKey === "") {
    die("--model-that cần XEON_AI_CHAT_URL + XEON_AI_CHAT_KEY trong bo-nao/.env.");
  }
  const ledger = new UsageLedger(config.dataDirectory, new PriceTable(config.dataDirectory));
  return new MeteredChatModel(
    new OpenAiCompatChatModel({ baseUrl: config.agentChatUrl, apiKey: config.agentChatKey, model: config.agentChatModel, logger: consoleLogger }),
    ledger, systemClock, config.agentChatModel || "khong-ro"
  );
}

const cut = (text, n = 300) => {
  const s = String(text ?? "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

const searchOptions = () => ({
  shop: flag("shop"),
  hours: num("gio"),
  hong: has("hong") ? true : undefined,
  limit: num("so") ?? 30
});

async function locate(conversationId, stt) {
  const found = await store.findByConversation(conversationId, flag("shop"));
  if (found.length === 0) die(`Không thấy hồ sơ nào của hội thoại "${conversationId}".\nThử: node scripts/chan-doan.mjs tim "<chữ khách nhắn>"`);
  const picked = stt === undefined ? found[found.length - 1] : found.find((f) => f.row.stt === Number(stt));
  if (picked === undefined) die(`Hội thoại "${conversationId}" không có lượt số ${stt}. Có: ${found.map((f) => f.row.stt).join(", ")}.`);
  const dossier = await store.load(picked.shop, picked.row.tep);
  if (dossier === null) die(`Đọc không được tệp ${picked.row.tep}.`);
  return { shop: picked.shop, dossier, tatCa: found };
}

// ---- cửa vào ----------------------------------------------------------------------------------

async function tim() {
  const text = positional[0];
  if (!text) die('Thiếu chữ cần tìm: node scripts/chan-doan.mjs tim "đôi này còn không"');
  const options = { ...searchOptions(), text };
  // Mặc định tìm trong mục lục (nhanh). --sau mở từng hồ sơ: bắt được cả chữ nằm trong kết quả
  // công cụ hay trong câu đã bị chặn — chậm hơn nhiều.
  const found = has("sau") ? await store.searchDeep(options) : await store.search(options);
  console.log(renderFound(found));
  console.log(`\n${found.length} lượt${has("sau") ? " (tìm sâu)" : ""}. Xem một lượt: node scripts/chan-doan.mjs hoi-thoai <maHoiThoai> --stt <N>`);
}

async function ganDay() {
  const found = await store.search({ ...searchOptions(), hours: num("gio") ?? 2 });
  console.log(renderFound(found));
  const hong = found.filter((f) => f.row.ketCuc !== "da-tra-loi").length;
  console.log(`\n${found.length} lượt, ${hong} không trả lời được (dấu "!" đầu dòng).`);
}

async function hoiThoai() {
  const conversationId = positional[0];
  if (!conversationId) die("Thiếu mã hội thoại: node scripts/chan-doan.mjs hoi-thoai <maHoiThoai>");
  const stt = flag("stt");
  const { shop, tatCa } = await locate(conversationId, stt);
  // Không chỉ định lượt thì in cả hội thoại theo thứ tự — câu hỏi thường là "cả đoạn chat này".
  const rows = stt === undefined ? tatCa : tatCa.filter((f) => f.row.stt === Number(stt));
  const options = { full: has("day"), prompt: has("prompt") };
  for (const hit of rows) {
    const dossier = await store.load(hit.shop, hit.row.tep);
    if (dossier === null) continue;
    console.log(`\n${"─".repeat(78)}`);
    console.log(renderDossier(dossier, options));
  }
  console.log(`\n${"─".repeat(78)}`);
  console.log(`${rows.length}/${tatCa.length} lượt của ${shop}/${conversationId}.`);
  if (!has("day")) console.log("Thêm --day để xem đầy đủ, --prompt để xem prompt đã dựng.");
}

// ---- diễn lại ---------------------------------------------------------------------------------

function printSide(title, side) {
  console.log(`\n  ${title}`);
  console.log(`    bước  : ${side.buoc.join(" › ") || "—"} (${side.soBuoc})`);
  if (side.traLoi !== undefined) console.log(`    trả lời: ${cut(side.traLoi)}`);
  if (side.viSao !== undefined) console.log(`    hỏng vì: ${side.viSao}`);
}

async function dienLai() {
  const conversationId = positional[0];
  if (!conversationId) die("Thiếu mã hội thoại: node scripts/chan-doan.mjs dien-lai <maHoiThoai>");
  const { shop, dossier, tatCa } = await locate(conversationId, flag("stt"));

  console.log(`\nShop ${shop} · hội thoại ${dossier.maHoiThoai} · lượt ${dossier.stt}/${tatCa.length} · ${dossier.luc}`);
  console.log(`Khách: ${cut(dossier.tinKhach.chu)}`);
  if (dossier.agent === undefined) {
    die(`\nLượt này do ${pathWord(dossier.duongDi).toUpperCase()} trả lời (duongDi=${dossier.duongDi}), không có phần agent để diễn lại.`);
  }

  const options = {};
  const packId = flag("pack");
  if (packId) { options.agent = agentProfileOf(packId); console.log(`Thay gói ngành: ${dossier.agent.goiNganh} → ${packId}`); }
  if (has("model-that")) { options.model = realModel(); console.log(`Model THẬT: ${config.agentChatModel || "(mặc định)"} — lượt này sẽ tốn token.`); }
  else console.log(`Model giả, phát lại ${dossier.agent.traLoiModel.length} câu đã ghi.`);

  const result = await replayTurn(dossier, options);
  printSide("GỐC     ", result.goc);
  printSide("DIỄN LẠI", result.dienLai);

  if (result.giongNhau) {
    console.log("\n✓ GIỐNG NHAU.");
    if (!has("model-that") && !packId) console.log("  Hồ sơ trung thực: diễn lại đúng như lượt thật.");
    return;
  }
  console.log(`\n✗ KHÁC: ${result.khac.join("; ")}`);
  if (!has("model-that") && !packId) {
    // Không đổi gì mà vẫn khác: hồ sơ đang thiếu thứ lượt đó phụ thuộc vào.
    console.log("  Không đổi model cũng không đổi gói mà vẫn khác — HỒ SƠ THIẾU thứ gì đó, hoặc mã quanh agent đã đổi.");
  }
}

// ---- đóng bài ---------------------------------------------------------------------------------

async function dongBai() {
  const conversationId = positional[0];
  if (!conversationId) die("Thiếu mã hội thoại: node scripts/chan-doan.mjs dong-bai <maHoiThoai>");
  const { shop, dossier } = await locate(conversationId, flag("stt"));

  let file;
  try {
    file = await makeCase(dossier, { ten: flag("ten"), ghiChu: flag("ghi-chu") });
  } catch (error) {
    if (error instanceof CaseNotReproducible) die(`\n${error.message}`);
    throw error;
  }

  await fs.mkdir(CASE_DIRECTORY, { recursive: true });
  const target = path.join(CASE_DIRECTORY, `${file.ten}.json`);
  try {
    await fs.writeFile(target, JSON.stringify(file, null, 2), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") die(`Đã có bài "${file.ten}.json". Đặt tên khác bằng --ten.`);
    throw error;
  }

  console.log(`\n✓ Đã đóng bài: packages/xeon/test/luot-that/${file.ten}.json`);
  console.log(`  nguồn : ${shop}/${dossier.maHoiThoai}#${dossier.stt}`);
  console.log(`  mong đợi: ${cut(file.mongDoi.traLoi ?? file.mongDoi.viSao)}`);
  console.log("  Dữ liệu cá nhân đã thay bằng bút danh cố định (bài test sống mãi trong git).");
  console.log("  Chạy `npm test` để thấy nó trong bộ kiểm.");
  if (!file.ghiChu) console.log('  Nên thêm --ghi-chu "vì sao bài này đáng giữ" cho người đọc năm sau.');
}

// ---- hạ tầng: mã vết, đội hình, kéo log --------------------------------------------------------

async function vet() {
  const maVet = positional[0];
  if (!maVet) die("Thiếu mã vết: node scripts/chan-doan.mjs vet <maVet>");
  const logs = canLandingLogs();

  // Hai phía của cùng một sự cố: dòng hạ tầng landing đẩy lên, và lượt trả lời Xeon đã ghi.
  const dong = [];
  for (const shop of await logs.listShops()) {
    for (const line of await logs.read(shop, { vet: maVet })) dong.push({ shop, line });
  }
  const luot = [];
  // Không đặt limit: mã vết phải quét hết, một sự cố có thể nằm ở lượt cũ.
  for (const hit of await store.search()) {
    const dossier = await store.load(hit.shop, hit.row.tep);
    if (dossier?.maVet === maVet) luot.push({ shop: hit.shop, dossier });
  }

  if (dong.length === 0 && luot.length === 0) die(`Không thấy gì mang mã vết "${maVet}".`);
  console.log(`\nMÃ VẾT ${maVet} — ${dong.length} dòng landing, ${luot.length} lượt trả lời
`);
  for (const { shop, line } of dong) {
    // Giờ của chính landing: trong một mã vết, đó mới là thứ tự thật. `nhanLuc` (giờ Xeon nhận)
    // chỉ dùng để xếp giữa các shop khi có máy chạy sai đồng hồ.
    const luc = String(line.luc ?? line.nhanLuc ?? "").slice(0, 23).replace("T", " ");
    console.log(`  ${luc} [${shop}] ${line.muc ?? "?"} ${line.method ?? ""} ${line.duong ?? ""} ${line.status ?? ""} ${line.ms ?? ""}ms ${line.tomTat ?? ""}`.trimEnd());
  }
  for (const { shop, dossier } of luot) {
    console.log(`\n${"─".repeat(78)}`);
    console.log(renderDossier(dossier, { full: has("day") }));
    void shop;
  }
}

async function doiHinh() {
  const logs = canLandingLogs();
  const gio = num("gio") ?? 24;
  const shops = new Set([...await logs.listShops(), ...await store.listShops()]);
  if (shops.size === 0) die("Chưa có shop nào gửi nhật ký hay có hồ sơ lượt.");

  const now = Date.now();
  const hang = [];
  for (const shop of [...shops].sort()) {
    const lines = await logs.read(shop, { hours: gio });
    const cuoi = lines.at(-1);
    const nhipTim = cuoi ? Date.parse(String(cuoi.nhanLuc ?? cuoi.luc ?? "")) : NaN;
    const rows = await store.readIndex(shop);
    const luotGanDay = rows.filter((r) => now - Date.parse(r.luc) < gio * 3600_000);
    hang.push({
      shop,
      loi: lines.filter((l) => l.muc === "loi").length,
      canhBao: lines.filter((l) => l.muc === "canh-bao").length,
      nhipTim,
      luot: luotGanDay.length,
      luotHong: luotGanDay.filter((r) => r.ketCuc !== "da-tra-loi").length
    });
  }

  console.log(`\nĐỘI HÌNH LANDING — ${gio}h qua
`);
  console.log("  shop                 nhịp tim cuối        lỗi  c.báo   lượt  lượt hỏng");
  for (const h of hang) {
    const im = Number.isFinite(h.nhipTim) ? Math.round((now - h.nhipTim) / 60000) : null;
    // Một landing im quá lâu là dấu hiệu nó chết, chứ không phải nó ngoan.
    const nhip = im === null ? "CHƯA GỬI BAO GIỜ" : im > 60 ? `${im} phút trước ⚠` : `${im} phút trước`;
    console.log(`  ${h.shop.padEnd(20)} ${nhip.padEnd(20)} ${String(h.loi).padStart(4)} ${String(h.canhBao).padStart(6)} ${String(h.luot).padStart(6)} ${String(h.luotHong).padStart(10)}`);
  }
  console.log("\nMột shop im lâu mà trước đó vẫn gửi = nhiều khả năng landing đã chết — thử `chan-doan keo-log`.");
}

function keoLog() {
  // Làn cứu cuối: landing không khởi động nổi thì không HTTP nào trả lời và làn đẩy cũng tắt theo.
  // Dùng ftplib của Python — đúng cách cong-cu-anh đã làm, không thêm phụ thuộc npm nào.
  const envFile = flag("env") || "landing_ftp.env";
  const out = flag("ra") || path.join(root, "logs", "keo-ve", flag("shop") || "landing");
  const args = ["scripts/keo-log.py", "--env", envFile, "--ra", out];
  if (flag("thu-muc")) args.push("--thu-muc", flag("thu-muc"));
  if (flag("ngay")) args.push("--ngay", flag("ngay"));
  console.log(`Kéo nhật ký về ${out} …`);
  for (const python of ["python", "py", "python3"]) {
    const r = spawnSync(python, args, { cwd: root, stdio: "inherit" });
    if (r.error === undefined) process.exit(r.status ?? 0);
  }
  die("Không tìm thấy Python. Cài Python rồi chạy lại, hoặc gọi thẳng: python scripts/keo-log.py --help");
}

async function xoa() {
  const shop = flag("shop");
  if (!shop) die("Thiếu shop: node scripts/chan-doan.mjs xoa --shop <ten>");
  await store.forget(shop);
}

const commands = { "tim": tim, "gan-day": ganDay, "hoi-thoai": hoiThoai, "dien-lai": dienLai, "dong-bai": dongBai, "vet": vet, "doi-hinh": doiHinh, "keo-log": keoLog, "xoa": xoa };
const run = commands[command];
if (run === undefined) {
  console.log(`Lệnh: ${Object.keys(commands).join(", ")}\n`);
  console.log('  tim "<chữ>"        tìm theo chữ khách nhắn hoặc bot trả  [--shop --gio --hong --sau --so]');
  console.log("  gan-day            các lượt gần đây, đánh dấu lượt hỏng  [--shop --gio --hong --so]");
  console.log("  hoi-thoai <mã>     dựng lại cả hội thoại để đọc          [--stt --shop --day --prompt]");
  console.log("  dien-lai  <mã>     chạy lại lượt đó                      [--stt --shop --model-that --pack]");
  console.log("  dong-bai  <mã>     đóng lượt thành bài test cố định      [--stt --shop --ten --ghi-chu]");
  console.log("  vet <maVet>        ghép hai phía một sự cố hạ tầng          [--day]");
  console.log("  doi-hinh           cả đội landing: nhịp tim, lỗi, lượt hỏng [--gio]");
  console.log("  keo-log            FTP kéo tệp nhật ký về khi landing chết  [--env --ra --shop --ngay]");
  console.log("  xoa --shop <tên>   xoá toàn bộ hồ sơ của một shop");
  process.exit(command === "" ? 0 : 1);
}
try {
  await run();
} catch (error) {
  // Một tên gói sai, một tệp hỏng — nói thành câu, đừng phun stack vào mặt người dùng.
  die(`\n${error instanceof Error ? error.message : String(error)}`);
}
