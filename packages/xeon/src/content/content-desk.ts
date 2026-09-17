/**
 * @file THE CONTENT DESK (Đ8) — the three AI jobs of the Content screen that are not "write":
 * critique ("Phản biện"), optimise ("Tối ưu") and weekly trend research.
 *
 * Ported from Sales Desk `content_writer_kit.js` (three judges + the fix prompt) and
 * `content-trend-kit.js` (hot score 0–20 per model line). What changed on the way:
 *
 *   - NO SHOP IS HARD-CODED. Desk's prompts spoke as "anh Dũng, chủ shop TopRun"; here the voice
 *     comes from the shop's writing style (`phongCach`) that the landing sends with the request,
 *     exactly like the rules travel with the writing brief.
 *   - THE MACHINE RULES STAY ON THE LANDING. The landing runs its own rule check first and sends the
 *     result as `loiLuat`; the style judge may only cite THOSE as rule breaches. Desk learned this on
 *     12/09/2026 when a judge invented rule violations and locked 10/10 posts.
 *   - Pass mark as Desk settled it: all three say ĐẠT and the lowest score is at least 7.
 *
 * Nothing here stores anything or sends anything. The landing keeps the verdict on the post.
 */

import { withUsage } from "../ai/usage-context";
import type { BriefItem, WritingStyle } from "./brief";
import { styleBlock } from "./content-writer";
import type { TextModelPort } from "./text-model";

export const REVIEW_PASS_SCORE = 7;

/** One post as the judges see it. Field names are wire (the landing sends them). */
export interface ReviewPost {
  ma?: string | undefined;
  gio?: string | undefined;
  trang?: string | undefined;
  dangBai?: string | undefined;
  huongDan?: string | undefined;
  goc?: string | undefined;
  caption: string;
  chuAnh?: string | undefined;
  comment?: string | undefined;
  mon?: BriefItem[] | undefined;
}

export interface Finding { nhan: string; trich: string; lyDo: string; sua: string }
export interface JudgeVerdict { diem: number; ketLuan: "ĐẠT" | "CHƯA ĐẠT"; phatHien: Finding[]; tomTat: string }

export interface ReviewOutcome {
  chuyenMon: JudgeVerdict;
  giong: JudgeVerdict;
  dangBai: JudgeVerdict;
  dat: boolean;
  ghiChu: string[];
}

export interface TrendLine {
  key: string;
  hang?: string | undefined;
  dong?: string | undefined;
  tenMau?: string[] | undefined;
  soMa?: number | undefined;
  tongTon?: number | undefined;
  giamToiDa?: number | undefined;
}

export interface TrendCard {
  key: string;
  dong: string;
  hang: string;
  hotScore: number;
  trendStatus: "rising" | "stable" | "cooling";
  trendReason: string;
  story: string;
  styling: string[];
  sampleCaptions: string[];
  confidence: number;
}

export type ContentDeskResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string; message: string };

const text = (v: unknown, n = 4000): string => String(v ?? "").trim().slice(0, n);

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    verdict: { type: "string", enum: ["ĐẠT", "CHƯA ĐẠT"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: { tag: { type: "string" }, quote: { type: "string" }, reason: { type: "string" }, fix: { type: "string" } },
        required: ["tag", "quote", "reason", "fix"], additionalProperties: false
      }
    },
    summary: { type: "string" }
  },
  required: ["score", "verdict", "findings", "summary"],
  additionalProperties: false
} as const;

const FIX_SCHEMA = {
  type: "object",
  properties: { caption: { type: "string" }, chuAnh: { type: "string" } },
  required: ["caption", "chuAnh"],
  additionalProperties: false
} as const;

const TREND_SCHEMA = {
  type: "object",
  properties: {
    models: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" }, modelLine: { type: "string" }, brand: { type: "string" }, hotScore: { type: "number" },
          trendStatus: { type: "string", enum: ["rising", "stable", "cooling"] }, trendReason: { type: "string" }, story: { type: "string" },
          styling: { type: "array", items: { type: "string" } }, sampleCaptions: { type: "array", items: { type: "string" } }, confidence: { type: "number" }
        },
        required: ["key", "hotScore", "trendStatus", "trendReason", "story", "styling", "sampleCaptions", "confidence", "modelLine", "brand"],
        additionalProperties: false
      }
    }
  },
  required: ["models"],
  additionalProperties: false
} as const;

