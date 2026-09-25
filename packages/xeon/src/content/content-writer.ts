/**
 * @file Turning a brief into a prompt, and a model answer back into a draft. PURE — no network.
 *
 * Keeping the prompt here rather than inside the adapter is what makes the wording testable: a
 * test can assert that a sold-out size never reaches the prompt, that the judge's rules are
 * restated, and that the previous round's errors are carried into the retry — none of which can
 * be checked if the sentences are built inside a network call.
 *
 * THE RULES ARE RESTATED, NOT INVENTED. Everything the prompt says about length, hooks and banned
 * phrases comes from `brief.luat`, which the landing filled in from the same rules that will judge
 * the result. Writing a rule here would create a second, quietly diverging copy.
 */

import type { BriefItem, WriteBriefBody, WriteDraft, WriteRules, WritingStyle } from "./brief";

export interface Prompt {
  system: string;
  user: string;
}

const text = (v: unknown): string => String(v ?? "").trim();

/** The JSON shape the model must answer in (structured outputs). */
export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string", description: "Bài đăng hoàn chỉnh, tiếng Việt." },
    chuAnh: { type: "string", description: "Chữ in trên ảnh chính, lấy từ hook nhưng ngắn hơn hook." },
    comment: { type: "string", description: "Bình luận đầu tiên, nơi đặt link." }
  },
  required: ["caption", "chuAnh", "comment"],
  additionalProperties: false
} as const;

/** One product line for the prompt. A size that is not in stock never appears. */
function itemLine(item: BriefItem): string {
  const sizes = (item.size ?? []).map(text).filter((s) => s !== "");
  const price = Number(item.gia ?? 0) > 0 ? `, giá ${Number(item.gia).toLocaleString("vi-VN")}đ` : "";
  const brand = text(item.hang) === "" ? "" : ` (${text(item.hang)})`;
  const stock = sizes.length === 0 ? ", hiện không còn size nào" : `, còn size ${sizes.join(", ")}`;
  return `- ${text(item.ma)}: ${text(item.ten)}${brand}${price}${stock}`;
}

/** The rules, restated for the writer in the landing's own words. */
function rulesBlock(rules: WriteRules | undefined): string {
  if (rules === undefined) return "";
  const lines: string[] = [];
  const min = Number(rules.captionToiThieu ?? 0);
  const max = Number(rules.captionToiDa ?? 0);
  if (min > 0 || max > 0) lines.push(`- Độ dài caption: ${min > 0 ? `ít nhất ${min}` : ""}${min > 0 && max > 0 ? " và " : ""}${max > 0 ? `nhiều nhất ${max}` : ""} ký tự.`);
  const capsMin = Number(rules.hookChuHoaToiThieu ?? 0);
  const capsMax = Number(rules.hookChuHoaToiDa ?? 0);
  if (capsMin > 0 && capsMax > 0) {
    lines.push(`- Dòng đầu (hook) mở bằng ĐÚNG ${capsMin}–${capsMax} chữ VIẾT HOA liền nhau, rồi viết thường tiếp. Không viết hoa cả câu.`);
  }
  for (const ban of rules.cam ?? []) if (text(ban) !== "") lines.push(`- ${text(ban)}`);
  if (text(rules.gocLink) !== "") lines.push(`- Bình luận đầu phải có link, và mọi link đều bắt đầu bằng ${text(rules.gocLink)}.`);
  return lines.join("\n");
}

/** The shop's writing style (Đ8), restated in its own words. Empty when the shop chose none. */
export function styleBlock(style: WritingStyle | undefined): string {
  if (style === undefined) return "";
  const parts = [
    text(style.ten) === "" ? "" : `Phong cách viết của shop: ${text(style.ten)}${text(style.moTa) === "" ? "" : ` — ${text(style.moTa)}`}`,
    text(style.luatViet) === "" ? "" : `Luật viết của shop:\n${text(style.luatViet).slice(0, 3000)}`,
    text(style.cauTruc) === "" ? "" : `Cấu trúc bài shop muốn:\n${text(style.cauTruc).slice(0, 2000)}`,
    text(style.baiMau) === "" ? "" : `Bài / câu mẫu shop thích (học nhịp viết, KHÔNG chép nguyên văn):\n${text(style.baiMau).slice(0, 4000)}`
  ].filter((p) => p !== "");
  return parts.join("\n");
}

