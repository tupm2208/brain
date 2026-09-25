/**
 * @file Turning a dossier into something a person reads in one go.
 *
 * The output is for a terminal, and its order is the order of the question being asked: what the
 * customer said, what the bot was SHOWN, what it did step by step, what got blocked and why, what
 * finally went out. Anyone who has to jump around to reconstruct that has been handed a log, not
 * an explanation.
 *
 * Long values are cut for reading and the cut is announced (`… +N ký tự`) — never silently, or the
 * reader draws conclusions from half a tool result.
 */

import { renderHistory } from "../agent/sales-agent";
import type { FoundTurn } from "./disk-dossier-store";
import { pathWord } from "./replay";
import { replyOf, type TurnDossier } from "./turn-dossier";

export interface RenderOptions {
  /** Print everything at full length: tool results, prompts, history. */
  full?: boolean | undefined;
  /** Also print the resolved system prompt (long; off by default). */
  prompt?: boolean | undefined;
  /** How much of a long value to show when not `full`. */
  cut?: number | undefined;
}

const OUTCOME_WORDS: Record<string, string> = {
  "da-tra-loi": "đã trả lời",
  "chuyen-nguoi-that": "chuyển người thật",
  "im": "im (cố ý)",
  "hong": "HỎNG"
};

function short(value: unknown, limit: number | null): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  if (limit === null || text.length <= limit) return text;
  return `${text.slice(0, limit)}… +${text.length - limit} ký tự`;
}

function indent(text: string, pad = "    "): string {
  return text.split("\n").map((line) => `${pad}${line}`).join("\n");
}

/** The heading line of a turn: who, when, which path, how it ended. */
export function renderHeadline(dossier: TurnDossier, shop = dossier.shop): string {
  const outcome = OUTCOME_WORDS[dossier.ketCuc] ?? dossier.ketCuc;
  const why = dossier.viSao === undefined ? "" : ` (${dossier.viSao})`;
  return `Shop ${shop} · hội thoại ${dossier.maHoiThoai} · lượt ${dossier.stt} · ${dossier.luc}`
    + `\n${pathWord(dossier.duongDi).toUpperCase()} · ${outcome}${why} · ${dossier.msTong}ms`
    + (dossier.ban !== undefined ? ` · gói ${dossier.ban}` : "");
}