/** Reads the model's JSON, tolerating a fence or a sentence around it. */
export function looseJson(raw: string): Record<string, unknown> | null {
  const body = text(raw, 200000);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(body);
  for (const candidate of [body, fenced?.[1] ?? "", body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1)]) {
    if (text(candidate) === "") continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* next candidate */ }
  }
  return null;
}

function productLines(items: BriefItem[] | undefined): string {
  const list = (items ?? []).filter((m) => text(m.ma) !== "");
  if (list.length === 0) return "(bài không gắn mã)";
  return list.map((m) => `- ${text(m.ma)}: ${text(m.ten)}${text(m.hang) === "" ? "" : ` (${text(m.hang)})`}${(m.size ?? []).length ? `, còn size ${(m.size ?? []).join(", ")}` : ""}`).join("\n");
}

function verdictOf(raw: Record<string, unknown> | null): JudgeVerdict {
  const o = raw ?? {};
  const score = Math.max(0, Math.min(10, Math.round(Number(o["score"]) * 10) / 10 || 0));
  const findings = (Array.isArray(o["findings"]) ? o["findings"] : []).slice(0, 12).map((f) => {
    const x = f !== null && typeof f === "object" ? (f as Record<string, unknown>) : {};
    return { nhan: text(x["tag"], 40), trich: text(x["quote"], 300), lyDo: text(x["reason"], 400), sua: text(x["fix"], 400) };
  });
  return { diem: score, ketLuan: text(o["verdict"]) === "ĐẠT" ? "ĐẠT" : "CHƯA ĐẠT", phatHien: findings, tomTat: text(o["summary"], 400) };
}

/** Desk `summarizeReview`: all three ĐẠT and the lowest score ≥ 7 (approved 12/09/2026). */
export function summarizeReview(review: { chuyenMon: JudgeVerdict; giong: JudgeVerdict; dangBai: JudgeVerdict }): ReviewOutcome {
  const judges: [string, JudgeVerdict][] = [["Chuyên môn", review.chuyenMon], ["Giọng", review.giong], ["Dạng bài", review.dangBai]];
  const dat = judges.every(([, v]) => v.ketLuan === "ĐẠT") && Math.min(...judges.map(([, v]) => v.diem)) >= REVIEW_PASS_SCORE;
  const ghiChu: string[] = [];
  for (const [who, v] of judges) if (v.tomTat !== "") ghiChu.push(`${who} ${v.diem}/10. ${v.tomTat}`);
  for (const [, v] of judges) {
    for (const f of v.phatHien.slice(0, 2)) ghiChu.push(`${f.nhan}: ${f.trich.slice(0, 90)}${f.sua === "" ? "" : ` → ${f.sua.slice(0, 90)}`}`);
  }
  return { ...review, dat, ghiChu: ghiChu.slice(0, 9) };
}

const SYS_JSON = "Trả lời JSON hợp lệ đúng lược đồ, không thêm chữ ngoài JSON.";

export function expertPrompt(post: ReviewPost, knowledge: string): { system: string; user: string } {
  return {
    system: `Bạn là chuyên gia sản phẩm, kiểm chứng kỹ thuật cho bài bán hàng tiếng Việt. ${SYS_JSON}`,
    user: [
      "SẢN PHẨM TRONG BÀI (dữ liệu shop, đúng tuyệt đối):", productLines(post.mon),
      knowledge === "" ? "" : `\nKIẾN THỨC NỘI BỘ (tham khảo):\n${knowledge.slice(0, 6000)}`,
      `\nBÀI CẦN KIỂM (${text(post.gio)} ${text(post.trang)}):\n"""${text(post.caption, 9000)}"""`,
      "\nNhiệm vụ: soi từng câu có thông số hoặc khẳng định kỹ thuật, đối chiếu dữ liệu.",
      "- \"SAI\" CHỈ dùng khi câu văn TRÁI với dữ liệu sản phẩm hoặc trái sự thật ai cũng kiểm được.",
      "- Thông tin đúng nhưng không có trong dữ liệu → \"KHÔNG KIỂM CHỨNG\", chỉ trừ điểm.",
      "- Bạn KHÔNG được tự đặt thêm luật cấm của shop.",
      `Trả JSON {score 0-10, verdict ĐẠT|CHƯA ĐẠT, findings[{tag SAI|KHÔNG KIỂM CHỨNG|MƠ HỒ|LOGIC, quote, reason, fix}], summary}. ĐẠT khi score ≥ ${REVIEW_PASS_SCORE} và không có tag SAI.`
    ].filter((l) => l !== "").join("\n")
  };
}