/**
 * Builds the prompt for one post.
 *
 * The instructions are deliberately short on style and long on constraint. A brief that describes
 * the voice in ten paragraphs produces copy that reads like the brief; the shape of a good post
 * comes from `huongDan`, which the shop wrote, not from Xeon's opinion of good marketing.
 */
export function buildPrompt(brief: WriteBriefBody): Prompt {
  const items = (brief.mon ?? []).filter((m) => text(m.ma) !== "");
  const rules = rulesBlock(brief.luat);
  const retry = (brief.loiLanTruoc ?? []).map(text).filter((e) => e !== "");

  const system = [
    "Bạn viết bài bán hàng tiếng Việt cho một cửa hàng, đăng trên Facebook.",
    "Giọng: người bán hàng nói chuyện với khách, xưng \"em\", gọi khách là \"anh\"/\"chị\"/\"các bác\". Không rao, không hô khẩu hiệu.",
    "Chỉ nói những gì có trong dữ liệu được đưa. Không bịa thông số, không bịa size, không bịa khuyến mãi.",
    "Trả lời bằng JSON đúng lược đồ được yêu cầu, không thêm lời dẫn."
  ].join("\n");

  const user = [
    brief.dangBai === undefined ? "" : `Dạng bài: ${text(brief.dangBai)}`,
    text(brief.huongDan) === "" ? "" : `Bài này cần làm được: ${text(brief.huongDan)}`,
    text(brief.chuDe) === "" ? "" : `Chủ đề cụ thể BẮT BUỘC, không được tự đổi phạm vi/hãng/nhu cầu: ${text(brief.chuDe)}`,
    text(brief.goc?.ten) === "" ? "" : `Góc mua (khách mua vì): ${text(brief.goc?.ten)}${text(brief.goc?.huongDan) === "" ? "" : ` — ${text(brief.goc?.huongDan)}`}`,
    styleBlock(brief.phongCach),
    "",
    items.length === 0 ? "Không có mã sản phẩm nào." : `Các mã trong bài (chỉ dùng đúng các mã này):\n${items.map(itemLine).join("\n")}`,
    "\nHOOK VÀ CHỮ ẢNH: hook phải gọi đúng một insight hoặc vấn đề cụ thể của khách, tạo khoảng tò mò để họ dừng lại và đọc tiếp; tránh câu chung chung chỉ giới thiệu danh mục. Chữ lớn trên ảnh phải nêu bật chính vấn đề/insight đó, ngắn hơn hook và không chỉ lặp tên sản phẩm.",
    rules === "" ? "" : `\nLuật bắt buộc — bài sẽ bị chấm lại theo đúng những luật này:\n${rules}`,
    retry.length === 0
      ? ""
      : `\nBản trước bị chấm HỎNG vì những lỗi sau. Viết lại bản mới không còn lỗi nào trong số đó:\n${retry.map((e) => `- ${e}`).join("\n")}`,
    "",
    "Trả về ba phần: caption (bài hoàn chỉnh), chuAnh (chữ in trên ảnh chính, lấy chữ từ hook nhưng ngắn hơn hook), comment (bình luận đầu, nơi đặt link)."
  ].filter((line) => line !== "").join("\n");

  return { system, user };
}

/**
 * Reads the model's answer into a draft.
 *
 * Tolerant on purpose: structured outputs make valid JSON the normal case, but a fenced block or
 * a stray sentence around it must not lose a post that is otherwise fine. Anything that is not
 * three strings is `null`, and the caller says so rather than storing half a draft.
 */
export function readDraft(raw: string): WriteDraft | null {
  const body = text(raw);
  if (body === "") return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(body);
  const candidates = [body, fenced?.[1] ?? "", body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1)];
  for (const candidate of candidates) {
    if (text(candidate) === "") continue;
    let parsed: unknown;
    try { parsed = JSON.parse(candidate); } catch { continue; }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const draft = parsed as Record<string, unknown>;
    const caption = text(draft["caption"]);
    if (caption === "") continue;
    return { caption, chuAnh: text(draft["chuAnh"]), comment: text(draft["comment"]) };
  }
  return null;
}
