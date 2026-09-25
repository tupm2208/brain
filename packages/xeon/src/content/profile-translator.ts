/**
 * @file NGƯỜI PHIÊN DỊCH (22/09/2026) — turns what a shop owner SAYS into the fields the content
 * workshop reads.
 *
 * WHY THIS EXISTS. Everything the workshop used to hard-code is now a form the shop fills in:
 * which signals decide the ranking, the buying angles, the shapes of a post, the banned phrases,
 * the lengths, the pass mark. That form is correct and it is also thirty fields long — a shop owner
 * who has never written a prompt should not have to meet it head-on. So they say it in their own
 * words, and this turns the words into the form.
 *
 * WHAT MAKES IT SAFE:
 *   - THE FORM COMES FROM THE LANDING, in the same request (`bangMau`). Xeon holds no copy, so it
 *     cannot answer with a field that does not exist, and a new field needs no deploy here.
 *   - IT ONLY FILLS IN WHAT WAS SAID. Silence is not an opinion: a field nobody mentioned is left
 *     out, and the landing keeps whatever was there. That is why `hoSo` is a PATCH, never a whole
 *     profile — inventing the other twenty-five fields would quietly rewrite a shop's rules.
 *   - IT REPORTS WHAT IT DID NOT UNDERSTAND (`chuaRo`), instead of guessing.
 *   - THE LANDING STORES NOTHING until a person approves it. This is a suggestion, not a decision.
 */

import { withUsage } from "../ai/usage-context";
import type { TextModelPort } from "./text-model";

/** One field of the form, exactly as the landing describes it to the person on screen. */
export interface ProfileField {
  duong: string;
  nhan: string;
  kieu: string;
  giaiThich?: string | undefined;
  viDu?: string | undefined;
  toiThieu?: number | undefined;
  toiDa?: number | undefined;
}

export interface UnderstandInput {
  tenant: string;
  /** Lời người vận hành kể, nguyên văn. */
  loKe: string;
  bangMau: ProfileField[];
  /** Hồ sơ đang chạy, để hiểu "giữ nguyên phần kia" và để biết cái gì thực sự đổi. */
  hoSoHienTai?: Record<string, unknown> | undefined;
  mau?: { id: string; ten: string; moTa?: string | undefined }[] | undefined;
  mucTieu?: { id: string; ten: string; moTa?: string | undefined }[] | undefined;
}

export interface UnderstandOutcome {
  /** Chỉ những trường lời kể thực sự nói tới. */
  hoSo: Record<string, unknown>;
  hieuLa: string[];
  chuaRo: string[];
  model: string;
}

const text = (v: unknown, n = 4000): string => String(v ?? "").trim().slice(0, n);

const UNDERSTAND_SCHEMA = {
  type: "object",
  properties: {
    // The patch itself is free-shaped: its shape is the form the landing just sent, and the landing
    // clamps every value anyway. Pinning it here would mean redeploying Xeon for a new field.
    hoSo: { type: "object" },
    hieuLa: { type: "array", items: { type: "string" } },
    chuaRo: { type: "array", items: { type: "string" } }
  },
  required: ["hoSo", "hieuLa", "chuaRo"],
  additionalProperties: false
} as const;