export function voicePrompt(post: ReviewPost, ruleErrors: string[], style: WritingStyle | undefined): { system: string; user: string } {
  const rules = ruleErrors.map((e) => `- ${text(e, 300)}`).join("\n");
  return {
    system: `Bạn là biên tập viên nội dung, đối chiếu giọng văn bài với phong cách của chủ shop. ${SYS_JSON}`,
    user: [
      styleBlock(style) || "Phong cách shop: người bán hàng thật nói chuyện với khách, có quan điểm riêng, không giọng quảng cáo.",
      `\nBÀI CẦN CHẤM (${text(post.gio)} ${text(post.trang)}; chữ trên ảnh: "${text(post.chuAnh, 300)}"):\n"""${text(post.caption, 9000)}"""`,
      `\nLỖI LUẬT DO MÁY QUÉT (toàn bộ vi phạm luật cứng của bài):\n${rules || "(máy quét xong, bài KHÔNG vi phạm luật cứng nào)"}`,
      "Bạn chỉ được gắn tag \"VI PHẠM LUẬT\" cho đúng những lỗi trong danh sách máy quét. Việc của bạn là chấm GIỌNG: có giống phong cách shop không, có quan điểm riêng không, có liệt kê máy móc không.",
      `Trả JSON {score 0-10, verdict, findings[{tag VI PHẠM LUẬT|GIỌNG AI|LOGIC GƯỢNG|DÀI DÒNG|THIẾU QUAN ĐIỂM|HOOK YẾU, quote, reason, fix}], summary}. ĐẠT khi score ≥ ${REVIEW_PASS_SCORE}.`
    ].join("\n")
  };
}

export function formatPrompt(post: ReviewPost): { system: string; user: string } {
  return {
    system: `Bạn là người duyệt dạng bài đăng Facebook cho shop. ${SYS_JSON}`,
    user: [
      `Dạng bài đã chọn: ${text(post.dangBai)} — ${text(post.huongDan, 600)}`,
      text(post.goc) === "" ? "" : `Góc mua: ${text(post.goc)}`,
      `Album = 1 ảnh chữ + card sản phẩm theo thứ tự mã: ${(post.mon ?? []).map((m) => text(m.ma)).join(", ")}. Chữ trên ảnh: "${text(post.chuAnh, 300)}".`,
      "Chữ trên ảnh được RÚT RA TỪ hook nên trùng phần mở đầu hook là ĐÚNG; chỉ lỗi khi nói gần hết hook hoặc chẳng liên quan.",
      `\nBÀI:\n"""${text(post.caption, 9000)}"""`,
      `\nKiểm: (1) đúng khung dạng bài; (2) hook khớp dạng bài; (3) mã khớp chủ đề và thứ tự; (4) độ dài hợp Facebook; (5) bình luận đầu có link và câu mời: """${text(post.comment, 1000)}""".`,
      `Trả JSON {score 0-10, verdict, findings[{tag THIẾU KHUNG|HOOK LỆCH|MÃ LỆCH|THỨ TỰ|ĐỘ DÀI|COMMENT, quote, reason, fix}], summary}. ĐẠT khi score ≥ ${REVIEW_PASS_SCORE}. findings CHỈ chứa lỗi cần sửa.`
    ].filter((l) => l !== "").join("\n")
  };
}

