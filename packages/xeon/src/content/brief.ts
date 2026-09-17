/**
 * @file The WRITING BRIEF — what a merchant's landing sends when it asks the brain for a post,
 * and the draft that comes back.
 *
 * Field names are Vietnamese because this is the EXTERNAL CONTRACT with the landing, like every
 * other body in `protocol.ts`.
 *
 * ONE DECISION WORTH KEEPING: THE RULES TRAVEL WITH THE BRIEF.
 *
 * The rules of a good post (length, banned phrases, how a hook opens) live on the landing, in the
 * content module that also JUDGES the draft. They are not copied here. The landing sends them as
 * part of the brief, so:
 *
 *   - there is ONE source of truth, and the writer cannot drift from the judge;
 *   - a shop changing a rule takes effect on the next request, with no deploy on Xeon;
 *   - two shops in different trades can hold different rules without Xeon knowing either.
 *
 * Xeon's job here is narrow and stays narrow: turn a brief into Vietnamese copy.
 */

/** One product the post is about, as the landing knows it. */
export interface BriefItem {
  ma: string;
  ten: string;
  hang?: string | undefined;
  gia?: number | undefined;
  /** Sizes still in stock. An empty list means the post must not promise a size. */
  size?: string[] | undefined;
}

/** What the landing asks for. */
export interface WriteBriefBody {
  /** Only honoured with the legacy shared token; otherwise derived from the inbox token. */
  tenant?: string | undefined;
  /** Shape of post ("so_sanh", "gom_nhu_cau"...) — an id of the landing's, opaque here. */
  dangBai?: string | undefined;
  /** What that shape is supposed to do, in the landing's own words. This is the writer's brief. */
  huongDan?: string | undefined;
  /** What this particular post is about, if the owner wrote a topic. */
  chuDe?: string | undefined;
  mon?: BriefItem[] | undefined;
  /** The rules the draft will be judged by, in the landing's words. */
  luat?: WriteRules | undefined;
  /** Errors the judge found in the PREVIOUS draft — the "tối ưu" step, closed as a loop. */
  loiLanTruoc?: string[] | undefined;
  /**
   * Đ8: the shop's WRITING STYLE, chosen in OMI and stored on the landing (Desk "Phong cách &
   * prompt mẫu"). Like the rules, it travels with the brief: Xeon keeps no shop's voice.
   */
  phongCach?: WritingStyle | undefined;
  /** Đ8: the buying angle of this post (Desk `CONTENT_BUY_ANGLES`) — who the post speaks to. */
  goc?: { ten?: string | undefined; huongDan?: string | undefined } | undefined;
}

/** A shop's writing style as the landing stores it. Every field is the shop's own words. */
export interface WritingStyle {
  ten?: string | undefined;
  moTa?: string | undefined;
  /** "System prompt / luật viết". */
  luatViet?: string | undefined;
  /** "Cấu trúc output bắt buộc". */
  cauTruc?: string | undefined;
  /** "Bài viral mẫu / câu mẫu yêu thích" — to learn the rhythm from, never to copy. */
  baiMau?: string | undefined;
}

/** The judge's rules, as numbers and sentences the writer can follow. */
export interface WriteRules {
  captionToiThieu?: number | undefined;
  captionToiDa?: number | undefined;
  hookChuHoaToiThieu?: number | undefined;
  hookChuHoaToiDa?: number | undefined;
  /** Human sentences: "không nhắc giá tiền", "không hứa mốc giao"... */
  cam?: string[] | undefined;
  /** Where links in the first comment must point. */
  gocLink?: string | undefined;
}

/** What comes back. The three pieces a post is made of on the landing. */
export interface WriteDraft {
  caption: string;
  /** The words printed on the cover image. */
  chuAnh: string;
  /** The first comment, where the links go. */
  comment: string;
}

export type WriteResult =
  | { ok: true; ban: WriteDraft; model: string }
  | { ok: false; viSao: string };
