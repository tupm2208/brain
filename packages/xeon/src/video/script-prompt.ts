/**
 * @file THE VIDEO SCRIPT PROMPT — rewriting an approved Facebook post into a 9:16 video script.
 *
 * COPIED, NOT MOVED, from `toprun-video-studio/src/kit/video-script-prompt.js` (21/09/2026). The
 * tool keeps working exactly as it does; this is the platform's own copy, on Xeon, because the
 * model key has lived only on Xeon since 14/09/2026 and a shop's machine never sees one.
 *
 * The Vietnamese rules below are KEPT WORD FOR WORD. They are not prose — each line is a mistake
 * someone watched a model make and then wrote a sentence to stop (the dates are in the tool's own
 * comments: a model calling a shoe "đôi đắt nhất batch này" on 08/09/2026, the hollow ad phrases
 * caught on 07/09). Rewording them politely is how that work gets lost.
 *
 * ONE THING IS DIFFERENT: the tool was written for one shop and says "TopRun, một shop bán giày
 * chạy bộ" in its system line. The platform serves many shops, so the shop's name and trade are
 * arguments. Everything else is the tool's.
 *
 * Pure logic: no file, no network, no model call. `VideoScriptDesk` does the talking.
 */

/** Greetings that waste the three seconds that decide whether anyone stays. */
export const CAM_MO_DAU = [
  "chào các bác", "chao cac bac", "xin chào", "hôm nay em", "em xin",
  "các bác ơi", "alo", "hello", "kính chào"
];

/** Hollow ad phrases (the tool's list, 07/09/2026). */
export const CAM_TRONG_BAI = [
  "em hỏi lại", "lựa chọn hợp lý", "hy vọng bài viết", "trên đây là",
  "hãy cùng", "không thể bỏ qua", "đừng bỏ lỡ", "siêu phẩm", "đỉnh cao"
];

/** Our own words. A customer has never said "batch" (caught 08/09/2026). */
export const CAM_TU_NOI_BO = [
  "batch", "sku", "tồn kho", "ton kho", "mã hàng", "ma hang",
  "danh sách này", "bài này", "kịch bản", "dữ liệu"
];

export const HOOK_READ_MAX_WORDS = 16;
/** Each on-screen phrase, so the words can bounce on the beat. */
export const HOOK_WORD_MAX = 4;
export const NOTE_MAX_WORDS = 18;
export const CTA_MAX_WORDS = 20;

/** One product as the model is told about it. */
export interface ScriptProduct {
  code: string;
  name?: string | undefined;
  salePrice?: string | number | undefined;
  sizes?: { size?: string; qty?: number }[] | undefined;
}

/** The approved post being turned into a video. */
export interface ScriptPost {
  /** The big words on the picture. */
  main?: string | undefined;
  sub?: string | undefined;
  caption?: string | undefined;
  comment?: string | undefined;
  codes?: string[] | undefined;
  /** Codes the post still mentions but the video will not show — sold out since it was written. */
  maBo?: { code: string; name?: string; lyDo: string }[] | undefined;
}

export interface ShopVoice {
  /** The shop's display name. */
  tenShop: string;
  /** What it sells, in the shop's own words: "giày chạy bộ", "thuốc"… */
  nganh: string;
}

export interface VideoScript {
  hookWords: string[];
  hookRead: string;
  criteria?: string[];
  criteriaRead?: string;
  notes?: Record<string, string>;
  ctaLine1?: string;
  ctaLine2?: string;
  ctaRead?: string;
  scriptedBy?: string;
}

export function systemLine(shop: ShopVoice): string {
  return [
    `Bạn viết kịch bản video ngắn dọc 9:16 cho ${shop.tenShop}, một shop bán ${shop.nganh} ở Việt Nam.`,
    "Người đọc kịch bản này là máy đọc, khán giả nghe bằng tai và không tua lại được.",
    "Bạn CHỈ trả về JSON đúng khuôn được yêu cầu, không thêm lời dẫn, không rào đầu rào cuối."
  ].join(" ");
}

/** The writing rules. One place to change, and a test can read them. */
export const LUAT = [
  "BA GIÂY ĐẦU quyết định người ta ở lại hay lướt. Mở bằng kết luận hoặc con số gây tò mò nhất, KHÔNG chào hỏi, KHÔNG giới thiệu bản thân.",
  "Chữ trên màn hình chia thành 2-3 cụm, mỗi cụm tối đa 4 từ, để chữ nảy lên theo nhịp nhạc.",
  "Lời đọc mở đầu tối đa 16 từ, một ý duy nhất.",
  "Mỗi sản phẩm chỉ một câu nhận xét, tối đa 18 từ: hợp ai, hoặc khác các đôi kia ở chỗ nào.",
  "KHÔNG đọc lại thứ đã hiện to trên màn hình: tên sản phẩm, giá tiền, số size. Màn hình lo phần đó rồi.",
  "KHÔNG bịa thông số. Chỉ được dùng dữ liệu có trong bài gốc. Không chắc thì nói chung chung, đừng đoán.",
  "Giọng người bán hàng nói thật với khách quen: câu ngắn, không kể lể, không hoa mỹ, không dùng từ quảng cáo sáo rỗng.",
  'Xưng "em", gọi khách là "các bác" hoặc không gọi.',
  "Lời chốt dẫn về bình luận, nhắc khách nhắn số đo dài chân để chọn size.",
  "Tiêu chí viết thành danh sách 2-3 mục ngắn, mỗi mục là một cụm chứ không phải câu dài.",
  'KHÔNG dùng từ nội bộ của hệ thống: batch, mã hàng, tồn kho, SKU, dữ liệu. Khách không nói như vậy. Muốn so sánh thì nói "trong năm đôi này" hoặc "so với mấy đôi kia".'
].map((l, i) => `${i + 1}. ${l}`).join("\n");