export function fixPrompt(post: ReviewPost, review: ReviewOutcome | null, ruleErrors: string[], style: WritingStyle | undefined): { system: string; user: string } {
  const findings: string[] = [];
  if (review !== null) {
    for (const [who, v] of [["chuyên môn", review.chuyenMon], ["giọng", review.giong], ["dạng bài", review.dangBai]] as const) {
      for (const f of v?.phatHien ?? []) findings.push(`[${who} · ${f.nhan}] «${f.trich.slice(0, 160)}» → ${f.lyDo.slice(0, 220)}${f.sua === "" ? "" : ` ⇒ sửa thành: ${f.sua.slice(0, 220)}`}`);
    }
  }
  return {
    system: `Bạn đang sửa lại bài Facebook của chính shop theo góp ý. ${SYS_JSON}`,
    user: [
      styleBlock(style),
      "\nSẢN PHẨM TRONG BÀI (không được đổi, không bịa thêm số liệu):", productLines(post.mon),
      text(post.goc) === "" ? "" : `Góc mua giữ nguyên: ${text(post.goc)}`,
      `\nBÀI HIỆN TẠI (${text(post.gio)} ${text(post.trang)}):\n"""${text(post.caption, 9000)}"""`,
      `\nGÓP Ý CẦN SỬA:\n${findings.slice(0, 20).map((l, i) => `${i + 1}. ${l}`).join("\n") || "(không có góp ý cụ thể, hãy tự siết lại giọng cho gần phong cách shop)"}`,
      ruleErrors.length === 0 ? "" : `\nLỖI LUẬT MÁY BẮT ĐƯỢC (bắt buộc phải hết):\n${ruleErrors.map((e) => `- ${text(e, 300)}`).join("\n")}`,
      "\nViết lại bài hoàn chỉnh, giữ chủ đề, dạng bài và bộ sản phẩm. Trả JSON {caption, chuAnh} — chuAnh là chữ in trên ảnh bìa, rút từ hook nhưng ngắn hơn hook."
    ].filter((l) => l !== "").join("\n")
  };
}

export function trendPrompt(lines: TrendLine[], context: string, shopNote: string): { system: string; user: string } {
  return {
    system: `Bạn là chuyên gia nghiên cứu xu hướng sản phẩm tại thị trường Việt Nam. ${SYS_JSON}`,
    user: [
      `Bối cảnh thời gian: ${context || "hiện tại"}.`,
      shopNote === "" ? "" : `Về shop: ${shopNote}`,
      "Nhiệm vụ: đánh giá độ hot HIỆN TẠI ở Việt Nam của từng dòng sản phẩm dưới đây.",
      "- hotScore là số nguyên 0-20: 18-20 cực hot; 13-17 hot ổn định; 8-12 bình thường; 0-7 nguội.",
      "- Không chắc thì hotScore 8-10 và confidence ≤ 0.5. CẤM bịa số liệu, sự kiện, năm tháng.",
      "- story là kiến thức thật về dòng; không biết rõ thì viết ngắn và an toàn.",
      "- Trả về đủ TẤT CẢ dòng, giữ nguyên key.",
      "\nDANH SÁCH:",
      JSON.stringify(lines.map((l) => ({ key: l.key, brand: l.hang ?? "", modelLine: l.dong ?? "", sampleNames: (l.tenMau ?? []).slice(0, 4), skuCount: l.soMa ?? 0, totalQty: l.tongTon ?? 0, maxDiscountPercent: l.giamToiDa ?? 0 })), null, 1)
    ].filter((l) => l !== "").join("\n")
  };
}

export interface ContentDeskOptions {
  model: TextModelPort;
}

export class ContentDeskService {
  constructor(private readonly options: ContentDeskOptions) {}

  private notReady(): { ok: false; status: number; error: string; message: string } | null {
    return this.options.model.ready() ? null : { ok: false, status: 503, error: "chua_co_mo_hinh", message: "Xeon chưa cấu hình mô hình viết bài." };
  }

  private async askJson(shop: string, agent: "content_review" | "content_optimize" | "content_trend", postId: string, prompt: { system: string; user: string }, schema: object, maxTokens = 4000): Promise<{ ok: true; json: Record<string, unknown>; model: string } | { ok: false; message: string }> {
    const outcome = await withUsage({ shop, agent, postId }, () => this.options.model.complete({ system: prompt.system, user: prompt.user, schema: schema as Record<string, unknown>, maxTokens }));
    if (!outcome.ok) return { ok: false, message: outcome.viSao };
    const json = looseJson(outcome.text);
    if (json === null) return { ok: false, message: "Mô hình trả về thứ không đọc được." };
    return { ok: true, json, model: outcome.model };
  }