/** The whole turn, in the order the question is asked. */
export function renderDossier(dossier: TurnDossier, options: RenderOptions = {}): string {
  const limit = options.full === true ? null : (options.cut ?? 500);
  const out: string[] = [renderHeadline(dossier), ""];

  out.push("KHÁCH NHẮN");
  out.push(indent(dossier.tinKhach.chu || "(trống)"));
  if (dossier.tinKhach.soAnh > 0) out.push(indent(`[kèm ${dossier.tinKhach.soAnh} ảnh]`));

  // Version 2 (25/09/2026): what LLM#1 read and what the router decided, BEFORE any model wrote.
  // An older dossier has neither block; nothing is printed for it.
  if (dossier.phanTich !== undefined) {
    const a = dossier.phanTich;
    out.push("", `PHÂN TÍCH NGỮ CẢNH (LLM#1)${dossier.phanTichMs !== undefined ? ` · ${dossier.phanTichMs}ms` : ""}`);
    if (a === null) out.push(indent("(mô hình tắt hoặc không đọc được — bộ định tuyến chạy theo luật)"));
    else {
      out.push(indent(`ý định: ${a.intent} (${a.confidence})${Object.keys(a.entities).length > 0 ? ` · thực thể: ${short(a.entities, limit)}` : ""}`));
      if (a.contextSummary !== "") out.push(indent(`bối cảnh: ${short(a.contextSummary, limit)}`));
      if (a.episodeSummary !== "") out.push(indent(`phiên: ${short(a.episodeSummary, limit)}`));
      if (a.customerGoal !== "") out.push(indent(`mục tiêu khách: ${short(a.customerGoal, limit)}`));
      if (a.focus.product !== "") out.push(indent(`mẫu chính: ${a.focus.product}${a.focus.changed ? " (vừa đổi)" : ""}`));
      if (a.lookupCommands.length > 0) out.push(indent(`nên tra: ${short(a.lookupCommands, limit)}`));
      if (a.riskFlags.length > 0) out.push(indent(`rủi ro: ${a.riskFlags.join(", ")}`));
    }
  }
  const router = dossier.router;
  if (router !== undefined) {
    out.push("", `BỘ ĐỊNH TUYẾN · ${router.quyetDinh} (${router.lyDo}) · ý định ${router.yDinh.intent} (cục bộ ${router.yDinhCucBo.intent})`);
    out.push(indent(`đường ống: ${router.duongOng.join(" › ")}`));
    const said = Object.entries(router.thucThe).filter(([, v]) => v !== "" && v !== 0 && !(Array.isArray(v) && v.length === 0));
    if (said.length > 0) out.push(indent(`thực thể: ${short(Object.fromEntries(said), limit)}`));
    if (router.traLoi !== "") out.push(indent(`câu kịch bản: ${short(router.traLoi, limit)}${router.tuGui === false ? " (không tự gửi)" : ""}`));
    if (router.goiY !== "") out.push(indent(`gợi ý hỏi lại: ${short(router.goiY, limit)}`));
  }

  // Stage 3 / 4 (25/09/2026): what the landing was asked before any model wrote, and what it proved.
  if ((dossier.traCuu ?? []).length > 0) {
    out.push("", `TRA CỨU TRƯỚC LƯỢT (${dossier.traCuu!.length})`);
    for (const call of dossier.traCuu!) {
      out.push(indent(`${call.ten} ${short(call.vao, limit)} (${call.ms}ms)`, "  "));
      out.push(indent(call.loi !== undefined ? `✗ ${call.loi}` : `→ ${short(call.ra, limit)}`));
    }
  }
  const truth = dossier.suThat;
  if (truth !== undefined) {
    out.push("", `SỰ THẬT · bậc thang ${truth.bacThang || "—"}`);
    if (truth.khop !== undefined) out.push(indent(`khớp catalog: ${truth.khop.trangThai} (${truth.khop.lyDo})${truth.khop.canXacNhan ? " — PHẢI hỏi xác nhận trước khi báo giá" : ""}${truth.khop.ma.length > 0 ? ` · ${truth.khop.ma.join(", ")}` : ""}`));
    if (truth.chuaChac !== undefined) out.push(indent(`chưa chắc mẫu: ${truth.chuaChac}`));
    if (truth.mauChinh !== undefined) out.push(indent(`mẫu chính: ${truth.mauChinh.ma} ${truth.mauChinh.ten} (${truth.mauChinh.nguon})${truth.mauChinh.boDi ? ` — bỏ: ${truth.mauChinh.boDi}` : ""}`));
    if (truth.ton !== null) out.push(indent(`tồn: ${short(truth.ton, limit)}`));
    if (truth.donHang !== undefined) out.push(indent(`đơn: ${truth.donHang.maDon} — ${truth.donHang.trangThai}${truth.donHang.vanDon ? " · có vận đơn" : ""}${truth.donHang.doiSize !== undefined ? ` · đổi size: ${truth.donHang.doiSize ? "được" : "không"}` : ""}`));
    if (truth.khach !== undefined) out.push(indent(`khách: đã mua ${truth.khach.daMua} đơn${truth.khach.sizeHayMua.length > 0 ? `, size hay mua ${truth.khach.sizeHayMua.join(", ")}` : ""}`));
  }

  const agent = dossier.agent;
  if (agent !== undefined) {
    out.push("", `LỊCH SỬ ĐƯA VÀO MODEL (${agent.luot.history.length} dòng, model ${agent.model || "?"})`);
    out.push(indent(short(renderHistory(agent.luot.history), limit)));

    if ((agent.luot.extraContext ?? "").trim() !== "") {
      out.push("", "GHI CHÚ ĐƯA VÀO MODEL (kiến thức shop dạy, sổ hội thoại, khung, ảnh, phân tích LLM#1)");
      out.push(indent(short(agent.luot.extraContext ?? "", limit)));
    }
    if (options.prompt === true) {
      out.push("", "PROMPT ĐÃ DỰNG");
      out.push(indent(short(agent.systemPrompt, limit)));
    }

    out.push("", `BƯỚC (${agent.soBuoc})`);
    if (agent.buoc.length === 0) out.push(indent("(không gọi công cụ nào)"));
    for (const step of agent.buoc) {
      if (step.tool !== undefined) {
        out.push(indent(`${step.step}. công cụ ${step.tool} ${JSON.stringify(step.args ?? {})}`, "  "));
        out.push(indent(`→ ${short(step.result ?? "", limit)}`));
        continue;
      }
      if (step.blocked !== undefined) {
        // The usual answer to "why did the bot say that" is right here.
        out.push(indent(`${step.step}. ✗ CHẶN: ${step.error}`, "  "));
        out.push(indent(`câu bị chặn: ${short(step.blocked, limit)}`));
        continue;
      }
      out.push(indent(`${step.step}. ✗ ${step.error}`, "  "));
      if (step.raw !== undefined) out.push(indent(`model trả: ${short(step.raw, limit)}`));
    }
    if (agent.viSao !== undefined) out.push("", `AGENT BỎ CUỘC: ${agent.viSao} — ${dossier.nhap !== undefined ? "soạn nháp (LLM#3)" : "máy luật"} nhận lượt`);
  }
  if (dossier.agent === undefined && (dossier.ghiChu ?? "").trim() !== "" && options.prompt === true) {
    out.push("", "GHI CHÚ ĐƯA VÀO MODEL");
    out.push(indent(short(dossier.ghiChu ?? "", limit)));
  }

  if (dossier.cauDaoMo === true) out.push("", "CẦU DAO CỔNG AI ĐANG MỞ — không mô hình nào chạy lượt này");
  if (dossier.anh !== undefined) {
    out.push("", `ẢNH KHÁCH · ${dossier.anh.soAnh} ảnh · loại ${dossier.anh.loai}${dossier.anh.thamChieu ? " · tham chiếu (đôi đang đi)" : ""}`);
    for (const e of dossier.anh.loi) out.push(indent(`✗ ${e}`));
  }
  const cong = dossier.cong;
  if (cong !== undefined) {
    out.push("", `CỔNG SOÁT (sau khi model viết) · ${cong.dauVet.length > 0 ? cong.dauVet.join(" › ") : "không sửa gì"}${cong.canNguoi ? ` · CẦN NGƯỜI (${cong.lyDo})` : ""}`);
    if (cong.goc !== cong.sua) {
      out.push(indent(`model viết: ${short(cong.goc, limit)}`));
      out.push(indent(`đã sửa   : ${short(cong.sua, limit) || "(bỏ, máy luật trả lời)"}`));
    }
  }
  const kem = dossier.guiKem;
  if (kem !== undefined) {
    const parts = [
      kem.the.length > 0 ? `thẻ ${kem.the.join(", ")}` : "",
      kem.linkLoc ? "link lọc" : "",
      kem.phieu ? `phiếu ${kem.phieu.items.map((i) => `${i.ma}/${i.size}`).join(", ")}${kem.phieu.chan ? ` (bị chặn: ${kem.phieu.chan})` : ""}` : "",
      kem.anhHuongDan ? "ảnh hướng dẫn đo chân" : "", kem.chaoAi ? "câu chào" : "", kem.goiNguoi ? "gọi người (khách chốt)" : ""
    ].filter((p) => p !== "");
    out.push("", `GỬI KÈM · ${parts.length > 0 ? parts.join(" · ") : "không"}`);
    if (kem.lyDo.length > 0) out.push(indent(kem.lyDo.join("; ")));
    if (kem.daGui !== undefined) out.push(indent(`landing đã gửi: ${short(kem.daGui, limit)}`));
  }

  const nhap = dossier.nhap;
  if (nhap !== undefined) {
    out.push("", `SOẠN NHÁP (LLM#3) · ý định ${nhap.yDinh}${nhap.model ? ` · model ${nhap.model}` : ""}`);
    if (nhap.traLoi !== undefined) out.push(indent(`câu nháp: ${short(nhap.traLoi, limit)}${nhap.canNguoi ? " (cần người)" : ""}${nhap.lyDo ? ` — ${nhap.lyDo}` : ""}`));
    if (nhap.viSao !== undefined) out.push(indent(`✗ ${nhap.viSao} — máy luật nhận lượt`));
    if (options.full === true && nhap.tho !== undefined) out.push(indent(`model trả: ${nhap.tho}`));
  }

  const rules = dossier.mayLuat;
  if (rules !== undefined) {
    out.push("", `MÁY LUẬT · hành động ${rules.hanhDong} · ý định ${rules.maYDinh ?? "—"}${rules.maHang ? ` · hàng ${rules.maHang}` : ""}`);
    out.push(indent(`trạng thái vào: ${short(rules.trangThaiVao, limit)}`));
    out.push(indent(`trạng thái ra : ${short(rules.trangThaiRa, limit)}`));
    if (rules.cong.length > 0) out.push(indent(`cổng: ${short(rules.cong, limit)}`));
  }

  const reply = replyOf(dossier);
  out.push("", dossier.ketCuc === "da-tra-loi" ? "ĐÃ GỬI KHÁCH" : `KHÔNG GỬI (${OUTCOME_WORDS[dossier.ketCuc] ?? dossier.ketCuc})`);
  out.push(indent(reply || "(không có câu nào)"));
  return out.join("\n");
}

/** A list of hits, newest first, one line each. */
export function renderFound(found: readonly FoundTurn[], options: { shop?: boolean | undefined } = {}): string {
  if (found.length === 0) return "(không có lượt nào khớp)";
  const withShop = options.shop !== false;
  return found.map(({ shop, row }) => {
    const mark = row.ketCuc === "da-tra-loi" ? " " : "!";
    const who = withShop ? `${shop} ` : "";
    const why = row.viSao === undefined ? "" : ` [${row.viSao}]`;
    return `${mark} ${row.luc.slice(0, 19).replace("T", " ")} ${who}${row.maHoiThoai}#${row.stt} ${row.duongDi}${why}\n`
      + `    khách : ${row.tin}\n`
      + `    bot   : ${row.traLoi ?? "—"}`;
  }).join("\n");
}