const SCHEMA_MO_TA = [
  "{",
  '  "hookWords": ["cụm 1", "cụm 2", "cụm 3"],',
  '  "hookRead": "câu mở đầu người đọc sẽ nói",',
  '  "criteria": ["tiêu chí 1", "tiêu chí 2"],',
  '  "criteriaRead": "câu đọc cho phần tiêu chí",',
  '  "notes": { "MÃ_HÀNG": "một câu nhận xét" },',
  '  "ctaLine1": "chữ to ở cảnh chốt, xuống dòng bằng \\n",',
  '  "ctaLine2": "dòng phụ ở cảnh chốt",',
  '  "ctaRead": "câu đọc ở cảnh chốt"',
  "}"
].join("\n");

function productLines(codes: readonly string[], byCode: Record<string, ScriptProduct>): string {
  return codes.map((code) => {
    const p = byCode[code] ?? ({} as ScriptProduct);
    const sizes = p.sizes ?? [];
    const qty = sizes.reduce((s, v) => s + (v.qty ?? 0), 0);
    return [
      `- ${code}`,
      p.name ? `tên: ${p.name}` : "",
      p.salePrice ? `giá: ${p.salePrice}` : "",
      sizes.length ? `còn ${sizes.length} size, ${qty} đôi` : ""
    ].filter(Boolean).join(" | ");
  }).join("\n");
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

/** Builds what the model is shown. `byCode` is the real stock data, for understanding, not reading out. */
export function buildVideoScriptPrompt(post: ScriptPost, byCode: Record<string, ScriptProduct>, shop: ShopVoice): BuiltPrompt {
  const codes = (post.codes ?? []).filter(Boolean);
  const dropped = post.maBo ?? [];
  const user = [
    "BÀI GỐC (bài đăng Facebook đã duyệt):",
    `Chữ trên ảnh: ${post.main || "(trống)"}`,
    `Dòng phụ: ${post.sub || "(trống)"}`,
    "",
    "Nội dung bài:",
    String(post.caption ?? "(trống)").trim(),
    "",
    post.comment ? `Bình luận chốt: ${String(post.comment).trim()}` : "",
    "",
    "CÁC MÃ TRONG BÀI (số liệu thật, dùng để hiểu sản phẩm, KHÔNG đọc lại giá):",
    productLines(codes, byCode),
    "",
    // The post may still name something the video will not show (sold out since). The model must
    // rewrite as if it never was there — including the count in the opening line.
    dropped.length > 0
      ? `ĐÃ BỎ KHỎI VIDEO (kho đã khác so với lúc đăng bài):\n${dropped.map((m) => `- ${m.code}${m.name ? ` (${m.name})` : ""}: ${m.lyDo}`).join("\n")}\n`
        + "Bài gốc bên trên vẫn nhắc tới mấy mã này. TUYỆT ĐỐI không nhắc tên chúng, không "
        + "đếm chúng vào số món, không chừa chỗ cho chúng. Viết lại như thể bài chỉ có "
        + `${codes.length} món ngay từ đầu — kể cả chữ trên ảnh và câu mở đầu. `
        + "GIỮ NGUYÊN CHỦ ĐỀ của bài gốc, chỉ bỏ mấy món không còn."
      : "",
    "",
    "LUẬT VIẾT KỊCH BẢN VIDEO:",
    LUAT,
    "",
    // On screen each code is its OWN frame. Saying "three pairs" over four frames is visibly wrong.
    `ĐẾM CHO ĐÚNG: trên hình sẽ có đúng ${codes.length} khung sản phẩm, mỗi mã một khung. `
      + `Nếu lời đọc hay chữ trên ảnh có nhắc số lượng thì phải đúng bằng ${codes.length}. `
      + "Bản nam và bản nữ của cùng một đôi vẫn tính là hai món, vì trên hình là hai khung.",
    "",
    `Trả về đúng JSON này, "notes" phải có đủ ${codes.length} mã: ${codes.join(", ")}`,
    SCHEMA_MO_TA
  ].filter((l) => l !== "").join("\n");
  return { system: systemLine(shop), user };
}

/** Models wrap JSON in fences or add a preamble. Pull the object out of whatever came back. */
export function parseScript(text: string): VideoScript | null {
  const raw = String(text ?? "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(body.slice(start, end + 1)) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as VideoScript) : null;
  } catch {
    return null;
  }
}

const words = (text: unknown): string[] => String(text ?? "").trim().split(/\s+/).filter(Boolean);
const lower = (text: unknown): string => String(text ?? "").toLowerCase();

/**
 * A price written any of the ways people write one.
 *
 * FIXED HERE, NOT IN THE TOOL (21/09/2026). The tool's pattern ends in `\b`, and `\b` is ASCII:
 * after "đ" it never matches, so `1.890.000đ`, `1890000 đ` and `500.000 đồng` all read as NOT a
 * price — the three commonest ways a Vietnamese price is written. The whole point of this check is
 * "do not read out what the screen already shows", so it was missing most of what it looks for.
 * A Unicode-aware lookahead does what `\b` was meant to do, and `đồng`/`dong` are now words too.
 * The tool itself is untouched: it keeps running exactly as it does.
 */
export function hasMoney(text: unknown): boolean {
  return /\d[\d.,]*\s*(nghìn|nghin|triệu|trieu|đồng|dong|k|đ|d)(?![\p{L}\d])/iu.test(String(text ?? ""));
}

export interface ScriptCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Checks what the model returned. Says where it is wrong; never fixes it quietly. */
export function validateScript(script: VideoScript | null, codes: readonly string[]): ScriptCheck {
  const errs: string[] = [];
  const warns: string[] = [];
  if (!script || typeof script !== "object") return { ok: false, errors: ["Model khong tra ve JSON doc duoc."], warnings: [] };

  const hw = Array.isArray(script.hookWords) ? script.hookWords : [];
  if (hw.length < 2 || hw.length > 3) errs.push(`hookWords phai co 2 hoac 3 cum, dang co ${hw.length}.`);
  hw.forEach((w, i) => {
    if (words(w).length > HOOK_WORD_MAX) errs.push(`Cum chu thu ${i + 1} dai qua ${HOOK_WORD_MAX} tu: "${w}"`);
  });

  if (!script.hookRead) errs.push("Thieu hookRead.");
  else {
    if (words(script.hookRead).length > HOOK_READ_MAX_WORDS) errs.push(`hookRead dai hon ${HOOK_READ_MAX_WORDS} tu.`);
    const low = lower(script.hookRead);
    const chao = CAM_MO_DAU.find((c) => low.indexOf(c) === 0 || (low.indexOf(c) >= 0 && low.indexOf(c) < 12));
    if (chao) errs.push(`Mo dau bang loi chao "${chao}" - ba giay dau khong duoc phi.`);
  }

  const crit = Array.isArray(script.criteria) ? script.criteria : [];
  if (crit.length < 2 || crit.length > 3) warns.push(`criteria nen co 2-3 muc, dang co ${crit.length}.`);

  const notes = script.notes !== undefined && script.notes !== null && typeof script.notes === "object" ? script.notes : {};
  for (const code of codes) {
    const n = notes[code];
    if (!n) { errs.push(`Thieu nhan xet cho ma ${code}.`); continue; }
    if (words(n).length > NOTE_MAX_WORDS) errs.push(`Nhan xet ma ${code} dai hon ${NOTE_MAX_WORDS} tu.`);
    if (hasMoney(n)) errs.push(`Nhan xet ma ${code} doc lai gia - man hinh da hien roi.`);
  }

  if (!script.ctaRead) errs.push("Thieu ctaRead.");
  else if (words(script.ctaRead).length > CTA_MAX_WORDS) warns.push(`ctaRead dai hon ${CTA_MAX_WORDS} tu.`);

  const all = [script.hookRead, script.criteriaRead, script.ctaRead].concat(Object.values(notes)).join(" ");
  const low = lower(all);
  for (const c of CAM_TRONG_BAI) if (low.includes(c)) errs.push(`Con cum sao rong: "${c}".`);
  for (const c of CAM_TU_NOI_BO) if (low.includes(c)) errs.push(`Dung tu noi bo "${c}" - khach khong noi vay.`);
  if (hasMoney(script.hookRead)) warns.push("hookRead co so tien - can nhac bo di, man hinh da hien.");

  return { ok: errs.length === 0, errors: errs, warnings: warns };
}

/** Told the mistakes and made to write again. Naming them beats asking for "better". */
export function buildVideoFixPrompt(script: VideoScript | null, check: ScriptCheck): string {
  return [
    "Kịch bản bạn vừa trả về chưa đạt. Các lỗi:",
    check.errors.map((e, i) => `${i + 1}. ${e}`).join("\n"),
    "",
    "Kịch bản cũ:",
    JSON.stringify(script, null, 1),
    "",
    "Sửa đúng những lỗi trên, giữ nguyên phần đã ổn. Trả về JSON đúng khuôn cũ, không giải thích."
  ].join("\n");
}