  /** "Phản biện": three judges, one verdict. */
  async review(input: { tenant: string; bai: ReviewPost; loiLuat: string[]; phongCach?: WritingStyle | undefined; kienThuc?: string | undefined }): Promise<ContentDeskResult<ReviewOutcome & { model: string }>> {
    const refused = this.notReady();
    if (refused !== null) return refused;
    if (text(input.bai.caption) === "") return { ok: false, status: 400, error: "bai_rong", message: "Bài chưa có nội dung để phản biện." };
    const postId = text(input.bai.ma, 120);
    const [expert, voice, format] = await Promise.all([
      this.askJson(input.tenant, "content_review", postId, expertPrompt(input.bai, text(input.kienThuc, 6000)), VERDICT_SCHEMA),
      this.askJson(input.tenant, "content_review", postId, voicePrompt(input.bai, input.loiLuat, input.phongCach), VERDICT_SCHEMA),
      this.askJson(input.tenant, "content_review", postId, formatPrompt(input.bai), VERDICT_SCHEMA)
    ]);
    const failed = [expert, voice, format].find((r) => !r.ok);
    if (failed !== undefined && !failed.ok) return { ok: false, status: 502, error: "mo_hinh_tu_choi", message: failed.message };
    const pick = (r: typeof expert) => (r.ok ? r.json : null);
    const outcome = summarizeReview({ chuyenMon: verdictOf(pick(expert)), giong: verdictOf(pick(voice)), dangBai: verdictOf(pick(format)) });
    return { ok: true, ...outcome, model: expert.ok ? expert.model : "" };
  }

  /** "Tối ưu": rewrites the post against the critique and the machine's rule errors. */
  async optimize(input: { tenant: string; bai: ReviewPost; phanBien: ReviewOutcome | null; loiLuat: string[]; phongCach?: WritingStyle | undefined }): Promise<ContentDeskResult<{ caption: string; chuAnh: string; model: string }>> {
    const refused = this.notReady();
    if (refused !== null) return refused;
    if (text(input.bai.caption) === "") return { ok: false, status: 400, error: "bai_rong", message: "Bài chưa có nội dung để tối ưu." };
    const r = await this.askJson(input.tenant, "content_optimize", text(input.bai.ma, 120), fixPrompt(input.bai, input.phanBien, input.loiLuat, input.phongCach), FIX_SCHEMA);
    if (!r.ok) return { ok: false, status: 502, error: "mo_hinh_tu_choi", message: r.message };
    const caption = text(r.json["caption"], 9000);
    if (caption === "") return { ok: false, status: 502, error: "ban_sua_rong", message: "Mô hình trả về bài rỗng." };
    return { ok: true, caption, chuAnh: text(r.json["chuAnh"], 300), model: r.model };
  }

  /** Weekly trend research: a hot score per model line. The landing clamps the weekly change. */
  async trends(input: { tenant: string; dong: TrendLine[]; boiCanh?: string | undefined; veShop?: string | undefined }): Promise<ContentDeskResult<{ dong: TrendCard[]; model: string }>> {
    const refused = this.notReady();
    if (refused !== null) return refused;
    const lines = input.dong.filter((l) => text(l.key) !== "").slice(0, 60);
    if (lines.length === 0) return { ok: false, status: 400, error: "thieu_dong", message: "Chưa có dòng sản phẩm nào để nghiên cứu." };
    const r = await this.askJson(input.tenant, "content_trend", "", trendPrompt(lines, text(input.boiCanh, 200), text(input.veShop, 600)), TREND_SCHEMA, 8000);
    if (!r.ok) return { ok: false, status: 502, error: "mo_hinh_tu_choi", message: r.message };
    const known = new Set(lines.map((l) => text(l.key)));
    const cards: TrendCard[] = (Array.isArray(r.json["models"]) ? r.json["models"] : []).map((m) => {
      const o = m !== null && typeof m === "object" ? (m as Record<string, unknown>) : {};
      const list = (v: unknown, n: number, len: number) => (Array.isArray(v) ? v : []).map((x) => text(x, len)).filter(Boolean).slice(0, n);
      const status = text(o["trendStatus"]);
      const confidence = Number(o["confidence"]);
      return {
        key: text(o["key"], 160), dong: text(o["modelLine"], 160), hang: text(o["brand"], 80),
        hotScore: Math.max(0, Math.min(20, Math.round(Number(o["hotScore"]) || 0))),
        trendStatus: status === "rising" || status === "cooling" ? status : "stable",
        trendReason: text(o["trendReason"], 300), story: text(o["story"], 900),
        styling: list(o["styling"], 4, 160), sampleCaptions: list(o["sampleCaptions"], 3, 200),
        confidence: Number.isFinite(confidence) && confidence > 0 ? Math.max(0.3, Math.min(0.95, confidence)) : 0.55
      } satisfies TrendCard;
    }).filter((c) => known.has(c.key));
    return { ok: true, dong: cards, model: r.model };
  }
}