export function understandPrompt(input: UnderstandInput): { system: string; user: string } {
  const fields = input.bangMau.map((f) => {
    const range = f.toiThieu === undefined && f.toiDa === undefined ? "" : ` [${f.toiThieu ?? "?"}–${f.toiDa ?? "?"}]`;
    return `- ${f.duong} (${f.kieu}${range}) · ${f.nhan}: ${text(f.giaiThich, 300)}${f.viDu === undefined || f.viDu === "" ? "" : ` Ví dụ: ${text(f.viDu, 200)}`}`;
  }).join("\n");

  return {
    system: [
      "Bạn giúp một chủ cửa hàng khai báo CÁCH LÀM CONTENT của họ vào phần mềm.",
      "Họ kể bằng lời thường ngày; việc của bạn là điền vào đúng ô, KHÔNG viết lại bài, KHÔNG tư vấn marketing.",
      "NGUYÊN TẮC SẮT: chỉ điền ô nào lời kể thực sự nói tới. Ô không ai nhắc thì BỎ HẲN khỏi kết quả — bỏ trống là giữ nguyên cài đặt cũ, còn đoán bừa là sửa luật của người ta sau lưng.",
      "Trả JSON hợp lệ đúng lược đồ, không thêm chữ ngoài JSON."
    ].join("\n"),
    user: [
      `LỜI CHỦ SHOP KỂ:\n"""${text(input.loKe, 4000)}"""`,
      `\nCÁC Ô CÓ THỂ ĐIỀN (đường dẫn · kiểu · nghĩa):\n${fields}`,
      input.mucTieu === undefined || input.mucTieu.length === 0 ? "" : `\nMỤC TIÊU CHỌN SẴN (dùng id): ${input.mucTieu.map((o) => `${o.id} = ${o.ten}${o.moTa === undefined || o.moTa === "" ? "" : ` (${o.moTa})`}`).join(" | ")}`,
      input.mau === undefined || input.mau.length === 0 ? "" : `\nMẪU NGÀNH (nếu lời kể nói rõ ngành thì đặt "mau" bằng id tương ứng): ${input.mau.map((m) => `${m.id} = ${m.ten}`).join(" | ")}`,
      input.hoSoHienTai === undefined ? "" : `\nĐANG KHAI (để biết cái gì thật sự đổi; đừng chép lại nguyên si):\n${JSON.stringify(input.hoSoHienTai).slice(0, 6000)}`,
      [
        "\nCÁCH ĐIỀN:",
        "- Kiểu \"muc\" là mức 0–5 (0 bỏ qua, 5 rất coi trọng). \"Chỉ quan tâm hàng sale\" → giamGia 5 và hạ các mức còn lại, đừng đặt tất cả bằng 5.",
        "- Kiểu \"so\" là một số trong khoảng cho sẵn. Kiểu \"bat\" là true/false.",
        "- gocMua là danh sách [{id, ten, huongDan, tuKhoa[], bat}]. Gửi gocMua thì phải gửi ĐỦ danh sách mong muốn, vì nó thay thế cả bảng cũ. Từ khoá phải là cụm ít nhất 2 tiếng (\"người mới\", \"chân bè\"), không dùng từ đơn thông dụng.",
        "- luatBai.cumCam là [{id, nhan, cum[]}]: nhan là lý do ngắn người đọc hiểu, cum là các cụm viết thường như khi nói chuyện, không phải biểu thức.",
        "- Khách kể \"bài ngắn thôi\" → captionToiThieu/captionToiDa; \"đừng nhắc giá\" → camNhacGia true; \"khó tính hơn\" → phanBien.diemDat cao hơn.",
        "\nhieuLa: 2–6 câu tiếng Việt nói lại bạn vừa hiểu gì, mỗi câu một ý, để chủ shop đọc mà gật hoặc sửa.",
        "chuaRo: những chỗ lời kể chưa đủ để điền (nếu có), hỏi lại ngắn gọn. Không bịa để lấp."
      ].join("\n")
    ].filter((l) => l !== "").join("\n")
  };
}

export interface ProfileTranslatorOptions { model: TextModelPort }

export type UnderstandResult =
  | ({ ok: true } & UnderstandOutcome)
  | { ok: false; status: number; error: string; message: string };

export class ProfileTranslator {
  constructor(private readonly options: ProfileTranslatorOptions) {}

  async understand(input: UnderstandInput): Promise<UnderstandResult> {
    if (!this.options.model.ready()) return { ok: false, status: 503, error: "chua_co_mo_hinh", message: "Xeon chưa cấu hình mô hình." };
    if (text(input.loKe) === "") return { ok: false, status: 400, error: "chua_ke_gi", message: "Chưa có lời kể nào để hiểu." };
    if (input.bangMau.length === 0) return { ok: false, status: 400, error: "thieu_bang_mau", message: "Landing chưa gửi bảng mẫu các ô cần điền." };

    const prompt = understandPrompt(input);
    const outcome = await withUsage({ shop: input.tenant, agent: "content_profile" }, () =>
      this.options.model.complete({ system: prompt.system, user: prompt.user, schema: UNDERSTAND_SCHEMA as unknown as Record<string, unknown>, maxTokens: 3000 }));
    if (!outcome.ok) return { ok: false, status: 502, error: "mo_hinh_tu_choi", message: outcome.viSao };

    const json = looseJson(outcome.text);
    if (json === null) return { ok: false, status: 502, error: "khong_doc_duoc", message: "Mô hình trả về thứ không đọc được." };
    const patch = json["hoSo"];
    return {
      ok: true,
      hoSo: patch !== null && typeof patch === "object" && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {},
      hieuLa: lines(json["hieuLa"]),
      chuaRo: lines(json["chuaRo"]),
      model: outcome.model
    };
  }
}

const lines = (v: unknown): string[] => (Array.isArray(v) ? v : []).map((x) => text(x, 300)).filter((x) => x !== "").slice(0, 12);

/** Cùng cách đọc JSON lỏng như content-desk: mô hình đôi khi bọc JSON trong ```json. */
function looseJson(raw: string): Record<string, unknown> | null {
  const body = String(raw ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed: unknown = JSON.parse(body.slice(start, end + 1));
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}
